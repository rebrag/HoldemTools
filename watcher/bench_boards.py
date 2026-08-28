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
  python bench_boards.py --only flop      # flop family (opt-in; much slower)
  python bench_boards.py --boards 3       # quick smoke run
  python bench_boards.py --ranges tight   # realistic ranges instead of 100%

It also A/Bs two ENGINE configurations against each other, which is a different
question from htsolver-vs-Pio and needs no Pio at all. `--no-pio` skips the Pio
half and reads the headline numbers from the artifact metadata; `--qre-lambda`
(with the `--qre-anneal-*` pair) solves for a QRE instead of a Nash equilibrium
and implies `--no-pio`, since the harness refuses to rate a QRE against Pio.

  # does annealed QRE reach a Nash target in fewer iterations than dcfr?
  python bench_boards.py --no-pio --ranges tight --accuracy-pct 0.3 --checkpoint-every 5
  python bench_boards.py --ranges tight --accuracy-pct 0.3 --checkpoint-every 5       --qre-lambda 20 --qre-anneal-factor 50 --qre-anneal-at 25

Compare the ITERATION medians, not the wall clock: iteration counts are exact
and deterministic, while wall clock on this box moves by tens of percent when
anything else is running. Watch --checkpoint-every too - the stop can only fire
on a checkpoint, so it is the resolution of the number being compared.

For FLOP solve time specifically, which is where the remaining cost lives, the
axis that matters is stack depth. `--spr` sets the stacks (the pot is always
100), and flop trees grow sharply with it:

  SPR  4 -> 170528 decision nodes    SPR  7 -> 213356    SPR 10 -> 345656

  python bench_boards.py --no-pio --only flop --spr 7 --ranges tight       --accuracy-pct 0.3 --checkpoint-every 5

`--spr` defaults to 4, which is what every number recorded before the flag
existed used, so old invocations still reproduce. The flop family also
defaults to 4 boards rather than 10, because its spots cost orders of
magnitude more than a turn or river one.

To benchmark a REAL saved tree with the flop as the only variable, download
its config from /compare and pass it as `--template`. Ranges, sizings, stacks
and the accuracy target then come from that config, and only the board moves:

  python bench_boards.py --no-pio --only flop --template ~/Downloads/htsolver_config.json

Ranges in a template must be inline (a downloaded config always is): the
engine resolves `@file:` relative to the config's own directory, and the bench
rewrites configs into engine/configs/_bench/ where such a path would not
resolve. The bench refuses rather than silently mis-resolving.

Range width is a first-class knob because it is NOT neutral between the two
solvers. htsolver's cost is independent of it - every array and every inner
loop is the full 1326-combo universe no matter how narrow the range - while
Pio's scales with the combos actually in play. A 100% range is therefore
htsolver's most favourable case, and `--ranges tight` is the one that
resembles a real spot.

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

