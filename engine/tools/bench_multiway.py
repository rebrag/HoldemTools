#!/usr/bin/env python3
"""Does multiway postflop actually CONVERGE on tight ranges?

The open risk recorded in M8c: on the sampled core a dealt hand outside a
seat's range weighs zero, so the effective sample size per hero traversal is
the opponents' range fraction. Heads-up that already hurt - a 3%-range flop
spot sat at 26% of pot exploitable after 200k iterations. With N-1 opponents
the rate is a PRODUCT, so the fear is that it falls off a cliff with seat
count and the multiway product is unusable on the ranges people actually
solve.

Chip conservation says nothing about this. Conservation is a property of each
dealt hand and holds exactly at any seat count and any iteration count, so a
completely unconverged solve still conserves perfectly. That is why this
exists as a separate measurement rather than being read off the solve output.

Three things get measured, because no single one covers every seat count:

  1. EXPLOITABILITY at three seats, which is the only count where the sampled
     core can be graded. The best response there runs through the exact
     Showdown3 terminal, so it is real ground truth rather than a proxy, and
     the vectorized solve of the same spot is the reference.

  2. SEED SPREAD at any seat count: solve the same spot under different
     seeds and look at how far the root EVs move. Ground-truth-free, so it
     works at 4+ where no best response exists, and it bounds the noise from
     below - two seeds can agree and both be wrong, but if they disagree by
     X chips the answer is not settled to better than X.

  3. The IN-RANGE DEAL RATE, computed here rather than measured, because it
     is the mechanism the other two are symptoms of and it is what predicts
     the seat scaling.

Usage:
    python tools/bench_multiway.py                      # the standard sweep
    python tools/bench_multiway.py --quick              # fewer points
    python tools/bench_multiway.py --engine ./build/engine.exe
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.dirname(HERE)
DEFAULT_ENGINE = os.path.join(ENGINE_DIR, "build", "engine.exe")
BOARD = "Js 8c Td 3h 7h"

RANKS = "AKQJT98765432"


def full_range() -> str:
    out = []
    for i, a in enumerate(RANKS):
        for j, b in enumerate(RANKS):
            if j < i:
                continue
            if i == j:
                out.append(a + a)
            else:
                out.append(f"{a}{b}s")
                out.append(f"{a}{b}o")
    return ",".join(out)


# Four widths spanning what people actually solve. The percentages are
# computed rather than asserted (pairs 6 combos, suited 4, offsuit 12).
RANGES = {
    "100%": full_range(),
    "40%": (
        "AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,"
        "AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,"
        "AKo,AQo,AJo,ATo,A9o,"
        "KQs,KJs,KTs,K9s,K8s,K7s,KQo,KJo,KTo,K9o,"
        "QJs,QTs,Q9s,Q8s,QJo,QTo,Q9o,JTs,J9s,J8s,JTo,J9o,"
        "T9s,T8s,T9o,98s,97s,87s,86s,76s,75s,65s,54s"
    ),
    "15%": (
        "AA,KK,QQ,JJ,TT,99,88,77,66,55,"
        "AKs,AKo,AQs,AQo,AJs,AJo,ATs,KQs,KQo,KJs,KTs,"
        "QJs,QTs,JTs,T9s,98s,87s,76s,65s,A5s,A4s"
    ),
    "6%": "AA,KK,QQ,JJ,TT,99,AKs,AKo,AQs,AQo,AJs,KQs",
}


def combo_count(range_text: str) -> int:
    total = 0
    for hand in range_text.split(","):
        hand = hand.strip()
        if not hand:
            continue
        if len(hand) == 2:
            total += 6
        elif hand.endswith("s"):
            total += 4
        else:
            total += 12
    return total


def in_range_rate(range_text: str, seats: int, board: str, trials: int = 40000) -> float:
    """Fraction of uniform deals where EVERY opponent's hand is in range.

    Simulated rather than derived so card removal between the seats and the
    board is real rather than assumed independent. The hero is vectorized, so
    only the other seats have to land in range - which is why this is a
    product over seats-1 and why it collapses so fast.
    """
    board_cards = set(re.findall(r"[2-9TJQKA][hdcs]", board))
    deck = [r + s for r in "23456789TJQKA" for s in "hdcs" if (r + s) not in board_cards]
    live = set()
    for hand in range_text.split(","):
        hand = hand.strip()
        if not hand:
            continue
        a, b = hand[0], hand[1]
        suits = "hdcs"
        if len(hand) == 2:
            for i in range(4):
                for j in range(i + 1, 4):
                    live.add(frozenset({a + suits[i], b + suits[j]}))
        elif hand.endswith("s"):
            for s in suits:
                live.add(frozenset({a + s, b + s}))
        else:
            for s1 in suits:
                for s2 in suits:
                    if s1 != s2:
                        live.add(frozenset({a + s1, b + s2}))
    live = {h for h in live if not (set(h) & board_cards)}

    rng = random.Random(12345)
    hits = 0
    need = seats - 1
    for _ in range(trials):
        drawn = rng.sample(deck, 2 * need)
        ok = True
        for k in range(need):
            if frozenset({drawn[2 * k], drawn[2 * k + 1]}) not in live:
                ok = False
                break
        if ok:
            hits += 1
    return hits / trials


def build_config(seats: int, range_text: str, iters: int, sampled: bool, seed: int,
                 out_path: str) -> dict:
    sizing = {"bets": [50, 700], "raises": [700], "max_raises": 1, "allin_threshold": 0.9}
    algorithm: dict = {"update": "dcfr"}
    if sampled:
        algorithm["family"] = "sampled"
        algorithm["sampled"] = {"seed": seed, "batch": 4096, "lanes": 4}
    names = ["OOP", "MID", "BTN", "S3", "S4", "S5", "S6", "S7", "S8"]
    return {
        "schema": 1,
        "game": "nlhe",
        "board": BOARD,
        "pot": 100,
        "chip_scale": 100,
        "players": [
            {"seat": names[i], "stack": 700, "range": range_text} for i in range(seats)
        ],
        "bet_sizing": {"river": sizing},
        "algorithm": algorithm,
        "qre": {"mode": "nash"},
        "budget": {"iterations": iters, "checkpoint_every": max(1, iters // 6)},
        "memory_limit_gb": 24,
        "output": {"path": out_path, "strategy_quantize_u8": True, "ev_float32": True,
                   "rollups_169": True},
    }


ITER_RE = re.compile(
    r"iter\s+(\d+)\s+nashconv\s+([-\d.e+]+)\s+exploitable\s+([-\d.e+]+)"
)
SAMPLED_EV_RE = re.compile(r"sampled ev \([^)]*\)\s+(.*)")
EV_RE = re.compile(r"\bev\s+((?:[-\d.e+]+\s*)+?)\s+elapsed")


def run(engine: str, config: dict, tmpdir: str) -> dict:
    path = os.path.join(tmpdir, "cfg.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(config, fh)
    proc = subprocess.run([engine, "solve", path], capture_output=True, text=True,
                          cwd=ENGINE_DIR, timeout=3600)
    text = proc.stdout + proc.stderr
    if proc.returncode != 0:
        raise RuntimeError(f"engine failed ({proc.returncode}):\n{text[-1500:]}")
    curve = [(int(m.group(1)), float(m.group(3))) for m in ITER_RE.finditer(text)]
    evs = None
    m = SAMPLED_EV_RE.search(text)
    if m:
        evs = [float(x) for x in m.group(1).split()]
    else:
        last = None
        for m2 in EV_RE.finditer(text):
            last = m2
        if last:
            evs = [float(x) for x in last.group(1).split()]
    return {"curve": curve, "evs": evs, "text": text}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default=DEFAULT_ENGINE)
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    if not os.path.exists(args.engine):
        print(f"engine not found at {args.engine} - build it first (engine/build.ps1)")
        return 2

    pot = 100.0
    widths = ["100%", "15%", "6%"] if args.quick else ["100%", "40%", "15%", "6%"]
    sampled_iters = [50_000, 200_000] if args.quick else [50_000, 200_000, 800_000]

    print(f"board {BOARD}, pot 100, stacks 700 (SPR 7), b50 + shove, one raise\n")

    # ---- 3. the mechanism, first, because it predicts the rest ------------
    print("== in-range deal rate: fraction of deals where every opponent is in range ==")
    header = "  range     combos  " + "".join(f"{s:>9}" for s in (3, 4, 5, 6, 8)) + "   seats"
    print(header)
    for w in widths:
        rate = [in_range_rate(RANGES[w], s, BOARD) for s in (3, 4, 5, 6, 8)]
        cells = "".join(f"{100 * r:>8.2f}%" for r in rate)
        print(f"  {w:<8} {combo_count(RANGES[w]):>6}  {cells}")
    print("  The hero stays vectorized, so only the OTHER seats have to land in\n"
          "  range - this is a product over seats-1 and that is the whole story.\n")

    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "bench.hta")

        # ---- 1. exploitability at three seats, against exact ground truth --
        print("== 3 seats: exploitability, % of pot (best response is EXACT here) ==")
        cols = "".join(f"{n // 1000:>10}k" for n in sampled_iters)
        print(f"  range      vectorized{cols}   sampled deals")
        for w in widths:
            ref = run(args.engine, build_config(3, RANGES[w], 2000, False, 1, out), tmp)
            ref_expl = ref["curve"][-1][1] if ref["curve"] else float("nan")
            cells = []
            for iters in sampled_iters:
                got = run(args.engine, build_config(3, RANGES[w], iters, True, 1, out), tmp)
                expl = got["curve"][-1][1] if got["curve"] else float("nan")
                cells.append(f"{100 * expl / pot:>10.3f}%")
            print(f"  {w:<8} {100 * ref_expl / pot:>10.4f}%" + "".join(cells))
        print("  vectorized = 2000 iterations of the exact core, the reference.\n")

        # ---- 2. seed spread, which works at any seat count -----------------
        print("== seed spread: worst per-seat root EV gap between two seeds, chips ==")
        seat_counts = [3, 4, 6] if args.quick else [3, 4, 6, 8]
        print("  range    " + "".join(f"{s:>12}-way" for s in seat_counts))
        for w in widths:
            cells = []
            for seats in seat_counts:
                iters = sampled_iters[-1]
                a = run(args.engine, build_config(seats, RANGES[w], iters, True, 1, out), tmp)
                b = run(args.engine, build_config(seats, RANGES[w], iters, True, 999, out), tmp)
                if not a["evs"] or not b["evs"]:
                    cells.append(f"{'n/a':>16}")
                    continue
                worst = max(abs(x - y) for x, y in zip(a["evs"], b["evs"]))
                cells.append(f"{worst:>16.3f}")
            print(f"  {w:<8}" + "".join(cells))
        print(f"  {sampled_iters[-1]:,} deals per solve, seeds 1 and 999.")
        print("  A gap here is noise the solve has not resolved. Agreement is\n"
              "  necessary, not sufficient - two seeds can agree and both be wrong.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
