// src/lib/handEval.ts
// Shared, synchronous poker hand evaluator built on the `phe` library.
// Used both by the Monte-Carlo equity worker (pheEquityWorker) and directly on
// the main thread (e.g. the hand recorder, to decide showdowns without asking
// the user). In PHE, a LOWER score is a better hand (1 = royal flush).
import * as PHE from "phe";

export type EvalGame = "texas-holdem" | "omaha4" | "omaha5";

type Eval5 = (cards: string[]) => number;

function resolveEval5(): Eval5 {
  const mod = PHE as Record<string, unknown>;
  const cand1 = mod.evaluateCards;
  if (typeof cand1 === "function") return cand1 as Eval5;
  const cand2 = mod.evaluate;
  if (typeof cand2 === "function") return cand2 as Eval5;
  throw new Error("Could not find evaluateCards(cards) in 'phe'.");
}

const eval5: Eval5 = resolveEval5();

/** Best 5-of-7 for hold'em (any 2 of the hole, plus board). */
export function bestHoldem(board5: string[], hole2: string[]): number {
  const seven = [hole2[0], hole2[1], ...board5];
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 7; j++) {
      const hand5: string[] = [];
      for (let k = 0; k < 7; k++) {
        if (k !== i && k !== j) hand5.push(seven[k]);
      }
      const v = eval5(hand5);
      if (v < best) best = v;
    }
  }
  return best;
}

/** Best Omaha hand: exactly 2 from the hand (4 or 5 cards) + 3 from the board. */
export function bestOmaha(board5: string[], hole: string[]): number {
  const k = hole.length; // 4 or 5
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < k - 1; i++) {
    for (let j = i + 1; j < k; j++) {
      const h0 = hole[i];
      const h1 = hole[j];
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 4; b++) {
          for (let c = b + 1; c < 5; c++) {
            const v = eval5([h0, h1, board5[a], board5[b], board5[c]]);
            if (v < best) best = v;
          }
        }
      }
    }
  }
  return best;
}

/** Score a single hand on a complete (5-card) board. Lower is better. */
export function handScore(game: EvalGame, board5: string[], hole: string[]): number {
  return game === "texas-holdem" ? bestHoldem(board5, hole) : bestOmaha(board5, hole);
}

/** The exact 5 cards forming the best Omaha hand (2 from hand + 3 from board). */
export function bestOmahaCards(board5: string[], hole: string[]): string[] {
  const k = hole.length;
  let best = Number.POSITIVE_INFINITY;
  let bestCards: string[] = [];
  for (let i = 0; i < k - 1; i++) {
    for (let j = i + 1; j < k; j++) {
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 4; b++) {
          for (let c = b + 1; c < 5; c++) {
            const five = [hole[i], hole[j], board5[a], board5[b], board5[c]];
            const v = eval5(five);
            if (v < best) {
              best = v;
              bestCards = five;
            }
          }
        }
      }
    }
  }
  return bestCards;
}

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS = ["h", "d", "c", "s"];

/**
 * Exact equity (win% including split share) per hand by enumerating every
 * remaining board runout. Fast for the flop (2 to come) and turn (1 to come);
 * do NOT call this preflop (0 board cards) — use the Monte-Carlo worker instead.
 * `hands` are complete hole-card sets; `board` has 3, 4, or 5 cards.
 */
export function exactEquity(
  game: EvalGame,
  board: string[],
  hands: string[][]
): number[] {
  const used = new Set<string>([...board, ...hands.flat()]);
  const avail: string[] = [];
  for (const r of RANKS) for (const s of SUITS) if (!used.has(r + s)) avail.push(r + s);

  const need = 5 - board.length;
  const share = hands.map(() => 0);
  let total = 0;

  const tally = (b5: string[]) => {
    const winners = evalWinners(game, b5, hands);
    if (winners.length) {
      const w = 1 / winners.length;
      for (const wi of winners) share[wi] += w;
    }
    total++;
  };

  if (need <= 0) {
    tally(board.slice(0, 5));
  } else if (need === 1) {
    for (let i = 0; i < avail.length; i++) tally([...board, avail[i]]);
  } else {
    // need === 2 (flop): every pair of remaining cards.
    for (let i = 0; i < avail.length; i++)
      for (let j = i + 1; j < avail.length; j++) tally([...board, avail[i], avail[j]]);
  }

  return share.map((s) => (total > 0 ? (s / total) * 100 : 0));
}

/** Score a complete 5-card hand directly (no board). Lower is better. */
export function rank5(cards5: string[]): number {
  return eval5(cards5);
}

/**
 * Indices of the winning hand(s) among complete 5-card hands. More than one
 * index means a tie. `hands` may contain nulls (which never win). Use this for
 * variant-agnostic "which five-card hand is best?" comparisons.
 */
export function evalWinners5(hands: (string[] | null)[]): number[] {
  const scores = hands.map((h) =>
    h && h.length === 5 ? eval5(h) : Number.POSITIVE_INFINITY
  );
  const best = Math.min(...scores);
  const winners: number[] = [];
  if (!Number.isFinite(best)) return winners;
  scores.forEach((s, i) => {
    if (s === best) winners.push(i);
  });
  return winners;
}

/**
 * Indices of the winning hand(s) on a complete board. More than one index means
 * a tie (chop). `hands` may contain nulls (unknown/mucked) which never win.
 */
export function evalWinners(
  game: EvalGame,
  board5: string[],
  hands: (string[] | null)[]
): number[] {
  const scores: number[] = new Array(hands.length).fill(Number.POSITIVE_INFINITY);
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < hands.length; i++) {
    const h = hands[i];
    if (!h || h.length < 2) continue;
    const s = handScore(game, board5, h);
    scores[i] = s;
    if (s < bestScore) bestScore = s;
  }

  const winners: number[] = [];
  if (!Number.isFinite(bestScore)) return winners;
  for (let i = 0; i < hands.length; i++) {
    if (scores[i] === bestScore) winners.push(i);
  }
  return winners;
}
