// src/lib/taiwaneseSolver.ts
// The Taiwanese solver core, shared verbatim by the browser worker
// (src/workers/taiwaneseWorker.ts) and the Node precompute script
// (scripts/precompute-taiwanese.mjs). Environment-agnostic on purpose: no
// DOM, no `self`, no Node APIs - the hosts own messaging and threading.
//
// Hand evaluation runs on precomputed phe card codes with reused scratch
// arrays, because a library build touches hundreds of millions of 5-card
// evaluations. Scoring stays in lib/taiwanese (scoreDealAll), the single
// place points are decided.
import { evaluateCardCodes } from "phe";
import {
  PAIRS,
  QUADS,
  enumerateSplits,
  heuristicSplit,
  scoreDealAll,
  splitCards,
  type DealBreakdown,
  type RowScores,
  type Split,
} from "./taiwanese";
import type {
  AltSplit,
  BatchHandStat,
  LibraryEntry,
  LibraryFile,
  LibraryFileV1,
  LibraryLevelStats,
  OpponentLibrary,
  PolicyAtom,
} from "../pages/private/protocol";

/* ---------- cards and phe codes ---------- */
const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS = ["h", "d", "c", "s"];
const PHE_RANK: Record<string, number> = {
  "2": 0, "3": 1, "4": 2, "5": 3, "6": 4, "7": 5, "8": 6,
  "9": 7, T: 8, J: 9, Q: 10, K: 11, A: 12,
};
const PHE_SUIT: Record<string, number> = { s: 0, h: 1, d: 2, c: 3 };

export const ALL_CARDS: string[] = [];
const CODE: Record<string, number> = {};
for (const r of RANKS) {
  for (const s of SUITS) {
    const c = r + s;
    ALL_CARDS.push(c);
    CODE[c] = PHE_RANK[r] * 4 + PHE_SUIT[s];
  }
}

export const SPLITS = enumerateSplits();

/* ---------- LCG RNG (seed per run; each module instance has its own) ---------- */
let lcgState = 0;
export function seedLCG(seed: number) { lcgState = seed >>> 0; }
export function rand(): number { // [0,1)
  lcgState = (1664525 * lcgState + 1013904223) >>> 0;
  return (lcgState >>> 8) / 0x01000000;
}

/** Partial Fisher-Yates: uniformly draw n to the front of a. */
export function drawN(a: string[], n: number): void {
  for (let t = 0; t < n; t++) {
    const j = t + Math.floor(rand() * (a.length - t));
    const tmp = a[t];
    a[t] = a[j];
    a[j] = tmp;
  }
}

/* ---------- fast row evaluation on phe codes ---------- */
const arr5 = [0, 0, 0, 0, 0];
const arr6 = [0, 0, 0, 0, 0, 0];
const arr7 = [0, 0, 0, 0, 0, 0, 0];
// All 3-subsets of a 5-card board, for the Omaha 2 + 3 rule.
const TRIPLES: number[][] = [];
for (let a = 0; a < 3; a++)
  for (let b = a + 1; b < 4; b++)
    for (let c = b + 1; c < 5; c++) TRIPLES.push([a, b, c]);

function evalTop(holeCode: number, board: number[]): number {
  arr6[0] = holeCode;
  for (let i = 0; i < 5; i++) arr6[i + 1] = board[i];
  return evaluateCardCodes(arr6);
}
function evalMiddle(h1: number, h2: number, board: number[]): number {
  arr7[0] = h1;
  arr7[1] = h2;
  for (let i = 0; i < 5; i++) arr7[i + 2] = board[i];
  return evaluateCardCodes(arr7);
}
function evalBottom(holes: number[], board: number[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 4; j++) {
      arr5[0] = holes[i];
      arr5[1] = holes[j];
      for (const t of TRIPLES) {
        arr5[2] = board[t[0]];
        arr5[3] = board[t[1]];
        arr5[4] = board[t[2]];
        const v = evaluateCardCodes(arr5);
        if (v < best) best = v;
      }
    }
  }
  return best;
}

const codesOf = (cards: string[]): number[] => cards.map((c) => CODE[c]);

/* ---------- opponent play styles ---------- */

export type Mixing = "pure" | "mixed";

/** Alternatives kept per library hand, for mixed (human-like) play. */
export const TOP_K = 10;
/**
 * Softmax temperature in points/deal for mixed play: a split `gap` points
 * behind the best is chosen with weight exp(-gap / MIX_TEMPERATURE). At 0.3,
 * a near-tie plays almost as often as the best; a split a full point behind
 * is ~25x rarer; clearly bad splits never appear.
 */
export const MIX_TEMPERATURE = 0.3;

