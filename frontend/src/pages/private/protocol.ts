// src/pages/private/protocol.ts
// Message types shared by the /private page's workers, hooks, and UI.
// Type-only module: importing it never pulls code into a bundle.

// ---------- Top X% hand rankings ----------

export type RankingsMode = "holdem5" | "badugi4" | "badugi5";

export interface RankingsParams {
  mode: RankingsMode;
  numHands: number;
  /** Percent cutoffs to report, e.g. [50, 35, 20, 10, 5, 2, 1]. */
  percents: number[];
  seed: number;
  reportEvery: number;
  /** Badugi modes only: draw rounds to play (0 = rank hands as dealt). */
  draws?: number;
  /** Draw play only: opponents to beat, which sets how much a hand's
   *  showdown value rewards drawing at made-but-weak hands. */
  opponents?: number;
}

export type RankingsIn = { type: "start"; payload: RankingsParams } | { type: "cancel" };

export interface RankingsCutoff {
  percent: number;
  /** The dealt cards of the hand sitting exactly at this cutoff. */
  cards: string[];
  score: number;
  /** Draw play only: the cards this hand keeps on its first draw. */
  keep?: string[];
  /** Draw play only: showdown win probability playing the draws out, 0..100. */
  winPct?: number;
}

export interface RankingsResult {
  mode: RankingsMode;
  handsDealt: number;
  /** Pair-or-better (holdem5), 4-card-badugi as dealt (badugi, draws = 0),
   *  or 4-card-badugi after the draws (draw play). Percent, 0..100. */
  frequency: number;
  cutoffs: RankingsCutoff[];
  /** Draw play only: the settings the ranking was computed against. */
  opponents?: number;
  draws?: number;
}

export type RankingsOut =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; result: RankingsResult }
  | { type: "error"; message: string };

// ---------- Taiwanese hand-setting advisor ----------

export interface TaiwaneseParams {
  /** Exactly 7 cards. */
  heroCards: string[];
  opponents: number; // 1..5
  boards: 1 | 2;
  /** true = PokerNews rules (royalty chart, scoop 3); false = the client's
   *  house rules (no royalties, scoop 8). */
  royalties: boolean;
  /** Monte Carlo scenarios; each scenario scores every split. */
  samples: number;
  seed: number;
  reportEvery: number;
  /** When present, simulated opponents draw their hand AND split from this
   *  self-play library instead of playing the heuristic. */
  library?: LibraryEntry[];
  /** Opponent play style over library alternatives: "pure" = always the best
   *  split, "mixed" = human-like sampling weighted by EV gap. */
  mixing?: "pure" | "mixed";
}

/** One split alternative of a solved hand. `idx` is its index in the
 *  canonical split enumeration; `gap` is its EV shortfall vs the best split
 *  in points/deal (0 for the best). */
export interface AltSplit {
  idx: number;
  top: string[];
  middle: string[];
  bottom: string[];
  gap: number;
}

/** One self-play opponent: a sampled hand with its best splits. Pure play
 *  uses alts[0]; mixed (human-like) play samples over alts by gap. */
export interface LibraryEntry {
  cards: string[];
  alts: AltSplit[];
}

/** Compact on-disk form of a precomputed library (see taiwaneseSolver.ts
 *  encodeLibrary/decodeLibrary): cards joined, alts as [idx, centiGap]. */
export interface LibraryFile {
  v: 1;
  opponents: number;
  boards: 1 | 2;
  royalties: boolean;
  stats: LibraryLevelStats[];
  entries: { c: string; a: [number, number][] }[];
}

export interface LibraryLevelStats {
  level: number;
  /** % of library hands whose best split matched the previous round's policy
   *  (round 1 compares against the heuristic). Noisy: near-tied splits flip
   *  freely, so read prevPolicyEvLoss for convergence instead. */
  agreePrevPct: number;
  /** Mean EV gain (points/deal) of the best-response split over the
   *  heuristic split, under that round's opponents. */
  evGainVsHeuristic: number;
  /** Mean points/deal that re-optimizing gains over the PREVIOUS round's
   *  choice, under this round's opponents (round 1: over the heuristic).
   *  This is the convergence metric: near zero = the previous policy is
   *  already a best response to itself. Upper bound - argmax noise inflates
   *  it. */
  prevPolicyEvLoss: number;
}

export interface OpponentLibrary {
  entries: LibraryEntry[];
  stats: LibraryLevelStats[];
  opponents: number;
  boards: 1 | 2;
  royalties: boolean;
}

/**
 * One slice of a policy-iteration round: solve each hand's best response
 * against `library` (the previous round's policy; absent = the heuristic).
 * The host splits a round's hands across workers and runs the rounds in
 * sequence, since round N needs round N-1's policy.
 */
export interface SolveBatchParams {
  hands: string[][];
  opponents: number;
  boards: 1 | 2;
  royalties: boolean;
  /** Scenarios per hand. */
  samples: number;
  seed: number;
  library?: LibraryEntry[];
  /** Previous round's chosen split index per hand; absent = the heuristic. */
  prevIdx?: number[];
  /** Opponent play style during the round (mixed = smoothed iteration). */
  mixing?: "pure" | "mixed";
  /** Progress cadence, in hands. */
  reportEvery: number;
}

export interface BatchHandStat {
  /** Index into the canonical split enumeration. */
  bestIdx: number;
  /** Points per deal, all under the same scenarios (common random numbers). */
  bestEv: number;
  prevEv: number;
  heuristicEv: number;
}

export type TaiwaneseIn =
  | { type: "start"; payload: TaiwaneseParams }
  | { type: "solve-batch"; payload: SolveBatchParams }
  | { type: "cancel" };

export interface TaiwaneseSplitResult {
  top: string[];
  middle: string[];
  bottom: string[];
  /** Mean net points per deal, summed over all opponents. */
  evPoints: number;
  /** Standard error of evPoints, when the host pooled sums of squares. */
  evStdErr?: number;
}

export interface TaiwaneseResult {
  samples: number;
  opponents: number;
  boards: 1 | 2;
  royalties: boolean;
  /** Every split, sorted by evPoints descending. */
  splits: TaiwaneseSplitResult[];
  /** Per-split running totals in canonical split order, so several workers'
   *  partial runs can be pooled before ranking. Sum of scenario values and of
   *  their squares (the latter gives each EV a standard error). */
  evSum?: number[];
  evSqSum?: number[];
}

export type TaiwaneseOut =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; result: TaiwaneseResult }
  | { type: "batch-done"; entries: LibraryEntry[]; stats: BatchHandStat[] }
  | { type: "error"; message: string };
