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
  /** Monte Carlo scenarios; each scenario scores every legal split. */
  samples: number;
  seed: number;
  reportEvery: number;
}

export type TaiwaneseIn = { type: "start"; payload: TaiwaneseParams } | { type: "cancel" };

export interface TaiwaneseSplitResult {
  top: string[];
  middle: string[];
  bottom: string[];
  /** Mean net points per deal, summed over all opponents. */
  evPoints: number;
}

export interface TaiwaneseResult {
  samples: number;
  opponents: number;
  boards: 1 | 2;
  royalties: boolean;
  /** Every legal split, sorted by evPoints descending. */
  splits: TaiwaneseSplitResult[];
}

export type TaiwaneseOut =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; result: TaiwaneseResult }
  | { type: "error"; message: string };