/** A hand's setting for one scenario, per the play style: "pure" samples
 *  its averaged self-play policy, "mixed" softens its latest best response. */
export function pickAlt(entry: LibraryEntry, mixing: Mixing): AltSplit | PolicyAtom {
  if (mixing === "pure") {
    const policy = entry.policy;
    if (policy.length === 1) return policy[0];
    let r = rand();
    for (const a of policy) {
      r -= a.weight;
      if (r <= 0) return a;
    }
    return policy[policy.length - 1];
  }
  const alts = entry.alts;
  if (alts.length === 1) return alts[0];
  let total = 0;
  for (const a of alts) total += Math.exp(-a.gap / MIX_TEMPERATURE);
  let r = rand() * total;
  for (const a of alts) {
    r -= Math.exp(-a.gap / MIX_TEMPERATURE);
    if (r <= 0) return a;
  }
  return alts[alts.length - 1];
}

/** The TOP_K best splits of a solved hand, with EV gaps in points/deal. */
export function altsFromEv(hand: string[], ev: Float64Array, samples: number): AltSplit[] {
  const order = Array.from(ev.keys()).sort((a, b) => ev[b] - ev[a]).slice(0, TOP_K);
  const best = ev[order[0]];
  return order.map((idx) => ({
    idx,
    ...splitCards(SPLITS[idx], hand),
    gap: (best - ev[idx]) / samples,
  }));
}

/** The policy's most-played setting. */
export function policyMode(policy: PolicyAtom[]): PolicyAtom {
  let best = policy[0];
  for (const a of policy) if (a.weight > best.weight) best = a;
  return best;
}

/**
 * Fictitious play: fold round `round`'s best response into the hand's
 * averaged policy with linear round weights (round k enters with mass k on
 * top of the 1 + 2 + ... + (k - 1) already there). Linear weighting fades
 * the early rounds' responses to weak fields without a burn-in rule: the
 * first round is 1/15 of a five-round average. Averaging is what makes the
 * iteration converge; replacing the policy with each round's best response
 * can cycle, and measurably stalled ~0.2 pts/deal short of equilibrium.
 */
export function mergeRound(prev: LibraryEntry | null, solved: LibraryEntry, round: number): LibraryEntry {
  const chosen = solved.alts[0];
  const prevMass = (round * (round - 1)) / 2;
  const total = prevMass + round;
  const policy: PolicyAtom[] = [];
  let merged = false;
  for (const a of prev?.policy ?? []) {
    const weight = (a.weight * prevMass) / total;
    if (a.idx === chosen.idx) {
      policy.push({ ...a, weight: weight + round / total });
      merged = true;
    } else {
      policy.push({ ...a, weight });
    }
  }
  if (!merged) {
    policy.push({ idx: chosen.idx, top: chosen.top, middle: chosen.middle, bottom: chosen.bottom, weight: round / total });
  }
  policy.sort((a, b) => b.weight - a.weight);
  return { cards: solved.cards, alts: solved.alts, policy };
}

/* ---------- the solve core ---------- */

export interface SolveConfig {
  heroCards: string[];
  opponents: number;
  boards: number;
  royalties: boolean;
  samples: number;
  library: LibraryEntry[] | null;
  mixing: Mixing;
  /** Filled with the sum of squared scenario values, for standard errors. */
  sqOut?: Float64Array;
  onScenario?: (done: number) => void;
}

/**
 * EV (total points, not yet divided by samples) of every split of heroCards.
 * One scenario = opponent hands + splits + boards; all 105 hero splits are
 * scored against it via scoreDealAll with reused buffers.
 */