# Flop boards: the first three cards of the turn boards, so the three families
# are nested and the only variable is how many chance levels the tree has.
# Added when the QRE annealing sweep needed a family with more than one
# betting street below the root - the effect being measured is about depth,
# and turn/river trees are too shallow to show it either way.
FLOP_BOARDS = [
    "9c 5d Jc",
    "Ah Kd 7c",
    "Qs Jh 2h",
    "8h 7h 6c",
    "Ks Kd 4c",
    "Td 9d 3d",
    "5c 5h 5s",
    "Ac Qd 8h",
    "Jd Ts 9h",
    "2h 3d 4s",
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


def load_template(path: str) -> dict:
    """A config to sweep boards over, instead of the built-in shape.

    The intended source is /compare's "Download config" button, which is how a
    saved tree - LPopenBBcall, say - becomes a benchmark fixture with the flop
    as the only variable. Ranges, sizings, stacks and the accuracy target all
    come from the template; only the board and the output path are replaced.
    """
    with open(path, "r", encoding="utf8") as f:
        config = json.load(f)
    for player in config.get("players", []):
        if str(player.get("range", "")).startswith("@file:"):
            raise SystemExit(
                f"--template {path}: ranges must be inline, not '@file:'. The engine "
                "resolves @file: relative to the config's own directory, and the bench "
                "rewrites configs into engine/configs/_bench/ where that path would not "
                "resolve. A config downloaded from /compare already has inline ranges.")
    return config


def build_config(board: str, name: str, iterations: int, accuracy_pct: float,
                 threads: int, ranges: str, qre: dict | None = None,
                 checkpoint_every: int = 100, spr: float = 4.0,
                 template: dict | None = None) -> str:
    if template is not None:
        # Everything except the board is the template's business - including
        # its own accuracy target and budget, which is the point of pinning a
        # real spot rather than re-deriving one.
        config = json.loads(json.dumps(template))
        config["board"] = board
        config["output"] = dict(config.get("output") or {})
        config["output"]["path"] = f"out/_bench/{name}.hta"
        if qre is not None:
            config["qre"] = qre
        path = os.path.join(BENCH_DIR, f"{name}.json")
        with open(path, "w", encoding="utf8") as f:
            json.dump(config, f, indent=2)
        return path
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
            {"seat": "OOP", "stack": round(100 * spr), "range": RANGE_FILES[ranges]},
            {"seat": "IP", "stack": round(100 * spr), "range": RANGE_FILES[ranges]},
        ],
        "bet_sizing": bet_sizing,
        "algorithm": {"update": "dcfr"},
        "qre": qre or {"mode": "nash"},
        "budget": {
            "iterations": iterations,
            "target_exploitable_pct": accuracy_pct,
            "checkpoint_every": checkpoint_every,
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
        if line.startswith("estimated peak memory:"):
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


def read_artifact_meta(artifact: str) -> dict:
    """The artifact's own metadata. Used by the engine-only path, which has no
    Pio payload to merge and does not need the expensive per-node extraction -
    every headline number the bench prints is already in here."""
    proc = subprocess.run([ENGINE_EXE, "dump-json", artifact, "--meta-only"],
                          cwd=ENGINE_DIR, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"dump-json failed ({proc.returncode}): "
                           f"{proc.stdout[-1000:]} {proc.stderr[-1000:]}")
    # dump-json writes a UTF-8 BOM; json.loads will not eat it.
    return json.loads(proc.stdout.lstrip("﻿"))


def summarize_engine_only(artifact: str) -> dict:
    """Same row shape run_compare returns, minus everything Pio-derived."""
    m = read_artifact_meta(artifact)
    return {
        "timing": {
            "ht_solve_s": m.get("wall_time_s"),
            "ht_setup_s": m.get("setup_time_s"),
            "ht_threads": m.get("threads"),
            "ht_iterations": m.get("iterations"),
        },
        "memory": {"ht_peak_bytes": m.get("peak_rss_bytes")},
        "decision_nodes": m.get("decision_node_count"),
        "ht": {"nashconv": m.get("final_nashconv")},
        "qre_mode": m.get("mode"),
        "qre_lambda": m.get("lambda"),
        "qre_gap_chips": m.get("final_qre_gap_chips"),
        "exploitable_pct_pot": m.get("final_exploitable_pct_pot"),
    }


def mb(value) -> str:
    return "n/a" if not value else f"{value / (1024 ** 2):.0f}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", choices=["flop", "turn", "river"],
                        help="one family only. flop is opt-in rather than part of the "
                             "default run: it is two chance levels deep and costs orders "
                             "of magnitude more per board than turn or river")
    parser.add_argument("--boards", type=int, default=None,
                        help="boards per family (default 10, or 4 for the flop family, "
                             "whose spots cost orders of magnitude more)")
    parser.add_argument("--spr", type=float, default=4.0,
                        help="stack-to-pot ratio; the pot is always 100, so this sets the "
                             "stacks. Default 4 reproduces every number recorded before "
                             "this flag existed. Flop trees grow sharply with it - 170k "
                             "decision nodes at 4, 346k at 10 - so it is the axis worth "
                             "sweeping when flop solve time is the question")
    parser.add_argument("--template", help="a config JSON to sweep boards over instead of "
                                           "the built-in shape (e.g. downloaded from "
                                           "/compare, which pins a real saved tree and "
                                           "leaves the flop as the only variable). Ranges "
                                           "must be inline. The template owns everything "
                                           "except the board, so --ranges, --spr, "
                                           "--accuracy-pct, --iterations and "
                                           "--checkpoint-every are all ignored - pinning a "
                                           "real spot means pinning its budget too")
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
    parser.add_argument("--checkpoint-every", type=int, default=100,
                        help="iterations between best-response checkpoints. This is the "
                             "RESOLUTION of the reported iteration count - the stop can "
                             "only fire on a checkpoint - so lower it when comparing two "
                             "arms that finish in a few hundred iterations")
    parser.add_argument("--no-pio", action="store_true",
                        help="htsolver only: skip the Pio solve and the cross-check, and "
                             "read the headline numbers from the artifact metadata. Use "
                             "this to A/B two engine configurations against each other "
                             "rather than against Pio - and note that a run without the "
                             "cross-check carries no correctness verdict")
    parser.add_argument("--qre-lambda", type=float,
                        help="solve for a QRE at this rationality, POT-NORMALIZED the way "
                             "/compare enters it (20 = an action worth 20%% more of the pot "
                             "is taken about 2.7x as often). Implies --no-pio: a QRE is not "
                             "Nash and the harness refuses to rate one against Pio")
    parser.add_argument("--qre-anneal-factor", type=float, default=0.0,
                        help="grow lambda to this multiple of --qre-lambda, turning QRE "
                             "into a homotopy to Nash. 0 = fixed lambda")
    parser.add_argument("--qre-anneal-at", type=int, default=50,
                        help="iteration at which lambda reaches that multiple")
    parser.add_argument("--out", default=os.path.join(WATCHER_DIR, "bench_boards_results.json"))
    args = parser.parse_args()

    # A QRE artifact cannot be compared to Pio, and engine_compare refuses it.
    # Fail here rather than after the first spot has already been solved.
    qre = None
    if args.qre_lambda is not None:
        if not (args.qre_lambda > 0):
            parser.error("--qre-lambda must be positive")
        # Not because the harness refuses it - it will now solve the same tree
        # in Pio beside a QRE artifact - but because a benchmark wants the
        # engine's own cost, and a Pio solve on every board would dominate the
        # runtime while measuring a different solver.
        args.no_pio = True
        # The bench pot is always 100, so pot-normalized -> the engine's 1/chips.
        raw = args.qre_lambda / 100.0
        qre = {"mode": "qre", "lambda": [raw, raw]}
        if args.qre_anneal_factor > 1.0:
            qre["anneal"] = {"factor": args.qre_anneal_factor,
                             "full_at": args.qre_anneal_at}
    print(f"htsolver {'only' if args.no_pio else 'vs PioSolver'}"
          f"{'' if qre is None else f'  qre {qre}'}", flush=True)

    os.makedirs(BENCH_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    template = load_template(args.template) if args.template else None
    if args.boards is None:
        args.boards = 4 if args.only == "flop" else 10
    if template is not None:
        print(f"template {args.template}: pot {template.get('pot')}, "
              f"stacks {[p.get('stack') for p in template.get('players', [])]}, "
              f"board becomes the sweep variable", flush=True)
    else:
        print(f"SPR {args.spr:g} (pot 100, stacks {round(100 * args.spr)})", flush=True)

    families = []
    if args.only == "flop":
        families.append(("flop", FLOP_BOARDS[:args.boards]))
    else:
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
                                       args.accuracy_pct, args.threads, args.ranges, qre,
                                       args.checkpoint_every, args.spr, template)
            artifact = os.path.join(ENGINE_DIR, "out", "_bench", f"{name}.hta")
            out_prefix = os.path.join(OUT_DIR, f"{name}.compare")
            row = {"family": family, "board": board, "name": name, "ranges": args.ranges,
                   "spr": None if template is not None else args.spr,
                   "template": args.template}
            try:
                row.update(run_engine(config_path))
                if args.no_pio:
                    summary = summarize_engine_only(artifact)
                    row["qre_mode"] = summary.get("qre_mode")
                    row["qre_lambda"] = summary.get("qre_lambda")
                    row["qre_gap_chips"] = summary.get("qre_gap_chips")
                    row["exploitable_pct_pot"] = summary.get("exploitable_pct_pot")
                else:
                    summary = run_compare(artifact, out_prefix, args.accuracy_pct,
                                          args.timeout)
                    row["pass"] = summary.get("cross_check", {}).get("pass")
                    row["gate"] = summary.get("cross_check", {}).get("gate")
                row["timing"] = summary.get("timing", {})
                row["memory"] = summary.get("memory", {})
                row["decision_nodes"] = summary.get("decision_nodes")
                row["ht_nashconv"] = summary.get("ht", {}).get("nashconv")
                t = row["timing"]
                if args.no_pio:
                    print(f"  ht {t.get('ht_solve_s')} s, {t.get('ht_iterations')} iters,"
                          f" {mb(row['memory'].get('ht_peak_bytes'))} MB", flush=True)
                else:
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
        # Format to strings first: a missing value is None, and None has no
        # alignment format (the engine-only path leaves every pio field unset).
        hts = "-" if ht is None else f"{ht:.2f}"
        pios = "-" if pio is None else f"{pio:.2f}"
        print(f"{row['board']:<18}{row.get('decision_nodes') or 0:>8}"
              f"{hts:>9}"
              f"{pios:>9}{ratio:>8}"
              f"{mb(m.get('ht_peak_bytes')):>8}{mb(m.get('pio_peak_bytes')):>8}"
              f"{t.get('ht_iterations') or 0:>9}"
              f"{('-' if row.get('pass') is None else ('PASS' if row['pass'] else 'FAIL')):>7}")

    if args.no_pio:
        # No Pio to take a ratio against, so report the engine's own numbers.
        # Comparing two arms means running this twice and diffing the medians;
        # iterations is the more trustworthy of the two, since wall clock below
        # a few percent is inside this machine's noise.
        def med(xs):
            return sorted(xs)[len(xs) // 2] if xs else None

        for family, _ in families:
            done = [r for r in rows if r["family"] == family and "error" not in r
                    and r["timing"].get("ht_solve_s")]
            if not done:
                continue
            secs = [r["timing"]["ht_solve_s"] for r in done]
            iters = [r["timing"]["ht_iterations"] for r in done
                     if r["timing"].get("ht_iterations")]
            mem = [r["memory"]["ht_peak_bytes"] for r in done
                   if r["memory"].get("ht_peak_bytes")]
            print(f"\n{family}: n={len(done)}  ht median {med(secs):.2f} s"
                  f"  (min {min(secs):.2f}, max {max(secs):.2f})"
                  f"  iters median {med(iters)}"
                  f"  peak median {mb(med(mem))} MB")
            if any(r.get("qre_mode") == "qre" for r in done):
                plateau = [r["exploitable_pct_pot"] for r in done
                           if r.get("exploitable_pct_pot") is not None]
                gaps = [r["qre_gap_chips"] for r in done
                        if r.get("qre_gap_chips") is not None]
                print(f"{' ' * len(family)}  QRE: gap median "
                      f"{med(gaps):.4f} chips, PLAIN exploitability median "
                      f"{med(plateau):.4f}% of pot")
        return 0

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
