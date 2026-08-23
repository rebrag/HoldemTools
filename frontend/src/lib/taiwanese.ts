// src/lib/taiwanese.ts
// Taiwanese poker primitives. Pure module, safe to import from workers.
//
// The game: each player is dealt 7 cards and splits them into a 1-card
// hold'em hand (top), a 2-card hold'em hand (middle), and a 4-card Omaha
// hand (bottom). A 5-card board is dealt; top and middle are evaluated as
// hold'em hands against the board, the bottom as Omaha (exactly 2 from the
// hand + 3 from the board). Double boards are a house extension the official
// sources do not describe: each board is scored as its own full round.
import { handRank } from "phe";

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

// Scoring: rows always pay top 1 / middle 2 / bottom 3, and the outright
// best hand in each row collects from EVERY other player (second best
// collects nothing); ties split the collected pot and pay nothing. Two rule
// sets sit on top of that, chosen by the royalties flag:
//   royalties ON  - pokernews.com/poker-rules/taiwanese-poker.htm: the row
//                   winner also collects a royalty for hand strength, and a
//                   scoop pays 3.
//   royalties OFF - the client's home game (confirmed by his friend,
//                   2026-08-23): no royalties, and a scoop pays 8.
// A scoop means winning every row on every board outright: 3 rows on a
// single board, all 6 on the house double board. That reproduces the home
// game's stated maxima against one opponent: 6 + 8 = 14 on one board,
// 12 + 8 = 20 on two.
// Where the two published sources contradict each other, the client chose
// the PokerNews reading: losing players pay the winner's royalty in full,
// even when their own hand would qualify for the same royalty (the Infogram
// worked example waives it in that case).
export const ROW_POINTS = { top: 1, middle: 2, bottom: 3 } as const;
export const SCOOP_POKERNEWS = 3;
export const SCOOP_HOUSE = 8;

// Royalties by phe hand category (handRank: 0 = straight flush ... 8 = high
// card), per row. Straight through two pair straight from the PokerNews
// chart; the Infogram bonus chart is an image, but its worked example (full
// house in the middle pays 3) matches this table.
export const ROYALTY_TABLE: Record<RowName, readonly number[]> = {
  //        SF  quads FH  flush str trips 2pr pair high
  top: [12, 6, 4, 3, 3, 2, 1, 0, 0],
  middle: [10, 5, 3, 2, 2, 1, 0, 0, 0],
  bottom: [8, 4, 2, 0, 0, 0, 0, 0, 0],
};

export type RowName = "top" | "middle" | "bottom";

/** phe strengths for one player's three rows on one board. Lower = better. */
export interface RowScores {
  top: number;
  middle: number;
  bottom: number;
}

const ROWS: readonly RowName[] = ["top", "middle", "bottom"];

/**
 * Hero's net points for a whole deal against the whole table; negative means
 * hero pays. `hero` holds rows per board; `opps[i]` holds opponent i's rows
 * per board. This is the single place points are decided: the advisor, the
 * explainer panel, and any future scoring UI must all go through it.
 */
export function scoreDealHero(
  hero: RowScores[],
  opps: RowScores[][],
  royalties: boolean
): number {
  const nOpp = opps.length;
  const nBoards = hero.length;
  const scoop = royalties ? SCOOP_POKERNEWS : SCOOP_HOUSE;
  let net = 0;
  let heroOutright = 0;
  // Rows each opponent won outright, to detect an opponent scooping hero.
  const oppOutright = new Int32Array(nOpp);
  for (let b = 0; b < nBoards; b++) {
    for (const row of ROWS) {
      const h = hero[b][row];
      let min = h;
      for (let i = 0; i < nOpp; i++) if (opps[i][b][row] < min) min = opps[i][b][row];
      let winCount = h === min ? 1 : 0;
      let soleOpp = -1;
      for (let i = 0; i < nOpp; i++) {
        if (opps[i][b][row] === min) { winCount++; soleOpp = i; }
      }
      const pay = ROW_POINTS[row] + (royalties ? ROYALTY_TABLE[row][handRank(min)] : 0);
      if (h === min) {
        // Winner(s) collect from every loser and split; ties pay nothing.
        net += (pay * (nOpp + 1 - winCount)) / winCount;
        if (winCount === 1) heroOutright++;
      } else {
        net -= pay;
        if (winCount === 1) oppOutright[soleOpp]++;
      }
    }
  }
  // The scoop needs every row on every board: 3 rows single, all 6 double.
  const need = 3 * nBoards;
  if (heroOutright === need) {
    net += scoop * nOpp;
  } else {
    for (let i = 0; i < nOpp; i++) if (oppOutright[i] === need) net -= scoop;
  }
  return net;
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

// ---------- foul rule (client's decision, from the PokerNews wording) ----------

/**
 * Pre-board strength of a row's hole cards, comparable across row sizes, for
 * the "bottom must be strongest, top weakest" setting rule. Category first
 * (quads > trips > two pair > pair > high card), then ranks high-to-low, ace
 * high. Encoded so a plain numeric compare orders hands; a shorter hand that
 * ties a longer one's prefix counts as weaker, so a bare high card can always
 * sit under a two-card hand led by the same rank. The board is unknown at
 * setting time, so hole cards are the only thing a pre-board rule CAN
 * measure; this is a modeling choice, documented on the page.
 */
export function preBoardKey(cards: string[]): number {
  const counts = new Map<number, number>();
  for (const c of cards) {
    const v = VAL[c[0].toUpperCase()];
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const groups = [...counts.entries()]
    .map(([v, c]) => [c, v] as const)
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const cat =
    groups[0][0] === 4 ? 4
    : groups[0][0] === 3 ? 3
    : groups[0][0] === 2 ? (groups[1] && groups[1][0] === 2 ? 2 : 1)
    : 0;
  const r = [0, 0, 0, 0];
  groups.forEach(([, v], i) => { if (i < 4) r[i] = v; });
  return cat * 50625 + r[0] * 3375 + r[1] * 225 + r[2] * 15 + r[3]; // base 15
}

/** Legal per the setting rule: bottom >= middle >= top in pre-board strength. */
export function isLegalSplit(split: Split, cards7: string[]): boolean {
  const parts = splitCards(split, cards7);
  const b = preBoardKey(parts.bottom);
  const m = preBoardKey(parts.middle);
  const t = preBoardKey(parts.top);
  return b >= m && m >= t;
}

/**
 * The splits a player may set. Falls back to all 105 if the rule would leave
 * nothing, which no 7-card hand is known to do; the fallback just guarantees
 * the advisor can never go empty.
 */
export function legalSplits(cards7: string[]): Split[] {
  const legal = SPLITS.filter((s) => isLegalSplit(s, cards7));
  return legal.length > 0 ? legal : SPLITS.slice();
}

/**
 * Opponent model: opponents are dealt random 7 cards and set them with this
 * fixed, board-independent heuristic (strong pairs/suits/connectors to the
 * bottom, then the middle, best spare card on top), restricted to legal
 * splits. Hero EVs from the advisor are relative to this model, not to
 * optimally-playing opponents.
 */
export function heuristicSplit(cards7: string[]): Split {
  const vals = cards7.map((c) => VAL[c[0].toUpperCase()]);
  const suits = cards7.map((c) => c[1].toLowerCase());
  const candidates = legalSplits(cards7);
  let best = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const split of candidates) {
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
