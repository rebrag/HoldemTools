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
  /** Opponent play style: "pure" = each hand's averaged self-play policy
   *  (the equilibrium approximation, which mixes where settings tie),
   *  "mixed" = human-like sampling over the latest best response's
   *  near-best splits, weighted by EV gap. */
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

/** One setting of a hand's averaged self-play policy, with the probability
 *  it is played. A library's policy is fictitious play over the build rounds:
 *  the linearly weighted average of each round's best response. */
export interface PolicyAtom {
  idx: number;
  top: string[];
  middle: string[];
  bottom: string[];
  /** Play probability; a hand's atoms sum to 1. */
  weight: number;
}

/** One self-play opponent: a sampled hand, its averaged policy, and the
 *  best splits of its latest best response. "pure" play samples `policy`
 *  (the equilibrium approximation); "mixed" (human-like) play samples over
 *  `alts` by gap. */
export interface LibraryEntry {
  cards: string[];
  alts: AltSplit[];
  policy: PolicyAtom[];
}

/** Compact on-disk form of a precomputed library (see taiwaneseSolver.ts
 *  encodeLibrary/decodeLibrary): cards joined, alts as [idx, centiGap],
 *  policy as [idx, permille]. */
export interface LibraryFile {
  v: 2;
  opponents: number;
  boards: 1 | 2;
  royalties: boolean;
  stats: LibraryLevelStats[];
  entries: { c: string; a: [number, number][]; p: [number, number][] }[];
}

/** The pre-fictitious-play file layout (libraries built before 2026-09-15):
 *  no policy, and its stats row k measured the round k-1 argmax policy under
 *  "mixed" play. Still decodable so an old file on disk keeps working. */
export interface LibraryFileV1 {
  v: 1;
  opponents: number;
  boards: 1 | 2;
  royalties: boolean;
  stats: { level: number; agreePrevPct: number; prevPolicyEvLoss: number }[];
  entries: { c: string; a: [number, number][] }[];
}

/**
 * What one best-response pass measured about the opponent policy it faced.
 * `level` is how many build rounds that policy had absorbed: 0 is the fixed
 * heuristic the first round responds to, and the last row (level = rounds)
 * is the shipped policy, measured by a final pass that changes nothing.
 * Every number is a mean over the pass's hands, each solved under common
 * random numbers, so the paired `exploitability` is precise even where the
 * per-hand EVs are noisy.
 */
export interface LibraryLevelStats {
  level: number;
  /** Mean points/deal a fresh best response gains over the policy's own
   *  setting of the same hand. The policy played against itself averages
   *  exactly zero, so this is its exploitability: 0 is an equilibrium, and
   *  any positive amount is how hot the advisor's EVs run on average
   *  against it. Undefined only for the unmeasured final policy of an old
   *  v1 file. */
  exploitability?: number;
  /** Mean points/deal of the hands' own policy settings against the
   *  policy. Zero in expectation (the policy against itself), so this is a
   *  sanity check on the measurement, not a property of the policy. */
  selfMeanEv?: number;
  /** % of hands whose own policy setting is +EV against the policy: the
   *  symmetric baseline share, which is below 50% because strong material
   *  is rare and wins big. */
  selfPositivePct?: number;
  /** % of hands whose fresh best split is +EV against the policy: what the
   *  advisor's #1 split shows for random hands. */
  bestPositivePct?: number;
  /** % of hands whose best response is the policy's most-played setting.
   *  Noisy: near-tied splits flip freely, so read exploitability instead. */
  agreePrevPct: number;
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
  /** Each hand's current averaged policy, to price against the same
   *  scenarios as its best response; absent = the heuristic. */
  prevPolicy?: PolicyAtom[][];
  /** Opponent play style during the round: "pure" plays the averaged
   *  policy (fictitious play), "mixed" the softened latest best response. */
  mixing?: "pure" | "mixed";
  /** Progress cadence, in hands. */
  reportEvery: number;
}

export interface BatchHandStat {
  /** Index into the canonical split enumeration. */
  bestIdx: number;
  /** Points per deal, both under the same scenarios (common random numbers). */
  bestEv: number;
  /** EV of the hand's current policy (its atoms' EVs weighted by play
   *  probability), or of the heuristic split when there is no policy yet. */
  prevEv: number;
  /** The policy's most-played setting (the heuristic split without one). */
  prevIdx: number;
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
