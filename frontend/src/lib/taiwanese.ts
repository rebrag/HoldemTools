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

// Scoring: rows always pay top 1 / middle 2 / bottom 3. The royalties flag
// picks between two rule sets that differ in more than the bonus chart:
//   royalties OFF - the client's home game, verified against a real scored
//                   4-player deal from that game (2026-08-24): every PAIR of
//                   players settles separately. Per board per row, the better
//                   hand takes that row's points from the other (ties take
//                   nothing), and winning every row on every board against
//                   one specific opponent outright takes an 8-point scoop
//                   from that opponent. No royalties. Vs one opponent this
//                   gives the stated maxima: 6 + 8 = 14 single board,
//                   12 + 8 = 20 double.
//   royalties ON  - pokernews.com/poker-rules/taiwanese-poker.htm: the
//                   outright best hand in each row collects from EVERY other
//                   player (second best collects nothing), plus a royalty for
//                   hand strength; ties split the collected pot and pay
//                   nothing; a scoop (every row on every board outright, vs
//                   the whole table) pays 3 from everyone. Where PokerNews
//                   and the Infogram sheet contradict each other, the client
//                   chose the PokerNews reading: losers pay the winner's
//                   royalty in full even when their own hand would qualify.
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

/** Per-player net points for one deal, split by where they came from. */
export interface DealBreakdown {
  top: number;
  middle: number;
  bottom: number;
  scoop: number;
  total: number;
}

// Scratch for scoreDealAll's hot path (solver workers call it millions of
// times per run); real tables never exceed 6 players.
const outrightScratch = new Int32Array(8);

/**
 * Score a whole deal for every player. `players[p][b]` holds player p's rows
 * on board b. This is the single place points are decided: the advisor, the
 * explainer panel, and the score checker must all go through it. Pass `out`
 * (same length as `players`) to reuse result objects across calls.
 */
export function scoreDealAll(
  players: RowScores[][],
  royalties: boolean,
  out?: DealBreakdown[]
): DealBreakdown[] {
  const n = players.length;
  const nBoards = players[0].length;
  let res: DealBreakdown[];
  if (out && out.length === n) {
    res = out;
    for (const d of res) { d.top = 0; d.middle = 0; d.bottom = 0; d.scoop = 0; d.total = 0; }
  } else {
    res = players.map(() => ({ top: 0, middle: 0, bottom: 0, scoop: 0, total: 0 }));
  }
  if (royalties) {
    // PokerNews: the outright best hand per row collects base + royalty from
    // every other player; ties split the collected pot and pay nothing.
    const outright = n <= 8 ? outrightScratch : new Int32Array(n);
    outright.fill(0);
    for (let b = 0; b < nBoards; b++) {
      for (const row of ROWS) {
        let min = Infinity;
        for (let i = 0; i < n; i++) if (players[i][b][row] < min) min = players[i][b][row];
        let winCount = 0;
        for (let i = 0; i < n; i++) if (players[i][b][row] === min) winCount++;
        const pay = ROW_POINTS[row] + ROYALTY_TABLE[row][handRank(min)];
        for (let i = 0; i < n; i++) {
          if (players[i][b][row] === min) {
            res[i][row] += (pay * (n - winCount)) / winCount;
            if (winCount === 1) outright[i]++;
          } else {
            res[i][row] -= pay;
          }
        }
      }
    }
    // The scoop needs every row on every board outright, vs the whole table.
    const need = 3 * nBoards;
    for (let i = 0; i < n; i++) {
      if (outright[i] !== need) continue;
      res[i].scoop += SCOOP_POKERNEWS * (n - 1);
      for (let j = 0; j < n; j++) if (j !== i) res[j].scoop -= SCOOP_POKERNEWS;
    }
  } else {
    // House: every pair of players settles separately, and the scoop is per
    // opponent: sweep every row on every board against that one player.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let iAll = true;
        let jAll = true;
        for (let b = 0; b < nBoards; b++) {
          for (const row of ROWS) {
            const si = players[i][b][row];
            const sj = players[j][b][row];
            if (si < sj) {
              res[i][row] += ROW_POINTS[row];
              res[j][row] -= ROW_POINTS[row];
              jAll = false;
            } else if (sj < si) {
              res[j][row] += ROW_POINTS[row];
              res[i][row] -= ROW_POINTS[row];
              iAll = false;
            } else {
              iAll = false;
              jAll = false;
            }
          }
        }
        if (iAll) { res[i].scoop += SCOOP_HOUSE; res[j].scoop -= SCOOP_HOUSE; }
        else if (jAll) { res[j].scoop += SCOOP_HOUSE; res[i].scoop -= SCOOP_HOUSE; }
      }
    }
  }
  for (const o of res) o.total = o.top + o.middle + o.bottom + o.scoop;
  return res;
}

/** Hero's net points for a deal; negative means hero pays. */
export function scoreDealHero(
  hero: RowScores[],
  opps: RowScores[][],
  royalties: boolean
): number {
  return scoreDealAll([hero, ...opps], royalties)[0].total;
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
 * bottom, then the middle, best spare card on top). Any card may go in any
 * row; the client's home game has no setting restriction. Hero EVs from the
 * advisor are relative to this model, not to optimally-playing opponents.
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
