"""Timing/memory benchmark: htsolver vs PioSolver across turn and river boards.

Manual developer tool, like engine_compare.py - Pio only runs on this machine,
so this is never CI. It exists to answer one question with numbers instead of
impressions: does the engine's standing versus Pio depend on whether the tree
has a chance node in it?

Every spot uses the SAME ranges, pot, stacks and betting structure, so the only
variable across a run is the board length: a 4-card board puts a 48-way river
chance node between two betting rounds, a 5-card board has no chance node at
all. Both solvers get the same accuracy target and are measured with the same
OS counters (wall clock around the solve; peak working set of the process).

  python bench_boards.py                  # 10 turn + 10 river boards
  python bench_boards.py --only river     # one family
  python bench_boards.py --boards 3       # quick smoke run
  python bench_boards.py --ranges tight   # realistic ranges instead of 100%

Range width is a first-class knob because it is NOT neutral between the two
solvers, though no longer in the direction this docstring used to claim.
Before M6.8 every htsolver array was the full 1326-combo universe regardless
of the configured ranges, so a tight range bought it nothing while Pio's cost
fell; a 100% range was htsolver's most favourable case. The compact hand
universe inverted that. htsolver now sizes everything by the combos actually
live in some starting range, and tight ranges are where it wins by the widest
margin (turn 3.43x, river 18.2x) while 100% turn boards are the one family
where Pio is still ahead. `--ranges tight` is both the realistic case and the
flattering one now; run both if the question is about scaling.

This script is for htsolver-vs-Pio comparison. For htsolver-vs-htsolver - two
builds of the engine against each other - use engine/tools/bench_ab.py
instead, and read the M7 entry in engine/docs/roadmap.md first: naive A/B
timing on this hardware manufactures differences of a few percent that are not
there.

Writes bench_boards_results.json next to this file and prints a summary table.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

WATCHER_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WATCHER_DIR)

from htc_format import read_htc_header  # noqa: E402

ENGINE_DIR = os.path.join(WATCHER_DIR, "..", "engine")
ENGINE_EXE = os.path.join(ENGINE_DIR, "build", "engine.exe")
BENCH_DIR = os.path.join(ENGINE_DIR, "configs", "_bench")
OUT_DIR = os.path.join(ENGINE_DIR, "out", "_bench")

# Fixed board sets, chosen to spread texture (paired, monotone, connected,
# rainbow, high/low) rather than sampled at random, so a re-run is comparable
# to the last one. Turn boards are the first four cards of the river boards
# wherever that was possible, which keeps the two families as close as a
# 4-card and a 5-card board can be.
TURN_BOARDS = [
    "9c 5d Jc 7s",
    "Ah Kd 7c 2s",
    "Qs Jh 2h 8d",
    "8h 7h 6c 2d",
    "Ks Kd 4c 9h",
    "Td 9d 3d Ah",
    "5c 5h 5s 2c",
    "Ac Qd 8h 3s",
    "Jd Ts 9h 4c",
    "2h 3d 4s Kc",
]

RIVER_BOARDS = [
    "9c 5d Jc 7s 9h",
    "Ah Kd 7c 2s Td",
    "Qs Jh 2h 8d 4c",
    "8h 7h 6c 2d Ks",
    "Ks Kd 4c 9h 3s",
    "Td 9d 3d Ah 6c",
    "5c 5h 5s 2c 8d",
    "Ac Qd 8h 3s Jc",
    "Jd Ts 9h 4c 2s",
    "2h 3d 4s Kc 7h",
]

# One sizing set, applied to whichever streets the board leaves in the tree.
# 400% of a 100 pot is the 400-chip stack, so it clamps to a jam - the same
# shape as the validate_* configs the Pio gate already passed on.
STREET_SIZING = {
    "bets": [50, 400],
    "raises": [1000],
    "allin_threshold": 0.9,
    "max_raises": 2,
}


RANGE_FILES = {"full": "@file:../ranges/full.txt", "tight": "@file:../ranges/tight15.txt"}


def build_config(board: str, name: str, iterations: int, accuracy_pct: float,
                 threads: int, ranges: str) -> str:
    cards = board.split()
    bet_sizing = {"river": STREET_SIZING}
    if len(cards) <= 4:
        bet_sizing["turn"] = STREET_SIZING
    if len(cards) <= 3:
        bet_sizing["flop"] = STREET_SIZING
    config = {
        "schema": 1,
        "game": "nlhe",
        "board": board,
        "pot": 100,
        "chip_scale": 100,
        "players": [
            {"seat": "OOP", "stack": 400, "range": RANGE_FILES[ranges]},
            {"seat": "IP", "stack": 400, "range": RANGE_FILES[ranges]},
        ],
        "bet_sizing": bet_sizing,
        "algorithm": {"update": "dcfr"},
        "qre": {"mode": "nash"},
        "budget": {
            "iterations": iterations,
            "target_exploitable_pct": accuracy_pct,
            "checkpoint_every": 100,
        },
        "memory_limit_gb": 24,
        "threads": threads,
        "output": {
            "path": f"out/_bench/{name}.hta",
            "strategy_quantize_u8": False,
            "ev_float32": True,
            "rollups_169": False,
        },
    }
    path = os.path.join(BENCH_DIR, f"{name}.json")
    with open(path, "w", encoding="utf8") as f:
        json.dump(config, f, indent=2)
    return path


def run_engine(config_path: str) -> dict:
    """Solve with htsolver. Returns the parsed stdout timings; the artifact
    metadata is the authoritative copy and is read back by the harness."""
    start = time.perf_counter()
    proc = subprocess.run([ENGINE_EXE, "solve", config_path], cwd=ENGINE_DIR,
                          capture_output=True, text=True)
    wall = time.perf_counter() - start
    if proc.returncode != 0:
        raise RuntimeError(f"engine failed ({proc.returncode}):\n{proc.stdout[-2000:]}\n"
                           f"{proc.stderr[-2000:]}")
    info = {"process_wall_s": round(wall, 3)}
    for line in proc.stdout.splitlines():
        if line.startswith("estimated solver memory:"):
            info["estimate"] = line.strip()
        if line.startswith("iter "):
            info["last_iter_line"] = line.strip()
    return info


def run_compare(artifact: str, out_prefix: str, accuracy_pct: float,
                timeout_s: int) -> dict:
    """Solve in Pio, gate on cross-exploitability, and return the merged
    summary of both payload headers.

    Per-hand rows are deliberately not requested (--pio-detail): the bench
    reads headline numbers only, and the per-node UPI pass is the slow part."""
    ht_out = f"{out_prefix}.ht.htc"
    pio_out = f"{out_prefix}.pio.htc"
    cmd = [sys.executable, "-u", os.path.join(WATCHER_DIR, "engine_compare.py"),
           "--artifact", artifact, "--engine-exe", ENGINE_EXE,
           "--solve-pio", "--pio-accuracy-pct", str(accuracy_pct),
           "--ht-out", ht_out, "--pio-out", pio_out, "--cross-check"]
    proc = subprocess.run(cmd, cwd=WATCHER_DIR, capture_output=True, text=True,
                          timeout=timeout_s)
    if not (os.path.exists(ht_out) and os.path.exists(pio_out)):
        raise RuntimeError(f"engine_compare failed ({proc.returncode}):\n"
                           f"{proc.stdout[-3000:]}\n{proc.stderr[-2000:]}")
    ht = read_htc_header(ht_out)["summary"]
    pio = read_htc_header(pio_out)["summary"]
    return {**ht, **pio,
            "timing": {**ht.get("timing", {}), **pio.get("timing", {})},
            "memory": {**ht.get("memory", {}), **pio.get("memory", {})}}


def mb(value) -> str:
    return "n/a" if not value else f"{value / (1024 ** 2):.0f}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", choices=["turn", "river"], help="one family only")
    parser.add_argument("--boards", type=int, default=10, help="boards per family")
    parser.add_argument("--accuracy-pct", type=float, default=0.02,
                        help="target per-player exploitability, %% of the pot (both solvers)")
    parser.add_argument("--iterations", type=int, default=100000,
                        help="htsolver iteration cap (the accuracy target should end it first)")
    parser.add_argument("--threads", type=int, default=0, help="htsolver workers (0 = auto)")
    parser.add_argument("--ranges", choices=sorted(RANGE_FILES), default="full",
                        help="starting ranges for both seats: 100%% (full) or a ~15%% "
                             "opening range (tight). See the module docstring - this is "
                             "not a neutral knob")
    parser.add_argument("--timeout", type=int, default=3600, help="per-spot seconds")
    parser.add_argument("--out", default=os.path.join(WATCHER_DIR, "bench_boards_results.json"))
    args = parser.parse_args()

    os.makedirs(BENCH_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    families = []
    if args.only != "river":
        families.append(("turn", TURN_BOARDS[:args.boards]))
    if args.only != "turn":
        families.append(("river", RIVER_BOARDS[:args.boards]))

    rows = []
    for family, boards in families:
        for i, board in enumerate(boards):
            name = f"{family}{i:02d}"
            print(f"\n=== {name}: {board} ===", flush=True)
            config_path = build_config(board, name, args.iterations,
                                       args.accuracy_pct, args.threads, args.ranges)
            artifact = os.path.join(ENGINE_DIR, "out", "_bench", f"{name}.hta")
            out_prefix = os.path.join(OUT_DIR, f"{name}.compare")
            row = {"family": family, "board": board, "name": name, "ranges": args.ranges}
            try:
                row.update(run_engine(config_path))
                summary = run_compare(artifact, out_prefix, args.accuracy_pct, args.timeout)
                row["timing"] = summary.get("timing", {})
                row["memory"] = summary.get("memory", {})
                row["pass"] = summary.get("cross_check", {}).get("pass")
                row["gate"] = summary.get("cross_check", {}).get("gate")
                row["decision_nodes"] = summary.get("decision_nodes")
                row["ht_nashconv"] = summary.get("ht", {}).get("nashconv")
                t = row["timing"]
                print(f"  ht {t.get('ht_solve_s')} s / pio {t.get('pio_solve_s')} s"
                      f"   mem ht {mb(row['memory'].get('ht_peak_bytes'))} MB /"
                      f" pio {mb(row['memory'].get('pio_peak_bytes'))} MB", flush=True)
            except Exception as e:  # keep going: one bad spot must not lose the run
                row["error"] = f"{type(e).__name__}: {e}"
                print(f"  FAILED: {row['error']}", flush=True)
            rows.append(row)
            with open(args.out, "w", encoding="utf8") as f:
                json.dump(rows, f, indent=1)

    print("\n" + "=" * 96)
    header = (f"{'board':<18}{'nodes':>8}{'ht s':>9}{'pio s':>9}{'ratio':>8}"
              f"{'ht MB':>8}{'pio MB':>8}{'iters':>9}{'gate':>7}")
    print(header)
    print("-" * len(header))
    for row in rows:
        if "error" in row:
            print(f"{row['board']:<18}  {row['error'][:70]}")
            continue
        t, m = row["timing"], row["memory"]
        ht, pio = t.get("ht_solve_s"), t.get("pio_solve_s")
        ratio = f"{pio / ht:.1f}x" if ht and pio else "-"
        print(f"{row['board']:<18}{row.get('decision_nodes') or 0:>8}"
              f"{ht if ht is None else round(ht, 2):>9}"
              f"{pio if pio is None else round(pio, 2):>9}{ratio:>8}"
              f"{mb(m.get('ht_peak_bytes')):>8}{mb(m.get('pio_peak_bytes')):>8}"
              f"{t.get('ht_iterations') or 0:>9}"
              f"{'PASS' if row.get('pass') else 'FAIL':>7}")

    for family, _ in families:
        done = [r for r in rows if r["family"] == family and "error" not in r
                and r["timing"].get("ht_solve_s") and r["timing"].get("pio_solve_s")]
        if not done:
            continue
        ratios = [r["timing"]["pio_solve_s"] / r["timing"]["ht_solve_s"] for r in done]
        ht_mem = [r["memory"]["ht_peak_bytes"] for r in done if r["memory"].get("ht_peak_bytes")]
        pio_mem = [r["memory"]["pio_peak_bytes"] for r in done if r["memory"].get("pio_peak_bytes")]
        print(f"\n{family}: n={len(done)}  speed ratio (pio/ht) "
              f"median {sorted(ratios)[len(ratios) // 2]:.2f}x  "
              f"min {min(ratios):.2f}x  max {max(ratios):.2f}x")
        if ht_mem and pio_mem:
            print(f"{' ' * len(family)}  peak MB: ht median {mb(sorted(ht_mem)[len(ht_mem) // 2])}"
                  f"  pio median {mb(sorted(pio_mem)[len(pio_mem) // 2])}")
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
