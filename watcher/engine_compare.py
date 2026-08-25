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


def normalize_combo(combo: str) -> Tuple[str, str]:
    """Order-insensitive key for a 4-char combo string like 'AsKh'."""
    a, b = combo[0:2], combo[2:4]
    a = a[0].upper() + a[1].lower()
    b = b[0].upper() + b[1].lower()
    return (a, b) if a < b else (b, a)


def load_engine_dump(args) -> dict:
    if args.dump:
        with open(args.dump, "r", encoding="utf8") as f:
            return json.load(f)
    out = subprocess.run(
        [args.engine_exe, "dump-json", args.artifact],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def engine_colon_ids(nodes: Dict[str, dict]) -> Dict[str, str]:
    """Rebuild Pio-style colon ids from the node table (root = 'r:0')."""

    def label(node: dict) -> str:
        kind = node["action_kind"]
        if kind == "fold":
            return "f"
        if kind == "check_call":
            return "c"
        if kind == "bet":
            return f"b{node['action_amount']}"
        raise ValueError(f"unexpected action kind {kind}")

    ids: Dict[str, str] = {}
    order = sorted(nodes.keys(), key=int)
    ids[order[0]] = "r:0"
    for key in order[1:]:
        node = nodes[key]
        ids[key] = ids[str(node["parent_id"])] + ":" + label(node)
    return ids


def showdown_lines(nodes: Dict[str, dict]) -> List[List[int]]:
    """Pio add_line encoding of the engine tree: one line per showdown
    terminal, one amount per action along its path - the actor's cumulative
    street commitment after the action (check = 0, call = the matched
    amount), i.e. exactly the engine's action_amount / bNNN convention.
    Check-check = "0 0", bet-raise-call = "50 400 400". Fold branches are
    implicit in Pio."""
    lines: List[List[int]] = []
    for key, node in nodes.items():
        if node.get("terminal") != "showdown":
            continue
        path: List[int] = []
        cur = node
        while cur["parent_id"] is not None:
            path.append(int(cur["action_amount"]))
            cur = nodes[str(cur["parent_id"])]
        path.reverse()
        lines.append(path)
    lines.sort()
    return lines


def solve_in_pio(solver, dump: dict, meta: dict, accuracy_chips: float,
                 dump_cfr) -> None:
    """Build the engine's exact tree in Pio via UPI and solve it to
    `accuracy_chips` ("exploitable for", per player). The tree is validated
    node-for-node against the engine's before solving."""
    board = "".join(meta["board"].split())
    pot = int(meta["pot"])
    eff = int(meta["effective_stack"])
    print(f"solve-pio: building {board} pot={pot} eff={eff} "
          f"accuracy={accuracy_chips:g} chips")
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
        solver.add_line(line)
    solver._run("build_tree")

    # The whole comparison assumes identical trees - verify, don't hope.
    pio_nodes = {ln.strip() for ln in solver.show_all_lines() if ln.strip()}
    engine_nodes = set(engine_colon_ids(dump["nodes"]).values()) | {"r"}
    if pio_nodes != engine_nodes:
        raise RuntimeError(
            "tree mismatch after build_tree:\n"
            f"  only in pio:    {sorted(pio_nodes - engine_nodes)[:10]}\n"
            f"  only in engine: {sorted(engine_nodes - pio_nodes)[:10]}")
    print(f"solve-pio: tree verified ({len(pio_nodes)} nodes), solving...")

    solver.set_accuracy(accuracy_chips)
    solver.go(quiet=True)
    if dump_cfr:
        solver.dump_tree(os.path.abspath(dump_cfr), "full")
        print(f"solve-pio: dumped {dump_cfr}")


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
    parser.add_argument("--json-out",
                        help="write the full per-hand comparison to this JSON file "
                             "(the input for the frontend's hidden /compare page)")
    args = parser.parse_args()
    if not args.artifact and not args.dump:
        parser.error("need --artifact or --dump")
    if not args.cfr and not args.solve_pio:
        parser.error("need --cfr (a solved Pio tree) or --solve-pio")
    if args.cfr and not os.path.exists(args.cfr):
        # Pio's load_tree never responds for a missing file - fail fast here.
        parser.error(f"--cfr file not found: {args.cfr}")

    dump = load_engine_dump(args)
    meta = dump["metadata"]

    # --- Refuse non-Nash artifacts outright. -----------------------------
    if meta.get("mode") != "nash" or meta.get("lambda") is not None:
        print("REFUSING to compare: this artifact is a QRE solve "
              f"(mode={meta.get('mode')!r}, lambda={meta.get('lambda')!r}).\n"
              "A QRE solve deliberately deviates from Nash and will not - and should "
              "not - match PioSolver. Re-solve with qre.mode = \"nash\".")
        return 2

    pot = float(meta["pot"])
    print(f"spot: board={meta['board']!r} pot={pot} config={meta['config_hash'][:10]}")
    print(f"engine: iters={meta['iterations']} nashconv={meta['final_nashconv']:.4f} "
          f"ev={meta['ev_chips']}")

    # --- Spawn Pio and load the .cfr. ------------------------------------
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from pyosolver import PYOSolver  # noqa: E402

    # PIO_LOG=<path> logs the full UPI dialogue for debugging hangs.
    solver = PYOSolver(args.pio_dir, args.pio_exe, log_file=os.environ.get("PIO_LOG"))
    try:
        if args.solve_pio:
            solve_in_pio(solver, dump, meta,
                         accuracy_chips=max(args.pio_accuracy_pct / 100.0 * pot, 1e-4),
                         dump_cfr=args.dump_cfr)
        else:
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
                weighted_l1_sum += reach * l1
                if math.isfinite(ev_diff):
                    weighted_ev_sum += reach * abs(ev_diff)
                weight_total += reach
                pio_freqs = [pio_strategy[row_of[engine_labels[k]]][idx]
                             for k in range(len(engine_labels))]
                offenders.append({
                    "node": pio_id, "hand": hand["hand"], "reach": reach, "l1": l1,
                    "ev_engine": hand["ev"], "ev_pio": pio_ev, "ev_diff": ev_diff,
                    "engine_freqs": [round(f, 3) for f in hand["strategy"]],
                    "pio_freqs": [round(f, 3) for f in pio_freqs],
                })
                def _clean(v):
                    return round(v, 3) if v is not None and math.isfinite(v) else None

                compare_hands.append({
                    "hand": hand["hand"],
                    "reach": round(reach, 6),
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

        # --- Cross-exploitability: the primary gate. ----------------------
        # Per-hand strategies from two correct solvers may legitimately
        # differ (2p zero-sum games have many equilibria; only the value is
        # unique, and indifference regions - bluff-catchers, mixed sizings -
        # are huge in symmetric spots). The sound test: load the ENGINE's
        # strategy into Pio and let Pio's own evaluator report how
        # exploitable that profile is.
        print("\ncross-check: loading the engine strategy into Pio...")
        # Do NOT lock_node here: locked nodes are excluded from Pio's MES
        # (best-response) search, so calc_results would report MES == EV and
        # exploitability would always read 0.000 - a false pass. Verified
        # empirically: a garbage strategy reads 91.7 unlocked, 0.000 locked.
        # Nothing recalculates between set_strategy and calc_results (we
        # never call `go`), so the upload does not need protecting.
        for pio_id, rows in strategy_upload:
            values = [f"{v:.6f}" for row in rows for v in row]
            solver.set_strategy(pio_id, *values)
        engine_results = {}
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

    if weight_total <= 0 or nodes_compared == 0:
        print("FAIL: nothing compared (tree mismatch everywhere?)")
        return 1

    # --- Primary gate: engine-profile exploitability as measured by Pio. --
    exploit_engine = engine_results.get("Exploitable for")
    exploit_pio = results.get("Exploitable for")
    exploit_threshold = max(pot * args.exploit_threshold_frac, 1e-4)
    print(f"\ncompared {nodes_compared} nodes, {len(offenders)} hand-node pairs")
    print(f"exploitability per Pio:  pio's own solve {exploit_pio}  "
          f"ENGINE strategy {exploit_engine}  (threshold {exploit_threshold:.3f})")
    print(f"engine EVs per Pio:      ev_oop={engine_results.get('EV OOP')} "
          f"ev_ip={engine_results.get('EV IP')}")

    # --- Diagnostics: per-hand strategy / EV distance. --------------------
    # These can legitimately exceed their thresholds even between two exact
    # equilibria (equilibrium multiplicity + indifference), so they warn
    # rather than gate whenever the cross-check passes.
    mean_l1 = weighted_l1_sum / weight_total
    mean_ev = weighted_ev_sum / weight_total
    ev_threshold = max(pot * args.ev_threshold_frac, 1e-4)
    print(f"reach-weighted mean L1:        {mean_l1:.5f}  (diagnostic threshold {args.l1_threshold})")
    print(f"reach-weighted mean |EV diff|: {mean_ev:.3f} chips  (diagnostic threshold {ev_threshold:.3f})")

    if args.json_out:
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
                    "ht_exploitable_per_pio": exploit_engine,
                    "ht_ev_per_pio": [engine_results.get("EV OOP"),
                                      engine_results.get("EV IP")],
                    "threshold": exploit_threshold,
                    "pass": exploit_engine is not None and exploit_engine <= exploit_threshold,
                },
                "mean_l1": round(mean_l1, 5),
                "mean_ev_diff": round(mean_ev, 3),
            },
            "nodes": compare_nodes,
        }
        with open(args.json_out, "w", encoding="utf8") as f:
            json.dump(doc, f, separators=(",", ":"))
        print(f"wrote comparison JSON: {args.json_out}")

    diagnostics_ok = mean_l1 <= args.l1_threshold and mean_ev <= ev_threshold
    if not diagnostics_ok:
        print(f"\nlargest strategy differences (top {args.top} by reach * L1):")
        offenders.sort(key=lambda o: o["reach"] * o["l1"], reverse=True)
        print(f"{'node':<24}{'hand':<8}{'reach':>7}{'L1':>8}{'ev_eng':>10}{'ev_pio':>10}"
              f"  engine_freqs vs pio_freqs")
        for o in offenders[:args.top]:
            print(f"{o['node']:<24}{o['hand']:<8}{o['reach']:>7.3f}{o['l1']:>8.4f}"
                  f"{o['ev_engine']:>10.2f}{o['ev_pio']:>10.2f}  "
                  f"{o['engine_freqs']} vs {o['pio_freqs']}")

    if exploit_engine is None:
        print("\nFAIL: Pio did not report exploitability for the engine strategy")
        return 1
    if exploit_engine > exploit_threshold:
        print(f"\nFAIL: the engine strategy is exploitable for {exploit_engine} chips "
              f"per Pio (> {exploit_threshold:.3f})")
        return 1

    if not diagnostics_ok:
        print("\nNOTE: per-hand strategies/EVs differ beyond the diagnostic thresholds, "
              "but Pio itself rates the engine strategy as (near-)unexploitable. The two "
              "solvers picked different equilibria - expected in spots with wide "
              "indifference regions (symmetric or full ranges especially). Only the "
              "cross-exploitability above is a correctness statement.")
    print("\nPASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
