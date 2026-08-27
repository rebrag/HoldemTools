"""Validation harness: compare an engine river solve against PioSolver.

Manual developer tool (Pio only runs on this machine) - never wired into CI.

Workflow:
  1. Solve the spot with the engine:  engine solve <config.json>
     (use "ev_float32": true so quantization noise cannot pollute the diff,
     and a budget tight enough to match Pio's accuracy contract).
  2. Build the SAME tree in PioViewer (same board, ranges, pot, effective
     stack, bet sizes) and solve it to Pio's usual accuracy
     (max(pot * 0.002, 1e-4) chips), then dump a .cfr.
  3. Run:  python engine_compare.py --artifact out/spot.hta --cfr spot.cfr

The engine config embedded in the artifact is the spot definition - there is
no separate spot file to keep in sync.

Each solver writes its OWN payload (see htc_format.py), because PioSolver is
on its way out and an engine-only run should not pay for a format that
assumes a second solver:

  --ht-out   htsolver's per-hand rows. Needs NO Pio at all - node ids, action
             labels and hand rows all come out of the engine dump - so this
             is the fast iteration loop: solve, dump, pack, done.
  --pio-out  PioSolver's payload. Its summary (root EV, exploitability, solve
             time, peak memory) always; per-hand rows only with --pio-detail,
             which is the expensive part at 4+actions UPI round trips a node.

Anything comparing the two joins them by hand string, never by index: each
file carries its own solver's hand universe and reach.

Pio runs when --solve-pio or --cfr is given, and is simply absent otherwise.

--cross-check runs the cross-exploitability gate: the engine's strategy is
loaded into Pio (set_strategy, never lock_node) and Pio's own evaluator
reports how exploitable that profile is. It is the only metric that means
anything when the two solvers land on different equilibria - 2p zero-sum
games have a unique value but many equilibria, and indifference regions
(bluff-catchers, mixed sizings) are huge in symmetric spots - and it is
therefore the primary correctness statement about the engine. It is OFF by
default: a run without it reports no verdict rather than a cheap PASS.

A QRE artifact (mode != "nash") is refused: QRE deliberately deviates from
Nash and must never be validated against Pio.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
from typing import Dict, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from htc_format import HtcWriter  # noqa: E402

DEFAULT_PIO_DIR = os.environ.get("PIO_DIR", r"C:\PioSOLVER")
DEFAULT_PIO_EXE = os.environ.get("PIO_EXE", "PioSOLVER2-edge.exe")


def _memory_counters(pid: int):
    """(current, peak) working set of another process in bytes, or (None, None)
    off Windows / once the process has exited.

    Deliberately the SAME OS counter the engine writes into its artifact
    metadata (GetProcessMemoryInfo), so the two solvers' memory numbers are
    one measurement of one thing rather than two solvers' opinions of their
    own footprint.
    """
    if os.name != "nt":
        return None, None
    import ctypes
    from ctypes import wintypes

    class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    PROCESS_QUERY_INFORMATION, PROCESS_VM_READ = 0x0400, 0x0010
    handle = ctypes.windll.kernel32.OpenProcess(
        PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not handle:
        return None, None
    try:
        counters = PROCESS_MEMORY_COUNTERS()
        counters.cb = ctypes.sizeof(counters)
        if not ctypes.windll.psapi.GetProcessMemoryInfo(
                handle, ctypes.byref(counters), counters.cb):
            return None, None
        return int(counters.WorkingSetSize), int(counters.PeakWorkingSetSize)
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


def normalize_combo(combo: str) -> Tuple[str, str]:
    """Order-insensitive key for a 4-char combo string like 'AsKh'."""
    a, b = combo[0:2], combo[2:4]
    a = a[0].upper() + a[1].lower()
    b = b[0].upper() + b[1].lower()
    return (a, b) if a < b else (b, a)


def _card_code(card: str) -> int:
    return CARD_RANKS.index(card[0].upper()) * 4 + CARD_SUITS.index(card[1].lower())


def engine_combo_str(combo: str) -> str:
    """A combo spelled the way the engine spells it: higher card code first.

    Load-bearing for the two payloads. Pio's show_hand_order need not agree
    with the engine on which card it writes first, and the frontend joins the
    two files BY HAND STRING - so both sides have to canonicalize through one
    rule or the join silently matches nothing."""
    a, b = combo[0:2], combo[2:4]
    a = a[0].upper() + a[1].lower()
    b = b[0].upper() + b[1].lower()
    return a + b if _card_code(a) > _card_code(b) else b + a


def _finite(value):
    """Non-finite (Pio emits nan on off-path hands) and missing -> None."""
    return value if value is not None and math.isfinite(value) else None


def print_cost_line(meta: dict, pio_timing: dict) -> None:
    """Head-to-head solve time and peak memory, whichever sides ran."""
    ht_solve_s = meta.get("wall_time_s")
    pio_solve_s = pio_timing.get("solve_s")
    if ht_solve_s is not None:
        line = (f"solve time: htsolver {ht_solve_s:.2f} s on "
                f"{meta.get('threads', '?')} thread(s), {meta['iterations']} iters")
        if pio_solve_s is not None:
            ratio = (pio_solve_s / ht_solve_s) if ht_solve_s > 0 else float("inf")
            line += f"  |  pio {pio_solve_s:.2f} s  ->  {ratio:.1f}x"
        else:
            line += "  |  pio not run"
        print(line)

    ht_peak = meta.get("peak_rss_bytes")
    pio_peak = pio_timing.get("peak_bytes")
    if ht_peak or pio_peak:
        mb = lambda b: "n/a" if not b else f"{b / (1024 ** 2):.0f} MB"
        line = f"peak memory: htsolver {mb(ht_peak)}  |  pio {mb(pio_peak)}"
        if ht_peak and pio_peak:
            line += f"  ->  {pio_peak / ht_peak:.1f}x"
        print(line)


def load_engine_meta(args) -> dict:
    """Just the artifact metadata - cheap, and enough to pick the compare
    mode before materializing a dump (a full flop dump is gigabytes)."""
    if args.dump:
        with open(args.dump, "r", encoding="utf8") as f:
            return json.load(f)["metadata"]
    out = subprocess.run(
        [args.engine_exe, "dump-json", args.artifact, "--meta-only"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def load_engine_dump(args, runouts) -> dict:
    """The per-node dump; `runouts` (None = full) makes the engine emit only
    that many evenly spaced cards per chance node - same sampling rule the
    old harness applied, now engine-side so big trees never materialize.

    The harness never needs a full dump: it reads the actor seat's hands and
    the root's reaches, and nothing else. So it always asks for a trimmed
    diet written to a file - `detail` (which adds the per-hand EVs only
    htsolver's own payload needs) when --ht-out is requested, `gate` otherwise.
    A full turn dump is ~680MB of pretty-printed text through a pipe;
    `detail` is ~140MB and `gate` ~78MB, both without the pipe capture."""
    fields = "detail" if args.ht_out else "gate"
    if args.dump:
        with open(args.dump, "r", encoding="utf8") as f:
            dump = json.load(f)
    else:
        out_path = f"{args.artifact}.{fields}_dump.json"
        cmd = [args.engine_exe, "dump-json", args.artifact,
               "--compact", "--fields", fields, "--out", out_path]
        if runouts is not None:
            cmd += ["--runouts", str(runouts)]
        try:
            subprocess.run(cmd, capture_output=True, text=True, check=True)
            with open(out_path, "rb") as f:
                dump = json.load(f)
        finally:
            try:
                os.remove(out_path)
            except OSError:
                pass
    if args.ht_out and dump.get("metadata", {}).get("dump_fields") == "gate":
        raise SystemExit("this dump has no per-hand EVs (--fields gate); re-dump with "
                         "--fields detail, or drop --ht-out")
    return dump


CARD_RANKS = "23456789TJQKA"
CARD_SUITS = "cdhs"


def card_str(code) -> str:
    """Engine card code (rank*4+suit) or dump-json card string -> 'As'."""
    if isinstance(code, str):
        return code
    return CARD_RANKS[code // 4] + CARD_SUITS[code % 4]


def engine_colon_ids(nodes: Dict[str, dict]) -> Dict[str, str]:
    """Rebuild Pio-style colon ids from the node table (root = 'r:0').
    Deal edges become card segments ('As'), matching Pio's node ids."""

    def label(node: dict) -> str:
        kind = node["action_kind"]
        if kind == "fold":
            return "f"
        if kind == "check_call":
            return "c"
        if kind == "bet":
            return f"b{node['action_amount']}"
        if kind == "deal":
            return card_str(node["dealt_card"])
        raise ValueError(f"unexpected action kind {kind}")

    ids: Dict[str, str] = {}
    order = sorted(nodes.keys(), key=int)
    ids[order[0]] = "r:0"
    for key in order[1:]:
        node = nodes[key]
        ids[key] = ids[str(node["parent_id"])] + ":" + label(node)
    return ids


CARD_SEG = frozenset(
    r + s for r in CARD_RANKS for s in CARD_SUITS)


def betting_skeleton(colon_id: str) -> str:
    """Node id with card segments dropped - Pio's show_all_lines shape."""
    return ":".join(seg for seg in colon_id.split(":") if seg not in CARD_SEG)


def showdown_lines(nodes: Dict[str, dict]) -> List[List[int]]:
    """Pio add_line encoding of the engine tree: one line per showdown
    BETTING sequence, one token per betting action along its path. The token
    is the actor's hand-cumulative postflop total after the action - which is
    exactly the engine's action_amount for every action kind: a check repeats
    the current total (0 at zero commit), a call is the matched total, a bet
    the bNNN amount. Deal edges are skipped (Pio inserts chance nodes
    itself), so many runout terminals share one line; lines are deduped.
    Verified empirically 2026-08-25: "0 50 50 0 0" is rejected ("incorrect
    bet size") and can crash Pio; "0 50 50 50 50" builds the right tree."""
    unique = set()
    for key, node in nodes.items():
        if node.get("terminal") != "showdown":
            continue
        path: List[int] = []
        cur = node
        while cur["parent_id"] is not None:
            if cur["action_kind"] in ("bet", "check_call"):
                path.append(int(cur["action_amount"]))
            cur = nodes[str(cur["parent_id"])]
        path.reverse()
        unique.add(tuple(path))
    return sorted(list(line) for line in unique)


def solve_in_pio(solver, dump: dict, meta: dict, accuracy_chips: float,
                 dump_cfr) -> dict:
    """Build the engine's exact tree in Pio via UPI and solve it to
    `accuracy_chips` ("exploitable for", per player). The tree is validated
    node-for-node against the engine's before solving.

    Returns the wall-clock split, so the report can put Pio's solve time next
    to the engine's. Tree building is timed separately from `go`: the engine
    reports its own setup and solve times apart for the same reason, and
    lumping them together would flatter whichever solver builds faster."""
    board = "".join(meta["board"].split())
    pot = int(meta["pot"])
    eff = int(meta["effective_stack"])
    print(f"solve-pio: building {board} pot={pot} eff={eff} "
          f"accuracy={accuracy_chips:g} chips")
    pid = solver.process.pid
    baseline_bytes, _ = _memory_counters(pid)
    build_start = time.perf_counter()
    solver._run("set_board", board)
    solver._run("set_pot", "0", "0", str(pot))
    solver._run("set_eff_stack", str(eff))
    solver._run("set_isomorphism", "0", "0")

    pio_order = solver.show_hand_order()
    pio_index = {normalize_combo(h): i for i, h in enumerate(pio_order)}
    root = dump["nodes"]["0"]["data"]
    for seat in (0, 1):
        weights = [0.0] * len(pio_order)
        for hand in root["seats"][seat]["hands"]:
            idx = pio_index.get(normalize_combo(hand["hand"]))
            if idx is not None:
                weights[idx] = hand["reach"]
        solver._run("set_range", str(seat), *[f"{w:.6f}" for w in weights])

    solver.clear_lines()
    for line in showdown_lines(dump["nodes"]):
        resp = solver.add_line(line)
        if "ERROR" in resp:
            # Never keep poking a wounded Pio: a rejected line means the
            # encoding is wrong, and further commands can crash the process.
            raise RuntimeError(f"Pio rejected add_line {line}: {resp.strip()}")
    solver._run("build_tree")

    # The whole comparison assumes identical trees - verify, don't hope.
    # show_all_lines lists the BETTING skeleton (no card segments), so
    # compare against the engine tree with deal segments stripped.
    pio_nodes = {ln.strip() for ln in solver.show_all_lines() if ln.strip()}
    engine_nodes = {betting_skeleton(cid)
                    for cid in engine_colon_ids(dump["nodes"]).values()} | {"r"}
    if pio_nodes != engine_nodes:
        raise RuntimeError(
            "tree mismatch after build_tree:\n"
            f"  only in pio:    {sorted(pio_nodes - engine_nodes)[:10]}\n"
            f"  only in engine: {sorted(engine_nodes - pio_nodes)[:10]}")
    print(f"solve-pio: tree verified ({len(pio_nodes)} betting nodes), solving...")

    build_s = time.perf_counter() - build_start

    solver.set_accuracy(accuracy_chips)
    solve_start = time.perf_counter()
    solver.go(quiet=True)
    solve_s = time.perf_counter() - solve_start
    # Read the peak BEFORE the cross-check uploads a strategy into Pio: this
    # is meant to be the cost of building and solving the tree, not of the
    # harness poking at it afterwards.
    _, peak_bytes = _memory_counters(pid)
    print(f"solve-pio: solved in {solve_s:.2f} s (tree build {build_s:.2f} s)"
          + (f", peak {peak_bytes / (1024 ** 2):.0f} MB" if peak_bytes else ""))
    if dump_cfr:
        solver.dump_tree(os.path.abspath(dump_cfr), "full")
        print(f"solve-pio: dumped {dump_cfr}")
    return {"solve_s": round(solve_s, 3), "setup_s": round(build_s, 3),
            "peak_bytes": peak_bytes, "baseline_bytes": baseline_bytes}


def engine_labels_of(dump: dict, node: dict) -> List[str]:
    """This node's action labels, in the engine's own child order.

    Purely engine-side: the child records carry the kind and amount, so this
    works with no solver attached."""
    children = dump["nodes"]
    labels: List[str] = []
    first = node["first_child"]
    for c in range(node["num_children"]):
        child = children[str(first + c)]
        kind = child["action_kind"]
        labels.append("f" if kind == "fold" else "c" if kind == "check_call"
                      else f"b{child['action_amount']}")
    return labels


def decision_nodes(dump: dict):
    """(key, node) for every decision node, in engine node order."""
    for key, node in sorted(dump["nodes"].items(), key=lambda kv: int(kv[0])):
        if node["kind"] == "decision":
            yield key, node


def extract_ht_nodes(dump: dict, colon_ids: Dict[str, str], writer: HtcWriter) -> int:
    """htsolver's per-hand rows, straight out of the engine dump.

    No Pio anywhere in here - that is the whole point. The artifact is
    already sparse on reach > 1e-6 (artifact_writer applies the same rule),
    so the reach guard below is the only filter, and it is a belt-and-braces
    re-application rather than a second opinion."""
    count = 0
    for key, node in decision_nodes(dump):
        data = node["data"]
        actor = data["actor"]
        labels = engine_labels_of(dump, node)
        rows = []
        for hand in data["seats"][actor]["hands"]:
            reach = hand["reach"]
            if reach <= 1e-6:
                continue
            rows.append({
                "hand": hand["hand"],
                "reach": reach,
                "freq": hand["strategy"],
                "ev": _finite(hand.get("ev")),
                "action_ev": [_finite(v) for v in hand.get("action_ev", [])],
            })
        if not rows:
            continue
        writer.add_node(colon_ids[key], "OOP" if actor == 0 else "IP", labels, rows)
        count += 1
    return count


def build_strategy_upload(solver, dump: dict, colon_ids: Dict[str, str],
                          pio_index: Dict[Tuple[str, str], int],
                          pio_order: List[str]) -> List[Tuple[str, List[List[float]]]]:
    """The engine's strategy re-expressed on Pio's grid, for the cross-check.

    Returns (pio_id, rows) with rows[pio_action_row][pio_hand_index]. This is
    the one place the engine's action order has to be mapped onto Pio's."""
    upload: List[Tuple[str, List[List[float]]]] = []
    for key, node in decision_nodes(dump):
        pio_id = colon_ids[key]
        data = node["data"]
        actor = data["actor"]
        pio_actions = solver.show_children_actions(pio_id)
        if pio_actions is None:
            print(f"  WARNING: Pio has no node {pio_id} - tree mismatch, skipping")
            continue
        labels = engine_labels_of(dump, node)
        if sorted(pio_actions) != sorted(labels):
            print(f"  WARNING: action mismatch at {pio_id}: engine={labels} "
                  f"pio={pio_actions} - tree mismatch, skipping")
            continue
        row_of = {label: i for i, label in enumerate(pio_actions)}
        # Default rows: uniform. Hands absent from the engine's sparse arrays
        # carry reach <= 1e-6 under the engine profile, so their strategy
        # contributes nothing to the profile's exploitability.
        num_actions = len(labels)
        rows = [[1.0 / num_actions] * len(pio_order) for _ in range(num_actions)]
        for hand in data["seats"][actor]["hands"]:
            idx = pio_index.get(normalize_combo(hand["hand"]))
            if idx is None:
                continue
            for k in range(num_actions):
                rows[row_of[labels[k]]][idx] = hand["strategy"][k]
        upload.append((pio_id, rows))
    return upload


def extract_pio_nodes(solver, dump: dict, colon_ids: Dict[str, str],
                      pio_order: List[str], writer: HtcWriter) -> int:
    """PioSolver's per-hand rows, node by node over UPI.

    This is the expensive pass: 4 + num_actions round trips per node. Rows are
    driven by PIO's own hand order and reach, so its file describes its own
    range rather than being filtered through the engine's."""
    count = 0
    for key, node in decision_nodes(dump):
        pio_id = colon_ids[key]
        data = node["data"]
        position = "OOP" if data["actor"] == 0 else "IP"
        pio_actions = solver.show_children_actions(pio_id)
        if pio_actions is None:
            continue
        labels = engine_labels_of(dump, node)
        if sorted(pio_actions) != sorted(labels):
            continue
        row_of = {label: i for i, label in enumerate(pio_actions)}

        strategy = solver.show_strategy(pio_id)
        evs, matchups = solver.calc_ev(position, pio_id)
        reaches = solver.show_range(position, pio_id) or []
        # Per-action EVs: the actor's calc_ev at each child. Fold terminals
        # may not answer - None row.
        action_evs = []
        for label in labels:
            try:
                child_evs, _ = solver.calc_ev(position, f"{pio_id}:{label}")
                action_evs.append(child_evs)
            except Exception:
                action_evs.append(None)

        rows = []
        for idx, combo in enumerate(pio_order):
            reach = reaches[idx] if idx < len(reaches) else 0.0
            if reach <= 1e-6:
                continue
            # A hand Pio has no matchups for is off-path for it: its EV is
            # conditioned on a zero-probability event and is meaningless.
            if idx < len(matchups) and matchups[idx] <= 0:
                continue
            rows.append({
                "hand": engine_combo_str(combo),
                "reach": reach,
                "freq": [strategy[row_of[labels[k]]][idx] for k in range(len(labels))],
                "ev": _finite(evs[idx]) if idx < len(evs) else None,
                "action_ev": [
                    _finite(row[idx]) if row is not None and idx < len(row) else None
                    for row in action_evs
                ],
            })
        if not rows:
            continue
        writer.add_node(pio_id, position, labels, rows)
        count += 1
    return count


def run_cross_check(solver, strategy_upload) -> Dict[str, float]:
    """Load the engine's strategy into Pio and ask Pio how exploitable it is.

    Do NOT lock_node here: locked nodes are excluded from Pio's MES
    (best-response) search, so calc_results would report MES == EV and
    exploitability would always read 0.000 - a false pass. Verified
    empirically: a garbage strategy reads 91.7 unlocked, 0.000 locked.
    Nothing recalculates between set_strategy and calc_results (we never
    call `go`)."""
    print(f"\ncross-check: loading the engine strategy into Pio "
          f"({len(strategy_upload)} nodes)...")
    for pio_id, rows in strategy_upload:
        values = [f"{v:.6f}" for row in rows for v in row]
        solver.set_strategy(pio_id, *values)
    return parse_calc_results(solver._run("calc_results"))


def parse_calc_results(raw: str) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for line in raw.splitlines():
        if ":" in line:
            label, _, value = line.partition(":")
            try:
                out[label.strip()] = float(value.strip())
            except ValueError:
                pass
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--artifact", help="engine .hta artifact")
    parser.add_argument("--dump", help="pre-dumped engine JSON (skips dump-json)")
    parser.add_argument("--cfr", help="Pio .cfr solved for the same spot")
    parser.add_argument("--solve-pio", action="store_true",
                        help="no .cfr needed: build the engine's exact tree in Pio via "
                             "UPI (validated node-for-node) and solve it now")
    parser.add_argument("--pio-accuracy-pct", type=float, default=0.02,
                        help="--solve-pio: Pio accuracy ('exploitable for') as %% of the "
                             "pot (PioViewer's default 0.02)")
    parser.add_argument("--dump-cfr", help="--solve-pio: also save the solved tree here")
    parser.add_argument("--engine-exe", default=os.path.join("..", "engine", "build", "engine.exe"))
    parser.add_argument("--pio-dir", default=DEFAULT_PIO_DIR)
    parser.add_argument("--pio-exe", default=DEFAULT_PIO_EXE)
    parser.add_argument("--exploit-threshold-frac", type=float, default=0.005,
                        help="gate: max exploitability of the engine strategy as measured "
                             "by Pio, as a fraction of the pot (also the sampled-mode "
                             "root-EV tolerance)")
    parser.add_argument("--ht-out",
                        help="write htsolver's per-hand payload here (.htc). Needs no "
                             "Pio at all - the rows come straight out of the engine dump")
    parser.add_argument("--pio-out",
                        help="write PioSolver's payload here (.htc). Carries its summary "
                             "always; per-hand rows only with --pio-detail")
    parser.add_argument("--pio-detail", action="store_true",
                        help="extract Pio's per-hand rows (4+actions UPI round trips per "
                             "node). The slow part of a comparison run")
    parser.add_argument("--cross-check", action="store_true",
                        help="run the cross-exploitability gate: load the engine strategy "
                             "into Pio and let Pio rate it. The primary correctness "
                             "statement, full trees only. Off by default")
    parser.add_argument("--full-limit", type=int, default=2500,
                        help="max decision nodes for FULL mode (whole-tree dump + "
                             "cross-exploitability). Bigger trees switch to sampled "
                             "runouts")
    parser.add_argument("--runouts", type=int, default=3,
                        help="sampled mode: cards followed per chance node (evenly spaced, "
                             "deterministic)")
    args = parser.parse_args()

    pio_enabled = bool(args.solve_pio or args.cfr)
    if not args.artifact and not args.dump:
        parser.error("need --artifact or --dump")
    if not args.ht_out and not pio_enabled:
        parser.error("nothing to do: give --ht-out, and/or --solve-pio/--cfr for Pio")
    if (args.pio_out or args.pio_detail or args.cross_check) and not pio_enabled:
        parser.error("--pio-out/--pio-detail/--cross-check need --solve-pio or --cfr")
    if args.cfr and not os.path.exists(args.cfr):
        # Pio's load_tree never responds for a missing file - fail fast here.
        parser.error(f"--cfr file not found: {args.cfr}")

    # Harness phase wall times; lands in summary.timing so the /compare
    # pipeline panel can show where the non-solve time goes.
    harness_timing: Dict[str, float] = {}
    results: Dict[str, float] = {}
    engine_results: Dict[str, float] = {}
    pio_timing = {"solve_s": None, "setup_s": None,
                  "peak_bytes": None, "baseline_bytes": None}
    solver = None
    cross_ran = False
    ht_nodes = 0
    pio_nodes = 0

    phase_start = time.perf_counter()
    meta = load_engine_meta(args)
    harness_timing["meta_load_s"] = time.perf_counter() - phase_start

    # --- Refuse non-Nash artifacts outright. -----------------------------
    if meta.get("mode") != "nash" or meta.get("lambda") is not None:
        print("REFUSING to compare: this artifact is a QRE solve "
              f"(mode={meta.get('mode')!r}, lambda={meta.get('lambda')!r}).\n"
              "A QRE solve deliberately deviates from Nash and will not - and should "
              "not - match PioSolver. Re-solve with qre.mode = \"nash\".")
        return 2

    decision_count = int(meta.get("decision_node_count", 0))
    full_mode = decision_count <= args.full_limit
    if not full_mode:
        print(f"SAMPLED MODE: {decision_count} decision nodes exceed --full-limit "
              f"{args.full_limit}. The engine dump follows {args.runouts} evenly "
              f"spaced cards per chance node. The cross-exploitability check is "
              f"SKIPPED (it needs the full strategy in Pio), so the gate falls back "
              f"to root-EV agreement.")
    phase_start = time.perf_counter()
    dump = load_engine_dump(args, None if full_mode else args.runouts)
    harness_timing["dump_load_s"] = time.perf_counter() - phase_start
    print(f"engine dump loaded in {harness_timing['dump_load_s']:.2f} s")

    pot = float(meta["pot"])
    print(f"spot: board={meta['board']!r} pot={pot} config={meta['config_hash'][:10]}")
    print(f"engine: iters={meta['iterations']} nashconv={meta['final_nashconv']:.4f} "
          f"ev={meta['ev_chips']}")

    colon_ids = engine_colon_ids(dump["nodes"])
    spot_block = {
        "board": meta["board"],
        "pot": pot,
        "chip_scale": meta.get("chip_scale", 100),
        "config_hash": meta["config_hash"],
    }
    exploit_threshold = max(pot * args.exploit_threshold_frac, 1e-4)

    # --- htsolver's own payload: no Pio involved. ------------------------
    if args.ht_out:
        phase_start = time.perf_counter()
        ht_writer = HtcWriter("ht")
        ht_nodes = extract_ht_nodes(dump, colon_ids, ht_writer)
        harness_timing["ht_extract_s"] = time.perf_counter() - phase_start
        if ht_nodes == 0:
            print("FAIL: the engine dump has no decision nodes with reachable hands")
            return 1
        size = ht_writer.write(args.ht_out, spot_block, {
            "solver": "ht",
            "ht": {
                "iterations": meta["iterations"],
                "nashconv": meta["final_nashconv"],
                "exploitable_chips": meta.get("final_exploitable_chips",
                                              meta["final_nashconv"] / 2.0),
                "exploitable_pct_pot": meta.get("final_exploitable_pct_pot"),
                "ev": meta["ev_chips"],
            },
            "timing": {
                "ht_solve_s": meta.get("wall_time_s"),
                "ht_setup_s": meta.get("setup_time_s"),
                "ht_threads": meta.get("threads"),
                "ht_iterations": meta["iterations"],
                **{k: round(v, 3) for k, v in harness_timing.items()},
            },
            "memory": {"ht_peak_bytes": meta.get("peak_rss_bytes")},
            "sampled": not full_mode,
            "runouts": None if full_mode else args.runouts,
            "decision_nodes": decision_count,
            "detail_nodes": ht_nodes,
        })
        print(f"wrote htsolver payload: {args.ht_out} "
              f"({size / 1e6:.1f} MB, {ht_nodes} nodes)")

    if not pio_enabled:
        print_cost_line(meta, pio_timing)
        print("\nno verdict: PioSolver disabled (pass --solve-pio or --cfr for a gate)")
        return 0

    # --- Pio: solve, optionally extract per-hand rows, optionally gate. ---
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from pyosolver import PYOSolver  # noqa: E402

    # PIO_LOG=<path> logs the full UPI dialogue for debugging hangs.
    phase_start = time.perf_counter()
    solver = PYOSolver(args.pio_dir, args.pio_exe, log_file=os.environ.get("PIO_LOG"))
    harness_timing["pio_spawn_s"] = time.perf_counter() - phase_start
    pio_writer = HtcWriter("pio")
    try:
        if args.solve_pio:
            pio_timing = solve_in_pio(
                solver, dump, meta,
                accuracy_chips=max(args.pio_accuracy_pct / 100.0 * pot, 1e-4),
                dump_cfr=args.dump_cfr)
        else:
            # A pre-solved .cfr carries no timing - it was solved elsewhere.
            solver.load_tree(os.path.abspath(args.cfr))
        pio_order = solver.show_hand_order()
        pio_index = {normalize_combo(h): i for i, h in enumerate(pio_order)}

        results = parse_calc_results(solver._run("calc_results"))
        print(f"pio:    ev_oop={results.get('EV OOP')} ev_ip={results.get('EV IP')} "
              f"exploitable={results.get('Exploitable for')}")

        if args.pio_detail:
            phase_start = time.perf_counter()
            pio_nodes = extract_pio_nodes(solver, dump, colon_ids, pio_order, pio_writer)
            harness_timing["pio_extract_s"] = time.perf_counter() - phase_start
            print(f"pio per-hand rows: {harness_timing['pio_extract_s']:.2f} s "
                  f"({pio_nodes} nodes)")
            if pio_nodes == 0:
                print("FAIL: no nodes lined up between the two trees")
                return 1

        if args.cross_check and full_mode:
            phase_start = time.perf_counter()
            upload = build_strategy_upload(solver, dump, colon_ids, pio_index, pio_order)
            engine_results = run_cross_check(solver, upload)
            harness_timing["cross_check_s"] = time.perf_counter() - phase_start
            cross_ran = True
            print(f"cross-check: {harness_timing['cross_check_s']:.2f} s")
        elif args.cross_check:
            print("NOTE: sampled tree, so cross-exploitability is skipped "
                  "(it needs the full strategy in Pio); the gate falls back to root EV.")
    finally:
        if solver is not None:
            # Never use solver._run("exit"): Pio quits without emitting the END
            # marker, so _run spins forever on EOF. Ask politely, then kill -
            # the same shape as extraction.close_solver.
            try:
                solver.process.stdin.write("exit\n")
                solver.process.stdin.flush()
            except Exception:
                pass
            try:
                solver.process.kill()
            except Exception:
                pass

    # --- Verdict. ---------------------------------------------------------
    exploit_engine = engine_results.get("Exploitable for")
    exploit_pio = results.get("Exploitable for")
    root_ev_diff = (abs(meta["ev_chips"][0] - results["EV OOP"])
                    if results.get("EV OOP") is not None else None)
    if cross_ran:
        gate = "cross_exploitability"
        gate_pass = exploit_engine is not None and exploit_engine <= exploit_threshold
        print(f"\nexploitability per Pio:  pio's own solve {exploit_pio}  "
              f"ENGINE strategy {exploit_engine}  (threshold {exploit_threshold:.3f})")
        print(f"engine EVs per Pio:      ev_oop={engine_results.get('EV OOP')} "
              f"ev_ip={engine_results.get('EV IP')}")
    elif args.cross_check:
        # Asked for, but sampled mode cannot supply it - root EV decides.
        gate = "root_ev"
        gate_pass = root_ev_diff is not None and root_ev_diff <= exploit_threshold
        print(f"\nroot EV: engine {meta['ev_chips'][0]:.3f} vs pio {results.get('EV OOP')}"
              f"  |diff| {root_ev_diff if root_ev_diff is None else round(root_ev_diff, 3)}"
              f"  (threshold {exploit_threshold:.3f})")
    else:
        gate = "none"
        gate_pass = None
        print(f"\nroot EV: engine {meta['ev_chips'][0]:.3f} vs pio {results.get('EV OOP')}"
              f"  |diff| {root_ev_diff if root_ev_diff is None else round(root_ev_diff, 3)}"
              f"   (no gate: --cross-check not requested)")

    print_cost_line(meta, pio_timing)

    if args.pio_out:
        size = pio_writer.write(args.pio_out, spot_block, {
            "solver": "pio",
            "source": (f"solve-pio @ {args.pio_accuracy_pct:g}% pot" if args.solve_pio
                       else os.path.basename(args.cfr)),
            "pio": {
                "ev_oop": results.get("EV OOP"),
                "ev_ip": results.get("EV IP"),
                "exploitable": exploit_pio,
            },
            "cross_check": {
                "gate": gate,
                "ht_exploitable_per_pio": exploit_engine,
                "ht_ev_per_pio": [engine_results.get("EV OOP"),
                                  engine_results.get("EV IP")],
                "root_ev_diff": None if root_ev_diff is None else round(root_ev_diff, 3),
                "threshold": exploit_threshold,
                # None, not False: "no gate ran" is not "the gate failed".
                "pass": gate_pass,
            },
            "timing": {
                "pio_solve_s": pio_timing.get("solve_s"),
                "pio_setup_s": pio_timing.get("setup_s"),
                "accuracy_chips": round(max(args.pio_accuracy_pct / 100.0 * pot, 1e-4), 4),
                **{k: round(v, 3) for k, v in harness_timing.items()
                   if k.startswith("pio_") or k == "cross_check_s"},
            },
            "memory": {
                "pio_peak_bytes": pio_timing.get("peak_bytes"),
                "pio_baseline_bytes": pio_timing.get("baseline_bytes"),
            },
            "detail_nodes": pio_nodes,
        })
        print(f"wrote PioSolver payload: {args.pio_out} "
              f"({size / 1e6:.1f} MB, {pio_nodes} nodes)")

    if gate_pass is None:
        print("\nno verdict: --cross-check not requested")
        return 0
    if not gate_pass:
        if gate == "cross_exploitability":
            if exploit_engine is None:
                print("\nFAIL: Pio did not report exploitability for the engine strategy")
            else:
                print(f"\nFAIL: the engine strategy is exploitable for {exploit_engine} "
                      f"chips per Pio (> {exploit_threshold:.3f})")
        else:
            if root_ev_diff is None:
                print("\nFAIL: Pio did not report a root EV to compare against")
            else:
                print(f"\nFAIL (sampled mode): root EVs differ by {root_ev_diff:.3f} "
                      f"chips (> {exploit_threshold:.3f})")
        return 1
    print("\nPASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
