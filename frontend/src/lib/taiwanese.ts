// src/lib/taiwanese.ts
// Taiwanese poker primitives. Pure module, safe to import from workers.
//
// The game: each player is dealt 7 cards and splits them into a 1-card
// hold'em hand (top), a 2-card hold'em hand (middle), and a 4-card Omaha
// hand (bottom). One or two 5-card boards are dealt; top and middle are
// evaluated as hold'em hands against each board, the bottom as Omaha
// (exactly 2 from the hand + 3 from the board).

/** All 21 index pairs (a < b) of a 7-card hand, in enumeration order. */
export const PAIRS: ReadonlyArray<readonly [number, number]> = (() => {
  const out: [number, number][] = [];
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 7; b++) out.push([a, b]);
  return out;
})();

/** All 35 index quads of a 7-card hand, in enumeration order. */
export const QUADS: ReadonlyArray<readonly [number, number, number, number]> = (() => {
  const out: [number, number, number, number][] = [];
  for (let a = 0; a < 4; a++)
    for (let b = a + 1; b < 5; b++)
      for (let c = b + 1; c < 6; c++)
        for (let d = c + 1; d < 7; d++) out.push([a, b, c, d]);
  return out;
})();

const PAIR_IDX: Record<string, number> = {};
PAIRS.forEach(([a, b], i) => { PAIR_IDX[`${a},${b}`] = i; });

export interface Split {
  top: number;
  middle: readonly [number, number];
  bottom: readonly [number, number, number, number];
  /** Index into PAIRS, for precomputed score-table lookups. */
  middleIdx: number;
  /** Index into QUADS, for precomputed score-table lookups. */
  bottomIdx: number;
}

/** All C(7,4) * C(3,2) = 105 ways to split 7 cards into top/middle/bottom. */
export function enumerateSplits(): Split[] {
  const out: Split[] = [];
  QUADS.forEach((quad, qi) => {
    const rest: number[] = [];
    for (let i = 0; i < 7; i++) if (!quad.includes(i)) rest.push(i);
    for (let skip = 0; skip < 3; skip++) {
      const top = rest[skip];
      const m = rest.filter((_, i) => i !== skip);
      const middle = [m[0], m[1]] as const;
      out.push({ top, middle, bottom: quad, middleIdx: PAIR_IDX[`${m[0]},${m[1]}`], bottomIdx: qi });
    }
  });
  return out;
}

/** The actual cards of a split, given the 7-card hand it indexes into. */
export function splitCards(
  split: Split,
  cards7: string[]
): { top: string[]; middle: string[]; bottom: string[] } {
  return {
    top: [cards7[split.top]],
    middle: split.middle.map((i) => cards7[i]),
    bottom: split.bottom.map((i) => cards7[i]),
  };
}

// Points: the client's rules text says a row win "scores 1 point", but its
// stated maxima (14 vs one opponent on a single board, 20 on double boards,
// "+6 more" from the second board) only reconcile when a row win is worth 2
// points: 3 rows * 2 + 8 = 14 and 6 rows * 2 + 8 = 20. These constants follow
// the maxima; confirm with the client. Every score flows through
// scorePairwise, so adjusting is a one-line change.
export const ROW_POINT = 2;
export const SCOOP_BONUS = 8;

/** phe strengths for one player's three rows on one board. Lower = better. */
export interface RowScores {
  top: number;
  middle: number;
  bottom: number;
}

const ROWS = ["top", "middle", "bottom"] as const;

/**
 * Net points hero wins from one opponent over the dealt board(s); negative
 * means hero pays. The scoop bonus requires winning every row on every board
 * outright (ties break a scoop).
 */
export function scorePairwise(hero: RowScores[], opp: RowScores[]): number {
  let pts = 0;
  let heroAll = true;
  let oppAll = true;
  for (let b = 0; b < hero.length; b++) {
    const h = hero[b];
    const o = opp[b];
    for (const row of ROWS) {
      if (h[row] < o[row]) { pts += ROW_POINT; oppAll = false; }
      else if (h[row] > o[row]) { pts -= ROW_POINT; heroAll = false; }
      else { heroAll = false; oppAll = false; }
    }
  }
  if (heroAll) pts += SCOOP_BONUS;
  else if (oppAll) pts -= SCOOP_BONUS;
  return pts;
}

// ---------- opponent model ----------

const VAL: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
  "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};

// Board-independent strength of a 4-card Omaha hand: pairs (trips slightly
// discounted since Omaha uses exactly two hole cards), suited pairs,
// closeness for straight potential, and a little for high cards.
function bottomStrength(vals: number[], suits: string[]): number {
  let s = 0;
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  for (const [v, c] of counts) {
    if (c === 2) s += 26 + 2 * v;
    else if (c >= 3) s += 20 + 2 * v;
  }
  const suitCounts = new Map<string, number>();
  for (const x of suits) suitCounts.set(x, (suitCounts.get(x) ?? 0) + 1);
  for (const c of suitCounts.values()) if (c >= 2) s += 7;
  const uniq = [...new Set(vals)].sort((a, b) => a - b);
  for (let i = 1; i < uniq.length; i++) {
    const gap = uniq[i] - uniq[i - 1];
    if (gap <= 3) s += 5 - gap;
  }
  for (const v of vals) s += v * 0.25;
  return s;
}

function middleStrength(vals: number[]): number {
  const [a, b] = vals;
  if (a === b) return 30 + 2.5 * a;
  return Math.max(a, b) + 0.4 * Math.min(a, b);
}

const SPLITS = enumerateSplits();

/**
 * Opponent model: opponents are dealt random 7 cards and set them with this
 * fixed, board-independent heuristic (strong pairs/suits/connectors to the
 * bottom, then the middle, best spare card on top). Hero EVs from the advisor
 * are relative to this model, not to optimally-playing opponents.
 */
export function heuristicSplit(cards7: string[]): Split {
  const vals = cards7.map((c) => VAL[c[0].toUpperCase()]);
  const suits = cards7.map((c) => c[1].toLowerCase());
  let best = SPLITS[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const split of SPLITS) {
    const bVals = split.bottom.map((i) => vals[i]);
    const bSuits = split.bottom.map((i) => suits[i]);
    const mVals = [vals[split.middle[0]], vals[split.middle[1]]];
    const score =
      bottomStrength(bVals, bSuits) +
      0.9 * middleStrength(mVals) +
      0.55 * vals[split.top];
    if (score > bestScore) { bestScore = score; best = split; }
  }
  return best;
}