export function solveHand(cfg: SolveConfig): Float64Array {
  const { heroCards, opponents, boards, royalties, samples, library, mixing } = cfg;
  const heroSet = new Set(heroCards);
  const heroCodes = codesOf(heroCards);
  const avail = ALL_CARDS.filter((c) => !heroSet.has(c));

  const ev = new Float64Array(SPLITS.length);

  // Reused per-scenario buffers.
  const nPlayers = opponents + 1;
  const players: RowScores[][] = Array.from({ length: nPlayers }, () =>
    Array.from({ length: boards }, () => ({ top: 0, middle: 0, bottom: 0 }))
  );
  const outBuf: DealBreakdown[] = Array.from({ length: nPlayers }, () => ({
    top: 0, middle: 0, bottom: 0, scoop: 0, total: 0,
  }));
  const tops = Array.from({ length: boards }, () => new Float64Array(7));
  const mids = Array.from({ length: boards }, () => new Float64Array(PAIRS.length));
  const bots = Array.from({ length: boards }, () => new Float64Array(QUADS.length));
  const oppHoleCodes: number[][] = Array.from({ length: opponents }, () => [0, 0, 0, 0]);
  const quadCodes = [0, 0, 0, 0];

  for (let it = 0; it < samples; it++) {
    // 1. Opponent hands and splits.
    const oppParts: { top: string[]; middle: string[]; bottom: string[] }[] = [];
    const used = new Set(heroSet);
    if (library) {
      for (let o = 0; o < opponents; o++) {
        let entry: LibraryEntry | null = null;
        for (let tries = 0; tries < 400; tries++) {
          const cand = library[Math.floor(rand() * library.length)];
          if (cand.cards.every((c) => !used.has(c))) { entry = cand; break; }
        }
        if (entry) {
          for (const c of entry.cards) used.add(c);
          oppParts.push(pickAlt(entry, mixing));
        } else {
          // Practically unreachable; keep the scenario well formed anyway.
          const rest = ALL_CARDS.filter((c) => !used.has(c));
          drawN(rest, 7);
          const hand = rest.slice(0, 7);
          for (const c of hand) used.add(c);
          oppParts.push(splitCards(heuristicSplit(hand), hand));
        }
      }
    } else {
      drawN(avail, opponents * 7);
      for (let o = 0; o < opponents; o++) {
        const hand = avail.slice(o * 7, o * 7 + 7);
        for (const c of hand) used.add(c);
        oppParts.push(splitCards(heuristicSplit(hand), hand));
      }
    }

    // 2. Boards from whatever is left.
    const rest = ALL_CARDS.filter((c) => !used.has(c));
    drawN(rest, boards * 5);
    const boardCodes: number[][] = [];
    for (let b = 0; b < boards; b++) boardCodes.push(codesOf(rest.slice(b * 5, b * 5 + 5)));

    // 3. Opponent rows.
    for (let o = 0; o < opponents; o++) {
      const parts = oppParts[o];
      const topCode = CODE[parts.top[0]];
      const m1 = CODE[parts.middle[0]];
      const m2 = CODE[parts.middle[1]];
      const hc = oppHoleCodes[o];
      for (let i = 0; i < 4; i++) hc[i] = CODE[parts.bottom[i]];
      for (let b = 0; b < boards; b++) {
        const row = players[o + 1][b];
        row.top = evalTop(topCode, boardCodes[b]);
        row.middle = evalMiddle(m1, m2, boardCodes[b]);
        row.bottom = evalBottom(hc, boardCodes[b]);
      }
    }

    // 4. Hero score tables: each split is then 3 lookups per board.
    for (let b = 0; b < boards; b++) {
      const bc = boardCodes[b];
      for (let i = 0; i < 7; i++) tops[b][i] = evalTop(heroCodes[i], bc);
      for (let p = 0; p < PAIRS.length; p++) {
        mids[b][p] = evalMiddle(heroCodes[PAIRS[p][0]], heroCodes[PAIRS[p][1]], bc);
      }
      for (let q = 0; q < QUADS.length; q++) {
        const quad = QUADS[q];
        for (let i = 0; i < 4; i++) quadCodes[i] = heroCodes[quad[i]];
        bots[b][q] = evalBottom(quadCodes, bc);
      }
    }

    // 5. Every hero split against this scenario.
    for (let si = 0; si < SPLITS.length; si++) {
      const sp = SPLITS[si];
      for (let b = 0; b < boards; b++) {
        const row = players[0][b];
        row.top = tops[b][sp.top];
        row.middle = mids[b][sp.middleIdx];
        row.bottom = bots[b][sp.bottomIdx];
      }
      const v = scoreDealAll(players, royalties, outBuf)[0].total;
      ev[si] += v;
      if (cfg.sqOut) cfg.sqOut[si] += v * v;
    }

    cfg.onScenario?.(it + 1);
  }
  return ev;
}

/* ---------- one slice of a policy-iteration round ---------- */

export function splitIndexOf(sp: Split): number {
  for (let i = 0; i < SPLITS.length; i++) {
    const s = SPLITS[i];
    if (s.top === sp.top && s.middleIdx === sp.middleIdx && s.bottomIdx === sp.bottomIdx) return i;
  }
  return 0;
}

export interface BatchConfig {
  hands: string[][];
  opponents: number;
  boards: number;
  royalties: boolean;
  samples: number;
  library: LibraryEntry[] | null;
  /** Each hand's current averaged policy; absent = the heuristic. */
  prevPolicy: PolicyAtom[][] | null;
  /** Opponents' play style during the round. */
  mixing: Mixing;
  onHand?: (done: number) => void;
}

/**
 * Best-respond every hand to the field, and price each hand's current
 * policy on the same scenarios. Used both to build a round (the entries are
 * folded in with mergeRound) and to measure a finished policy (the entries
 * are discarded and only the stats matter).
 */
