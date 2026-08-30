#!/usr/bin/env python3
"""Board-sample ladder for the preflop push/fold solver.

The preflop game approximates one thing and one thing only: the board runout
at an all-in showdown. `pair_count` sets the accuracy of the pairwise equity
matrix every heads-up showdown answers out of, and `iter_count` sets the
per-iteration sample the 3+ way showdowns average over. Neither default should
be guessed - this is the measurement that sets them.

What it reports per cell:

  jam%      the actor's range as a percent of combos, so a drift in the
            answer is visible as a number rather than by eye
  flips     how many of the 169 classes CHANGE their jam/fold decision
            against the highest-accuracy arm in the same ladder. This is the
            number that matters: a class mixing 40% vs 45% is noise, a class
            going from jam to fold is a different chart.
  spread    the largest jam-EV disagreement between combos of one class.
            Pairwise all-in equity is provably suit-symmetric, so anything
            above zero here is estimator noise leaking into the answer. The
            engine projects e2_ onto the suit-symmetric subspace, so this
            should read 0.00000 - it is a regression guard, not a knob.
  setup     seconds spent building the tables, which is what a `pair_count`
            rise actually costs; the solve itself is milliseconds.

Usage:
  python tools/bench_board_sample.py --config configs/pushfold_hu_10bb.json \\
      --pair 5000,20000,80000,200000
  python tools/bench_board_sample.py --config configs/pushfold_4way_10bb.json \\
      --iter 100,250,500,1000,2000 --seeds 3
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys
import time

RANKS = "AKQJT98765432"
COMBOS = {}
for _i, _a in enumerate(RANKS):
    for _j, _b in enumerate(RANKS):
        if _i == _j:
            COMBOS[_a + _b] = 6
        elif _i < _j:
            COMBOS[_a + _b + "s"] = 4
        else:
            COMBOS[_b + _a + "o"] = 12


def hand_class(name):
    r1, s1, r2, s2 = name[0], name[1], name[2], name[3]
    if r1 == r2:
        return r1 + r2
    a, b = (r1, r2) if RANKS.index(r1) < RANKS.index(r2) else (r2, r1)
    return a + b + ("s" if s1 == s2 else "o")


def run(engine, config_path, out_hta):
    """Solve and return (metadata, nodes, setup_seconds, wall_seconds)."""
    t0 = time.time()
    proc = subprocess.run([engine, "solve", str(config_path)], capture_output=True, text=True)
    wall = time.time() - t0
    if proc.returncode != 0:
        sys.exit(f"solve failed for {config_path}:\n{proc.stdout}\n{proc.stderr}")
    m = re.search(r"setup ([0-9.]+) s", proc.stdout)
    setup = float(m.group(1)) if m else float("nan")
    dump = subprocess.run([engine, "dump-json", str(out_hta)], capture_output=True, text=True)
    if dump.returncode != 0:
        sys.exit(f"dump-json failed for {out_hta}:\n{dump.stderr}")
    doc = json.loads(dump.stdout.lstrip("﻿"))
    return doc["metadata"], doc["nodes"], setup, wall


def chart(nodes, node_id, action_index=1):
    """169-class frequency for one action at one decision node."""
    rollup = nodes[str(node_id)]["data"]["rollup_169"]
    return {r["class"]: r["freq"][action_index] for r in rollup}


def jam_pct(freqs):
    total = sum(COMBOS.values())
    return 100.0 * sum(COMBOS[c] * f for c, f in freqs.items()) / total


def decision_flips(a, b, threshold=0.5):
    return sum(1 for c in a if (a[c] >= threshold) != (b.get(c, 0.0) >= threshold))


def suit_spread(nodes, node_id, seat):
    """Largest jam-EV disagreement between combos of the same class."""
    data = nodes[str(node_id)]["data"]
    seats = [s for s in data["seats"] if s["seat"] == seat]
    if not seats or not seats[0]["hands"]:
        return 0.0
    by_class = {}
    for h in seats[0]["hands"]:
        gap = h["action_ev"][1] - h["action_ev"][0]
        by_class.setdefault(hand_class(h["hand"]), []).append(gap)
    return max((max(v) - min(v)) for v in by_class.values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--engine", default="build/engine.exe")
    ap.add_argument("--pair", default="", help="comma-separated pair_count ladder")
    ap.add_argument("--iter", default="", help="comma-separated iter_count ladder")
    ap.add_argument("--seeds", type=int, default=1, help="distinct seeds per rung")
    ap.add_argument("--node", type=int, default=0, help="decision node to chart")
    ap.add_argument("--seat", type=int, default=-1, help="actor seat (default: read from the node)")
    args = ap.parse_args()

    base_path = pathlib.Path(args.config)
    base = json.loads(re.sub(r"^\s*//.*$", "", base_path.read_text(), flags=re.M))
    # Bench configs are written beside the original so the @file: ranges,
    # which resolve relative to the config's own directory, keep resolving.
    work = base_path.parent

    pair_ladder = [int(x) for x in args.pair.split(",") if x]
    iter_ladder = [int(x) for x in args.iter.split(",") if x]
    ladder = [("pair_count", v) for v in pair_ladder] + [("iter_count", v) for v in iter_ladder]
    if not ladder:
        sys.exit("give --pair and/or --iter")

    base_seed = base["preflop"]["board_sample"].get("seed", 20260830)
    rows = []
    charts = {}
    generated = []
    try:
        for key, value in ladder:
            for s in range(args.seeds):
                cfg = json.loads(json.dumps(base))
                cfg["preflop"]["board_sample"][key] = value
                cfg["preflop"]["board_sample"]["seed"] = base_seed + s
                tag = f"_bench_{key}_{value}_s{s}"
                cfg["output"]["path"] = f"out/{base_path.stem}{tag}.hta"
                path = work / f"{base_path.stem}{tag}.json"
                path.write_text(json.dumps(cfg, indent=2))
                generated.append(path)
                meta, nodes, setup, wall = run(args.engine, path, work.parent / cfg["output"]["path"])
                seat = args.seat if args.seat >= 0 else nodes[str(args.node)]["actor"]
                freqs = chart(nodes, args.node)
                charts[(key, value, s)] = freqs
                rows.append(
                    dict(key=key, value=value, seed=s, jam=jam_pct(freqs),
                         spread=suit_spread(nodes, args.node, seat), setup=setup, wall=wall,
                         iters=meta["iterations"], nashconv=meta["final_nashconv"])
                )
    finally:
        for p in generated:
            p.unlink(missing_ok=True)

    # The finest rung of each ladder is the reference the coarser ones are
    # scored against. It is not "the truth" - it is just the best available
    # answer, which is what a convergence table can honestly claim.
    ref = {}
    for key, _ in ladder:
        finest = max(v for k, v in ladder if k == key)
        ref[key] = charts[(key, finest, 0)]

    print(f"\n{'knob':11} {'value':>8} {'seed':>4} {'jam%':>7} {'flips':>6} {'spread':>9} "
          f"{'iters':>6} {'setup s':>8} {'wall s':>7}")
    for r in rows:
        flips = decision_flips(charts[(r["key"], r["value"], r["seed"])], ref[r["key"]])
        print(f"{r['key']:11} {r['value']:>8} {r['seed']:>4} {r['jam']:7.2f} {flips:>6} "
              f"{r['spread']:9.5f} {r['iters']:>6} {r['setup']:8.2f} {r['wall']:7.2f}")
    print("\nflips = 169-class jam/fold decisions differing from the finest rung, seed 0.")
    print("spread must be 0.00000: e2_ is projected onto the suit-symmetric subspace.\n")


if __name__ == "__main__":
    main()
