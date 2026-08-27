#!/usr/bin/env python3
"""Interleaved A/B timing for htsolver, because the obvious way is wrong.

The obvious way - build A, time it a few times, build B, time it a few times -
does not work on this machine. A build takes long enough that CPU frequency and
thermal state differ between the two blocks, and the resulting drift is larger
than the effects being measured. A whole session's worth of sub-3% conclusions
was produced and then withdrawn that way: three separate changes were each
"measured" at 1.8-3.8% by block timing and all three came out inside the noise
when the same binaries were finally run interleaved.

So this script does two things the block method cannot:

  1. Builds BOTH binaries first, then alternates them run by run, so drift hits
     both arms equally instead of landing entirely on one.
  2. Alternates the ORDER as well (A,B then B,A), because whichever binary runs
     first in a pair is systematically advantaged or penalised, and that bias
     is itself a few percent.

It then reports the per-round paired differences, not just the medians. If the
sign of the difference is not consistent across rounds, the effect is not
resolved by this benchmark no matter what the medians say.

Usage:
    python tools/bench_ab.py <ref-a> <ref-b> [--config configs/_bench/p_flop_t1.json]
                             [--rounds 6] [--label-a base] [--label-b new]

A ref is anything `git checkout <ref> -- src` accepts, or the literal WORKTREE
to use the current (possibly uncommitted) source. Tests are not built: older
refs generally will not compile against newer tests, and only engine.exe is
timed.
"""

from __future__ import annotations

import argparse
import re
import shutil
import statistics
import subprocess
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
SOLVE_TIME = re.compile(r"solve time ([0-9.]+) s")


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ENGINE, capture_output=True, text=True, **kw)


def build_variant(ref: str, out_name: str) -> Path:
    """Check out `ref`'s src, build, and stash engine.exe under `out_name`."""
    keep = ENGINE.parent / "_bench_ab_src"
    if ref != "WORKTREE":
        if keep.exists():
            shutil.rmtree(keep)
        shutil.copytree(ENGINE / "src", keep)
        run(["git", "checkout", ref, "--", "src"])
    # ninja keys off mtimes and a git checkout can hand back older ones.
    for f in (ENGINE / "src").rglob("*"):
        if f.suffix in (".cpp", ".hpp"):
            f.touch()
    # build.ps1 throws when the tests fail to compile against an older src.
    # engine.exe is built before the test target, so it is still valid.
    run(["powershell", "-NoProfile", "-Command", "./build.ps1"])
    exe = ENGINE / "build" / "engine.exe"
    if not exe.exists():
        sys.exit(f"build produced no engine.exe for {ref}")
    dst = ENGINE / "build" / f"{out_name}.exe"
    shutil.copy2(exe, dst)
    if ref != "WORKTREE":
        shutil.rmtree(ENGINE / "src")
        shutil.copytree(keep, ENGINE / "src")
        shutil.rmtree(keep)
        run(["git", "reset", "-q", "HEAD", "--", "src"])
    return dst


def time_once(exe: Path, config: str) -> float:
    out = run([str(exe), "solve", config])
    m = SOLVE_TIME.search(out.stdout)
    if not m:
        sys.exit(f"no solve time in output of {exe.name}:\n{out.stdout}\n{out.stderr}")
    return float(m.group(1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ref_a")
    ap.add_argument("ref_b")
    ap.add_argument("--config", default="configs/_bench/p_flop_t1.json")
    ap.add_argument("--rounds", type=int, default=6)
    ap.add_argument("--label-a", default="A")
    ap.add_argument("--label-b", default="B")
    args = ap.parse_args()

    a_exe = build_variant(args.ref_a, "bench_a")
    b_exe = build_variant(args.ref_b, "bench_b")
    print(f"built {args.label_a}={args.ref_a} and {args.label_b}={args.ref_b}\n")

    a_times, b_times, diffs = [], [], []
    for i in range(args.rounds):
        # Alternate which arm goes first: order bias is real and comparable in
        # size to the effects this is used to measure.
        if i % 2 == 0:
            a = time_once(a_exe, args.config)
            b = time_once(b_exe, args.config)
        else:
            b = time_once(b_exe, args.config)
            a = time_once(a_exe, args.config)
        a_times.append(a)
        b_times.append(b)
        diffs.append(b - a)
        print(f"round {i + 1}: {args.label_a} {a:.4f}  {args.label_b} {b:.4f}  "
              f"delta {b - a:+.4f} s ({100.0 * (b - a) / a:+.2f}%)")

    ma, mb = statistics.median(a_times), statistics.median(b_times)
    wins_b = sum(1 for d in diffs if d < 0)
    print(f"\nmedian {args.label_a} {ma:.4f} s   median {args.label_b} {mb:.4f} s   "
          f"{100.0 * (mb - ma) / ma:+.2f}%")
    print(f"{args.label_b} faster in {wins_b}/{len(diffs)} rounds")

    # The verdict is about CONSISTENCY, not about the median gap. A median
    # difference with mixed signs is noise dressed up as a result.
    if wins_b == len(diffs):
        print(f"VERDICT: {args.label_b} is faster in every round - effect is resolved.")
    elif wins_b == 0:
        print(f"VERDICT: {args.label_a} is faster in every round - effect is resolved.")
    else:
        spread = (max(a_times) - min(a_times)) / ma * 100.0
        print(f"VERDICT: NOT RESOLVED. Sign flips across rounds; within-arm spread is "
              f"{spread:.1f}%. Do not report a percentage from this run.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