export function runBatch(cfg: BatchConfig): { entries: LibraryEntry[]; stats: BatchHandStat[] } {
  const entries: LibraryEntry[] = [];
  const stats: BatchHandStat[] = [];
  for (let e = 0; e < cfg.hands.length; e++) {
    const hand = cfg.hands[e];
    const ev = solveHand({
      heroCards: hand,
      opponents: cfg.opponents,
      boards: cfg.boards,
      royalties: cfg.royalties,
      samples: cfg.samples,
      library: cfg.library,
      mixing: cfg.mixing,
    });
    const alts = altsFromEv(hand, ev, cfg.samples);
    entries.push({ cards: hand, alts, policy: [] });

    let prevEv: number;
    let prevIdx: number;
    const policy = cfg.prevPolicy?.[e];
    if (policy && policy.length > 0) {
      prevEv = 0;
      for (const a of policy) prevEv += (a.weight * ev[a.idx]) / cfg.samples;
      prevIdx = policyMode(policy).idx;
    } else {
      prevIdx = splitIndexOf(heuristicSplit(hand));
      prevEv = ev[prevIdx] / cfg.samples;
    }
    stats.push({
      bestIdx: alts[0].idx,
      bestEv: ev[alts[0].idx] / cfg.samples,
      prevEv,
      prevIdx,
    });
    cfg.onHand?.(e + 1);
  }
  return { entries, stats };
}

/* ---------- compact library files (precompute output) ---------- */

/** cards joined ("AhKd..."), alts as [splitIdx, gap in centipoints], policy
 *  as [splitIdx, play probability in permille]. */
export function encodeLibrary(lib: OpponentLibrary): LibraryFile {
  return {
    v: 2,
    opponents: lib.opponents,
    boards: lib.boards,
    royalties: lib.royalties,
    stats: lib.stats,
    entries: lib.entries.map((e) => ({
      c: e.cards.join(""),
      a: e.alts.map((a) => [a.idx, Math.round(a.gap * 100)]),
      p: e.policy.map((a) => [a.idx, Math.round(a.weight * 1000)]),
    })),
  };
}

const cardsOf = (joined: string): string[] => {
  const cards: string[] = [];
  for (let i = 0; i < joined.length; i += 2) cards.push(joined.slice(i, i + 2));
  return cards;
};

export function decodeLibrary(file: LibraryFile | LibraryFileV1): OpponentLibrary {
  const entries: LibraryEntry[] = file.entries.map((e) => {
    const cards = cardsOf(e.c);
    const alts = e.a.map(([idx, centiGap]) => ({
      idx,
      ...splitCards(SPLITS[idx], cards),
      gap: centiGap / 100,
    }));
    let policy: PolicyAtom[];
    if ("p" in e) {
      const total = e.p.reduce((sum, [, w]) => sum + w, 0) || 1;
      policy = e.p.map(([idx, permille]) => ({ idx, ...splitCards(SPLITS[idx], cards), weight: permille / total }));
    } else {
      // v1 stored only the final best response; play it as a pure policy.
      policy = [{ idx: alts[0].idx, top: alts[0].top, middle: alts[0].middle, bottom: alts[0].bottom, weight: 1 }];
    }
    return { cards, alts, policy };
  });
  // A v1 row k measured the round k-1 argmax policy (its prevPolicyEvLoss is
  // the same paired best-response gain), under mixed play; the final policy
  // was never measured, so no row claims to describe it.
  const stats: LibraryLevelStats[] =
    file.v === 2
      ? file.stats
      : file.stats.map((s) => ({
          level: s.level - 1,
          exploitability: s.prevPolicyEvLoss,
          agreePrevPct: s.agreePrevPct,
        }));
  return {
    entries,
    stats,
    opponents: file.opponents,
    boards: file.boards,
    royalties: file.royalties,
  };
}

/** Aggregate one best-response pass into the stats row of the policy it
 *  faced: `level` is how many rounds that policy had absorbed. */
export function summarizeRound(level: number, stats: BatchHandStat[]): LibraryLevelStats {
  let agree = 0;
  let gain = 0;
  let selfSum = 0;
  let selfPos = 0;
  let bestPos = 0;
  for (const s of stats) {
    if (s.prevIdx === s.bestIdx) agree++;
    gain += s.bestEv - s.prevEv;
    selfSum += s.prevEv;
    if (s.prevEv > 0) selfPos++;
    if (s.bestEv > 0) bestPos++;
  }
  const n = stats.length;
  return {
    level,
    exploitability: gain / n,
    selfMeanEv: selfSum / n,
    selfPositivePct: (selfPos / n) * 100,
    bestPositivePct: (bestPos / n) * 100,
    agreePrevPct: (agree / n) * 100,
  };
}
