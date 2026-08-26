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

The PRIMARY pass/fail gate is cross-exploitability: the engine's strategy is
loaded into Pio (set_strategy + lock_node on every decision node) and Pio's
own evaluator reports how exploitable that profile is. This is the only
metric that is meaningful when the two solvers land on different equilibria -
2p zero-sum games have a unique value but many equilibria, and indifference
regions (bluff-catchers, mixed sizings) are huge in symmetric spots.

Also reported as diagnostics: reach-weighted per-hand L1 on action
frequencies and per-hand EV differences (chips), with the worst-offending
hands printed when they exceed their thresholds - that is what makes a real
failure debuggable.

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
    old harness applied, now engine-side so big trees never materialize."""
    if args.dump:
        with open(args.dump, "r", encoding="utf8") as f:
            return json.load(f)
    cmd = [args.engine_exe, "dump-json", args.artifact]
    if runouts is not None:
        cmd += ["--runouts", str(runouts)]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


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
                        help="PRIMARY GATE: max exploitability of the engine strategy as "
                             "measured by Pio, as a fraction of the pot")
    parser.add_argument("--l1-threshold", type=float, default=0.02,
                        help="diagnostic: reach-weighted mean per-hand L1 on action frequencies")
    parser.add_argument("--ev-threshold-frac", type=float, default=0.004,
                        help="diagnostic: reach-weighted mean |EV diff| as a fraction of the pot")
    parser.add_argument("--top", type=int, default=20, help="worst offenders to print")
    parser.add_argument("--full-limit", type=int, default=2500,
                        help="max decision nodes for FULL mode (per-node compare of every "
                             "node + cross-exploitability). Bigger trees switch to sampled "
                             "runouts")
    parser.add_argument("--runouts", type=int, default=3,
                        help="sampled mode: cards followed per chance node (evenly spaced, "
                             "deterministic)")
    parser.add_argument("--json-out",
                        help="write the per-hand comparison to this JSON file "
                             "(the input for the frontend's hidden /compare page)")
    parser.add_argument("--json-max-nodes", type=int, default=250,
                        help="cap per-hand detail in --json-out to the N most-reached "
                             "nodes (metrics still cover every compared node; a full "
                             "turn tree's detail is >100MB otherwise)")
    args = parser.parse_args()
    if not args.artifact and not args.dump:
        parser.error("need --artifact or --dump")
    if not args.cfr and not args.solve_pio:
        parser.error("need --cfr (a solved Pio tree) or --solve-pio")
    if args.cfr and not os.path.exists(args.cfr):
        # Pio's load_tree never responds for a missing file - fail fast here.
        parser.error(f"--cfr file not found: {args.cfr}")

    meta = load_engine_meta(args)

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
              f"{args.full_limit}. The engine dump and the comparison follow "
              f"{args.runouts} evenly spaced cards per chance node. Per-hand numbers "
              f"are diagnostics on those runouts; the cross-exploitability check is "
              f"SKIPPED (it needs the full strategy in Pio), so the gate is root-EV "
              f"agreement only.")
    dump = load_engine_dump(args, None if full_mode else args.runouts)

    pot = float(meta["pot"])
    print(f"spot: board={meta['board']!r} pot={pot} config={meta['config_hash'][:10]}")
    print(f"engine: iters={meta['iterations']} nashconv={meta['final_nashconv']:.4f} "
          f"ev={meta['ev_chips']}")

    # --- Spawn Pio and load the .cfr. ------------------------------------
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from pyosolver import PYOSolver  # noqa: E402

    # PIO_LOG=<path> logs the full UPI dialogue for debugging hangs.
    solver = PYOSolver(args.pio_dir, args.pio_exe, log_file=os.environ.get("PIO_LOG"))
    pio_timing = {"solve_s": None, "setup_s": None,
                  "peak_bytes": None, "baseline_bytes": None}
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

        results = {}
        raw = solver._run("calc_results")
        for line in raw.splitlines():
            if ":" in line:
                label, _, value = line.partition(":")
                try:
                    results[label.strip()] = float(value.strip())
                except ValueError:
                    pass
        print(f"pio:    ev_oop={results.get('EV OOP')} ev_ip={results.get('EV IP')} "
              f"exploitable={results.get('Exploitable for')}")

        colon_ids = engine_colon_ids(dump["nodes"])

        offenders: List[dict] = []
        gfreq_failures: List[str] = []
        weighted_l1_sum = 0.0
        weighted_ev_sum = 0.0
        weight_total = 0.0
        nodes_compared = 0
        # Engine strategy re-expressed on Pio's grid, for the cross-check:
        # (pio_id, rows), rows[pio_action_row][pio_hand_index].
        strategy_upload: List[Tuple[str, List[List[float]]]] = []
        # Full per-hand comparison rows for --json-out / the /compare page.
        compare_nodes: List[dict] = []

        for key, node in sorted(dump["nodes"].items(), key=lambda kv: int(kv[0])):
            if node["kind"] != "decision":
                continue
            pio_id = colon_ids[key]
            data = node["data"]
            actor = data["actor"]
            position = "OOP" if actor == 0 else "IP"

            pio_actions = solver.show_children_actions(pio_id)
            if pio_actions is None:
                print(f"  WARNING: Pio has no node {pio_id} - tree mismatch, skipping")
                continue
            children = dump["nodes"]
            engine_labels = []
            first = node["first_child"]
            for c in range(node["num_children"]):
                child = children[str(first + c)]
                kind = child["action_kind"]
                engine_labels.append(
                    "f" if kind == "fold" else "c" if kind == "check_call"
                    else f"b{child['action_amount']}")
            if sorted(pio_actions) != sorted(engine_labels):
                print(f"  WARNING: action mismatch at {pio_id}: engine={engine_labels} "
                      f"pio={pio_actions} - tree mismatch, skipping")
                continue
            row_of = {label: i for i, label in enumerate(pio_actions)}

            pio_strategy = solver.show_strategy(pio_id)
            pio_evs, pio_matchups = solver.calc_ev(position, pio_id)
            # Pio's OWN reach for the actor at this node. Load-bearing for
            # the diagnostics: a (node, hand) that Pio never reaches is
            # off-path for Pio, where BOTH its strategy (unconstrained in an
            # equilibrium) and its calc_ev (conditioned on a zero-probability
            # event, and observed returning things like -381 chips) are
            # meaningless. The engine reaching it instead is exactly what
            # picking a different equilibrium looks like, not a bug.
            pio_reach = solver.show_range(position, pio_id) or []
            # How often this node is actually reached (Pio's global line
            # frequency). Without it the diagnostics drown in noise from
            # never-taken lines.
            #
            # A failure here used to be swallowed into 0.0, which is the same
            # value a genuinely unreachable node has. When UPI hiccuped and
            # every node came back 0, the run died downstream with "nothing
            # compared (tree mismatch everywhere?)" - a wrong and very
            # expensive diagnosis. Count them instead and say so.
            try:
                global_freq = solver.calc_global_freq(pio_id)
            except Exception as e:
                global_freq = 0.0
                gfreq_failures.append(f"{pio_id}: {type(e).__name__}: {e}")
            nodes_compared += 1

            # Per-action EVs: the actor's calc_ev at each child (the watcher's
            # action_evs convention). Fold terminals may not answer - None row.
            pio_action_evs = []
            for k in range(len(engine_labels)):
                try:
                    child_evs, _ = solver.calc_ev(position, f"{pio_id}:{engine_labels[k]}")
                    pio_action_evs.append(child_evs)
                except Exception:
                    pio_action_evs.append(None)

            # Default rows: uniform. Hands absent from the engine's sparse
            # arrays carry reach <= 1e-6 under the engine profile, so their
            # strategy contributes nothing to the profile's exploitability.
            num_actions = len(engine_labels)
            rows = [[1.0 / num_actions] * len(pio_order) for _ in range(num_actions)]
            for hand in data["seats"][actor]["hands"]:
                idx = pio_index.get(normalize_combo(hand["hand"]))
                if idx is None:
                    continue
                for k in range(num_actions):
                    rows[row_of[engine_labels[k]]][idx] = hand["strategy"][k]
            strategy_upload.append((pio_id, rows))

            compare_hands: List[dict] = []
            compare_nodes.append({
                "id": pio_id,
                "actor": actor,
                "position": position,
                "actions": engine_labels,
                "global_freq": round(global_freq, 6),
                "hands": compare_hands,
            })

            for hand in data["seats"][actor]["hands"]:
                idx = pio_index.get(normalize_combo(hand["hand"]))
                if idx is None:
                    continue
                if pio_matchups[idx] <= 0:
                    continue
                reach = hand["reach"]
                if reach <= 1e-6:
                    continue
                l1 = sum(
                    abs(hand["strategy"][k] - pio_strategy[row_of[engine_labels[k]]][idx])
                    for k in range(len(engine_labels)))
                pio_ev = pio_evs[idx]
                ev_diff = (hand["ev"] - pio_ev) if math.isfinite(pio_ev) else float("nan")
                # Weight by the probability this (node, hand) is ON-PATH for
                # BOTH solvers: node frequency x the smaller of the two
                # reaches. Off-path for either side means that side's numbers
                # are undefined there, so comparing them measures equilibrium
                # choice, not correctness.
                p_reach = pio_reach[idx] if idx < len(pio_reach) else 0.0
                weight = global_freq * min(reach, p_reach)
                weighted_l1_sum += weight * l1
                if math.isfinite(ev_diff):
                    weighted_ev_sum += weight * abs(ev_diff)
                weight_total += weight
                pio_freqs = [pio_strategy[row_of[engine_labels[k]]][idx]
                             for k in range(len(engine_labels))]
                offenders.append({
                    "node": pio_id, "hand": hand["hand"], "reach": reach,
                    "pio_reach": p_reach, "weight": weight,
                    "gfreq": global_freq, "l1": l1,
                    "ev_engine": hand["ev"], "ev_pio": pio_ev, "ev_diff": ev_diff,
                    "engine_freqs": [round(f, 3) for f in hand["strategy"]],
                    "pio_freqs": [round(f, 3) for f in pio_freqs],
                })
                def _clean(v):
                    return round(v, 3) if v is not None and math.isfinite(v) else None

                compare_hands.append({
                    "hand": hand["hand"],
                    "reach": round(reach, 6),
                    "pio_reach": round(p_reach, 6),
                    "ht": {"freq": [round(f, 4) for f in hand["strategy"]],
                           "ev": round(hand["ev"], 3),
                           "action_ev": [_clean(v) for v in hand.get("action_ev", [])]},
                    "pio": {"freq": [round(f, 4) for f in pio_freqs],
                            "ev": _clean(pio_ev),
                            "action_ev": [
                                _clean(row[idx]) if row is not None else None
                                for row in pio_action_evs
                            ]},
                    "l1": round(l1, 4),
                })

        # --- Cross-exploitability: the primary gate (full mode only). -----
        # Per-hand strategies from two correct solvers may legitimately
        # differ (2p zero-sum games have many equilibria; only the value is
        # unique, and indifference regions - bluff-catchers, mixed sizings -
        # are huge in symmetric spots). The sound test: load the ENGINE's
        # strategy into Pio and let Pio's own evaluator report how
        # exploitable that profile is. Meaningless with a partial upload, so
        # sampled mode skips it.
        engine_results: Dict[str, float] = {}
        if full_mode:
            print(f"\ncross-check: loading the engine strategy into Pio "
                  f"({len(strategy_upload)} nodes)...")
            # Do NOT lock_node here: locked nodes are excluded from Pio's MES
            # (best-response) search, so calc_results would report MES == EV
            # and exploitability would always read 0.000 - a false pass.
            # Verified empirically: a garbage strategy reads 91.7 unlocked,
            # 0.000 locked. Nothing recalculates between set_strategy and
            # calc_results (we never call `go`).
            for pio_id, rows in strategy_upload:
                values = [f"{v:.6f}" for row in rows for v in row]
                solver.set_strategy(pio_id, *values)
            raw = solver._run("calc_results")
            for line in raw.splitlines():
                if ":" in line:
                    label, _, value = line.partition(":")
                    try:
                        engine_results[label.strip()] = float(value.strip())
                    except ValueError:
                        pass
    finally:
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

    if gfreq_failures:
        print(f"WARNING: calc_global_freq failed on {len(gfreq_failures)} of "
              f"{nodes_compared} nodes; those nodes carry zero diagnostic weight. "
              f"First: {gfreq_failures[0]}")

    # No nodes at all IS a failure - the two trees did not line up anywhere.
    if nodes_compared == 0:
        print("FAIL: no nodes compared - the trees do not line up at all")
        return 1

    # Zero total weight is NOT a failure. Weight is Pio's global line frequency
    # times the smaller of the two reaches, and it exists only to normalize the
    # per-hand DIAGNOSTICS. On some boards Pio's global frequencies underflow to
    # zero (seen on 5c 5h 5s 2c 8d, where the root itself reports 0.0 and one
    # line reports -5e-12), which makes the diagnostics uninformative and
    # nothing more. Treating it as FAIL conflated "we learned nothing about
    # per-hand agreement" with "the solvers disagree", and the cross-check below
    # - the only real correctness statement - still runs and still decides.
    diagnostics_weighted = weight_total > 0
    if not diagnostics_weighted:
        print(f"NOTE: compared {nodes_compared} nodes, but Pio's global line "
              f"frequencies are all zero here, so the per-hand diagnostics have no "
              f"weight to normalize against and are skipped. This is a diagnostic "
              f"gap, not a disagreement - the cross-exploitability gate below is "
              f"unaffected and is what decides.")

    # --- Primary gate. ----------------------------------------------------
    # Full mode: engine-profile exploitability as measured by Pio.
    # Sampled mode: root-EV agreement (both solvers solved the FULL game to
    # their accuracy targets; only the per-node comparison was sampled).
    exploit_engine = engine_results.get("Exploitable for")
    exploit_pio = results.get("Exploitable for")
    exploit_threshold = max(pot * args.exploit_threshold_frac, 1e-4)
    root_ev_diff = (abs(meta["ev_chips"][0] - results["EV OOP"])
                    if results.get("EV OOP") is not None else None)
    print(f"\ncompared {nodes_compared} nodes, {len(offenders)} hand-node pairs"
          + ("" if full_mode else f"  [sampled: {args.runouts} runouts/chance node]"))
    if full_mode:
        print(f"exploitability per Pio:  pio's own solve {exploit_pio}  "
              f"ENGINE strategy {exploit_engine}  (threshold {exploit_threshold:.3f})")
        print(f"engine EVs per Pio:      ev_oop={engine_results.get('EV OOP')} "
              f"ev_ip={engine_results.get('EV IP')}")
    else:
        print(f"root EV: engine {meta['ev_chips'][0]:.3f} vs pio {results.get('EV OOP')}"
              f"  |diff| {root_ev_diff if root_ev_diff is None else round(root_ev_diff, 3)}"
              f"  (threshold {exploit_threshold:.3f})")
        print(f"engine self-reported exploitable: "
              f"{meta.get('final_exploitable_chips', meta['final_nashconv'] / 2):.4f} chips; "
              f"pio's own solve: {exploit_pio}")

    # --- Diagnostics: per-hand strategy / EV distance. --------------------
    # These can legitimately exceed their thresholds even between two exact
    # equilibria (equilibrium multiplicity + indifference), so they warn
    # rather than gate whenever the cross-check passes.
    mean_l1 = weighted_l1_sum / weight_total if diagnostics_weighted else 0.0
    mean_ev = weighted_ev_sum / weight_total if diagnostics_weighted else 0.0
    ev_threshold = max(pot * args.ev_threshold_frac, 1e-4)
    if diagnostics_weighted:
        print(f"reach-weighted mean L1:        {mean_l1:.5f}  (diagnostic threshold {args.l1_threshold})")
        print(f"reach-weighted mean |EV diff|: {mean_ev:.3f} chips  (diagnostic threshold {ev_threshold:.3f})")
    else:
        print("reach-weighted per-hand diagnostics: unavailable (no line weight)")

    ht_solve_s = meta.get("wall_time_s")
    pio_solve_s = pio_timing.get("solve_s")
    if ht_solve_s is not None:
        line = (f"solve time: htsolver {ht_solve_s:.2f} s on "
                f"{meta.get('threads', '?')} thread(s), {meta['iterations']} iters")
        if pio_solve_s is not None:
            ratio = (pio_solve_s / ht_solve_s) if ht_solve_s > 0 else float("inf")
            line += f"  |  pio {pio_solve_s:.2f} s  ->  {ratio:.1f}x"
        else:
            line += "  |  pio n/a (pre-solved .cfr)"
        print(line)

    ht_peak = meta.get("peak_rss_bytes")
    pio_peak = pio_timing.get("peak_bytes")
    if ht_peak or pio_peak:
        mb = lambda b: "n/a" if not b else f"{b / (1024 ** 2):.0f} MB"
        line = f"peak memory: htsolver {mb(ht_peak)}  |  pio {mb(pio_peak)}"
        if ht_peak and pio_peak:
            line += f"  ->  {pio_peak / ht_peak:.1f}x"
        print(line)

    if args.json_out:
        json_nodes = compare_nodes
        if len(json_nodes) > args.json_max_nodes:
            # Keep the most-reached nodes (per Pio's global line frequency);
            # ties resolved toward earlier (shallower) nodes. Metrics above
            # already cover every compared node.
            by_freq = sorted(range(len(compare_nodes)),
                             key=lambda i: (-compare_nodes[i]["global_freq"], i))
            keep = sorted(by_freq[:args.json_max_nodes])
            json_nodes = [compare_nodes[i] for i in keep]
            print(f"json-out: per-hand detail capped to {len(json_nodes)} of "
                  f"{len(compare_nodes)} compared nodes (--json-max-nodes)")
        doc = {
            "kind": "htsolver_pio_comparison",
            "schema": 1,
            "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
            "spot": {
                "board": meta["board"],
                "pot": pot,
                "chip_scale": meta.get("chip_scale", 100),
                "config_hash": meta["config_hash"],
                "cfr": os.path.basename(args.cfr) if args.cfr
                       else f"solve-pio @ {args.pio_accuracy_pct:g}% pot",
            },
            "summary": {
                "ht": {
                    "iterations": meta["iterations"],
                    "nashconv": meta["final_nashconv"],
                    "exploitable_chips": meta.get("final_exploitable_chips",
                                                  meta["final_nashconv"] / 2.0),
                    "exploitable_pct_pot": meta.get("final_exploitable_pct_pot"),
                    "ev": meta["ev_chips"],
                },
                "pio": {
                    "ev_oop": results.get("EV OOP"),
                    "ev_ip": results.get("EV IP"),
                    "exploitable": results.get("Exploitable for"),
                },
                "cross_check": {
                    # full mode: Pio rates the uploaded engine strategy.
                    # sampled mode: gate falls back to root-EV agreement.
                    "gate": "cross_exploitability" if full_mode else "root_ev",
                    "ht_exploitable_per_pio": exploit_engine,
                    "ht_ev_per_pio": [engine_results.get("EV OOP"),
                                      engine_results.get("EV IP")],
                    "root_ev_diff": None if root_ev_diff is None else round(root_ev_diff, 3),
                    "threshold": exploit_threshold,
                    "pass": (exploit_engine is not None and exploit_engine <= exploit_threshold)
                            if full_mode
                            else (root_ev_diff is not None and root_ev_diff <= exploit_threshold),
                },
                # Wall clock, for comparing the two solvers head to head on
                # the SAME tree at the SAME accuracy target. Setup is kept
                # separate from solving on both sides (engine: tree +
                # showdown tables; Pio: set_range + add_line + build_tree),
                # and the engine's thread count is carried along because a
                # solve time without it is not a comparable number.
                "timing": {
                    "ht_solve_s": meta.get("wall_time_s"),
                    "ht_setup_s": meta.get("setup_time_s"),
                    "ht_threads": meta.get("threads"),
                    "ht_iterations": meta["iterations"],
                    "pio_solve_s": pio_timing.get("solve_s"),
                    "pio_setup_s": pio_timing.get("setup_s"),
                    "accuracy_chips": round(max(args.pio_accuracy_pct / 100.0 * pot, 1e-4), 4),
                },
                # Peak working set of each solver process over building AND
                # solving the tree - the same OS counter on both sides. Pio's
                # includes the ~100 MB the process carries at idle, which is
                # real RAM the machine has to have; `pio_baseline_bytes` is
                # what that was before any tree work, so the tree's own cost
                # can be read off if wanted.
                "memory": {
                    "ht_peak_bytes": meta.get("peak_rss_bytes"),
                    "pio_peak_bytes": pio_timing.get("peak_bytes"),
                    "pio_baseline_bytes": pio_timing.get("baseline_bytes"),
                },
                "mean_l1": round(mean_l1, 5),
                "mean_ev_diff": round(mean_ev, 3),
                # False when Pio's line frequencies gave the per-hand
                # diagnostics nothing to normalize against; the two means
                # above are then placeholders, not measurements.
                "diagnostics_weighted": diagnostics_weighted,
                "sampled": not full_mode,
                "runouts": None if full_mode else args.runouts,
                "decision_nodes": decision_count,
                "compared_nodes": nodes_compared,
                "detail_nodes": len(json_nodes),
            },
            "nodes": json_nodes,
        }
        with open(args.json_out, "w", encoding="utf8") as f:
            json.dump(doc, f, separators=(",", ":"))
        print(f"wrote comparison JSON: {args.json_out}")

    diagnostics_ok = (not diagnostics_weighted) or (
        mean_l1 <= args.l1_threshold and mean_ev <= ev_threshold)
    if not diagnostics_ok:
        print(f"\nlargest ON-PATH strategy differences (top {args.top} by weight * L1; "
              f"weight = gfreq * min(engine reach, pio reach)):")
        offenders.sort(key=lambda o: o["weight"] * o["l1"], reverse=True)
        print(f"{'node':<24}{'hand':<8}{'gfreq':>8}{'ht_rch':>7}{'pio_rch':>8}{'L1':>8}"
              f"{'ev_eng':>10}{'ev_pio':>10}  engine_freqs vs pio_freqs")
        for o in offenders[:args.top]:
            print(f"{o['node']:<24}{o['hand']:<8}{o['gfreq']:>8.4f}{o['reach']:>7.3f}"
                  f"{o['pio_reach']:>8.3f}{o['l1']:>8.4f}{o['ev_engine']:>10.2f}"
                  f"{o['ev_pio']:>10.2f}  {o['engine_freqs']} vs {o['pio_freqs']}")

    if full_mode:
        if exploit_engine is None:
            print("\nFAIL: Pio did not report exploitability for the engine strategy")
            return 1
        if exploit_engine > exploit_threshold:
            print(f"\nFAIL: the engine strategy is exploitable for {exploit_engine} chips "
                  f"per Pio (> {exploit_threshold:.3f})")
            return 1
    else:
        if root_ev_diff is None:
            print("\nFAIL: Pio did not report a root EV to compare against")
            return 1
        if root_ev_diff > exploit_threshold:
            print(f"\nFAIL (sampled mode): root EVs differ by {root_ev_diff:.3f} chips "
                  f"(> {exploit_threshold:.3f})")
            return 1

    if not diagnostics_ok:
        if full_mode:
            print("\nNOTE: per-hand strategies/EVs differ beyond the diagnostic "
                  "thresholds, but Pio itself rates the engine strategy as "
                  "(near-)unexploitable. The two solvers picked different equilibria - "
                  "expected in spots with wide indifference regions (symmetric or full "
                  "ranges especially). Only the cross-exploitability above is a "
                  "correctness statement.")
        else:
            print("\nNOTE: per-hand strategies/EVs differ beyond the diagnostic "
                  "thresholds, and in SAMPLED mode there is NO cross-exploitability "
                  "check to fall back on - the gate here was root-EV agreement alone. "
                  "Different equilibria explain per-hand spread (indifference regions "
                  "are wide in symmetric/full-range spots), but if you want a "
                  "correctness statement about the strategy itself, re-run a smaller "
                  "tree in full mode.")
    print("\nPASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
