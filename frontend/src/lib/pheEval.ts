// src/lib/pheEval.ts
// Adapter around the `phe` package to evaluate NLH (7-card) and PLO4/PLO5
// using "lowest value wins" semantics.
//
// Usage (examples):
//   const x = evalHoldem7(["Ah","Kd","Qs","2c","9h"], ["As","Kh"]); // NLH
//   const y = evalOmaha4(["Ah","Kd","Qs","2c","9h"], ["As","Kh","Qh","Th"]); // PLO4
//   const z = evalOmaha5(["Ah","Kd","Qs","2c","9h"], ["As","Kh","Qh","Th","9s"]); // PLO5
//
// All inputs must be standard 2-char card strings like "Ah", "Td", "9s", "2c".

import * as PheNS from "phe";

/** Shape we return everywhere (lower is better, ties are equal values). */
export type EvalResult = { value: number };

/** Statically type the bits we use from `phe` without `any`. */
type EvaluateCardsFn = (cards: string[]) => number;

/** Bind `phe` functions (Vite/CJS interop friendly). */
const { evaluateCardsFast, evaluateCards } = (PheNS as unknown) as {
  evaluateCardsFast: EvaluateCardsFn;
  evaluateCards: EvaluateCardsFn;
};

/** Prefer the fast version, fall back just in case. */
const evalCards: EvaluateCardsFn = typeof evaluateCardsFast === "function"
  ? evaluateCardsFast
  : evaluateCards;

/** --- Small, fixed combination tables (no allocations in hot path) --- */

// C(5,3) = 10
const COMB_5C3: ReadonlyArray<readonly [number, number, number]> = [
  [0,1,2],[0,1,3],[0,1,4],
  [0,2,3],[0,2,4],[0,3,4],
  [1,2,3],[1,2,4],[1,3,4],
  [2,3,4],
];

// C(4,2) = 6
const COMB_4C2: ReadonlyArray<readonly [number, number]> = [
  [0,1],[0,2],[0,3],[1,2],[1,3],[2,3],
];

// C(5,2) = 10
const COMB_5C2: ReadonlyArray<readonly [number, number]> = [
  [0,1],[0,2],[0,3],[0,4],
  [1,2],[1,3],[1,4],
  [2,3],[2,4],
  [3,4],
];

/** Normalize a single card like 'aH' -> 'Ah'. Keeps simple/strict formatting. */
const normCard = (c: string): string =>
  c && c.length >= 2 ? c[0].toUpperCase() + c[1].toLowerCase() : c;

/** Normalize arrays once (cheap). */
const normCards = (arr: string[]): string[] => arr.map(normCard);

/** --------- Public evaluators (lower value is stronger) --------- */

/**
 * NLH: evaluate best 5 out of the 7 cards [hole2 + board5].
 * `phe` handles 5–7 cards directly.
 */
export function evalHoldem7(board5: string[], hole2: string[]): EvalResult {
  const v = evalCards(normCards([...hole2, ...board5]));
  return { value: v };
}

/**
 * PLO4: evaluate EXACTLY 2 from 4 hole and EXACTLY 3 from board5.
 * We brute the 6 * 10 = 60 combos and take the minimum (best).
 */
export function evalOmaha4(board5: string[], hole4: string[]): EvalResult {
  const b = normCards(board5);
  const h = normCards(hole4);

  let best = Number.POSITIVE_INFINITY;

  // choose 3 from board (10 ways)
  for (let bi = 0; bi < COMB_5C3.length; bi++) {
    const [b0,b1,b2] = COMB_5C3[bi];
    const cb0 = b[b0], cb1 = b[b1], cb2 = b[b2];

    // choose 2 from 4 (6 ways)
    for (let hi = 0; hi < COMB_4C2.length; hi++) {
      const [h0,h1] = COMB_4C2[hi];
      const v = evalCards([h[h0], h[h1], cb0, cb1, cb2]);
      if (v < best) best = v;
    }
  }
  return { value: best };
}

/**
 * PLO5: evaluate EXACTLY 2 from 5 hole and EXACTLY 3 from board5.
 * We brute the 10 * 10 = 100 combos and take the minimum (best).
 */
export function evalOmaha5(board5: string[], hole5: string[]): EvalResult {
  const b = normCards(board5);
  const h = normCards(hole5);

  let best = Number.POSITIVE_INFINITY;

  // choose 3 from board (10 ways)
  for (let bi = 0; bi < COMB_5C3.length; bi++) {
    const [b0,b1,b2] = COMB_5C3[bi];
    const cb0 = b[b0], cb1 = b[b1], cb2 = b[b2];

    // choose 2 from 5 (10 ways)
    for (let hi = 0; hi < COMB_5C2.length; hi++) {
      const [h0,h1] = COMB_5C2[hi];
      const v = evalCards([h[h0], h[h1], cb0, cb1, cb2]);
      if (v < best) best = v;
    }
  }
  return { value: best };
}

/** Utility compare if you need it (true if a beats b). */
export function isBetter(a: EvalResult, b: EvalResult): boolean {
  return a.value < b.value;
}
