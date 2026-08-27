// src/pages/compare/enginePresets.ts
//
// The spots the engine is benchmarked on, as one-click presets.
//
// These are not "nice example hands". They are the exact trees behind the
// numbers in engine/docs/roadmap.md and engine/configs/_bench/, so a run
// started from one of them is directly comparable to a recorded result - and
// to the same spot solved by a different build of the engine. Changing the
// sizings or ranges here silently invalidates that comparison, so treat them
// as fixtures rather than defaults to taste.
//
// Keep them in step with engine/configs/_bench/{p_flop,d_dcfr}.json.
import type { BuilderState } from "./builderState";
import { fullRangeWeights, type StreetBoxes } from "./treeConfigText";

/** The ~15% opening range both seats use in the "tight" benchmark family.
 *  Mirrors engine/configs/ranges/tight15.txt exactly. */
const TIGHT15 = [
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55",
  "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs",
  "KQs", "KQo", "KJs", "KTs", "QJs", "QTs", "JTs",
  "T9s", "98s", "87s", "76s", "65s", "A5s", "A4s",
];

const tight15Weights = (): Record<string, number> =>
  Object.fromEntries(TIGHT15.map((h) => [h, 1]));

const box = (bet: string, raise: string, donk = ""): StreetBoxes => ({
  bet,
  raise,
  donk,
  // The benchmark configs list their sizes explicitly and add no implicit
  // all-in, so this must stay false or the tree gains an extra action and
  // stops matching.
  addAllin: false,
  noThreeBet: false,
});

export interface EnginePreset {
  id: string;
  label: string;
  /** One line for the dropdown's help text. */
  note: string;
  /** Everything the preset pins. Merged over the current builder state, so
   *  anything not named here (accuracy, Pio toggles) is left alone. */
  patch: Partial<BuilderState>;
}

/** Shared by both benchmark families: one seat's boxes are the other's. */
const sameBoth = (streets: Record<"flop" | "turn" | "river", StreetBoxes>) => ({
  oop: streets,
  ip: { flop: { ...streets.flop }, turn: { ...streets.turn }, river: { ...streets.river } },
});

// The flop family: a single 50%-pot bet per street and no raises. Small
// enough to solve in minutes while still containing two chance levels, which
// is what makes it the flop-shaped benchmark rather than a toy.
const flopStreets = {
  flop: box("50", ""),
  turn: box("50", ""),
  river: box("50", ""),
};

// The turn family: real sizings, so nodes have four actions rather than two.
// This is the tree that exposes action-count-dependent behaviour - it is
// where the zero-reach prune rate was 1.36% against the flop tree's 0.003%.
const turnStreets = {
  flop: box("50 400", "1000"),
  turn: box("50 400", "1000"),
  river: box("50 400", "1000"),
};

const common: Partial<BuilderState> = {
  pot: "100",
  effectiveStacks: "400",
  allinThresholdPct: "90",
  preflopAggressor: "none",
};

export const ENGINE_PRESETS: EnginePreset[] = [
  {
    id: "flop-tight",
    label: "Flop 9c 5d Jc - ~15% ranges",
    note: "configs/_bench/p_flop.json. One 50% bet per street, no raises, two chance levels. The flop-shaped benchmark.",
    patch: {
      ...common,
      board: "9c 5d Jc",
      maxRaises: "0",
      oopRange: tight15Weights(),
      ipRange: tight15Weights(),
      ...sameBoth(flopStreets),
    },
  },
  {
    id: "flop-full",
    label: "Flop 9c 5d Jc - 100% ranges",
    note: "configs/validate_flop_small.json. Same tree, full ranges - the case where the compact hand universe has nothing to remove.",
    patch: {
      ...common,
      board: "9c 5d Jc",
      maxRaises: "0",
      oopRange: fullRangeWeights(),
      ipRange: fullRangeWeights(),
      ...sameBoth(flopStreets),
    },
  },
  {
    id: "turn-tight",
    label: "Turn 9c 5d Jc 7s - ~15% ranges",
    note: "configs/_bench/d_dcfr.json. Bets 50/400, raise 1000, max 2 raises - four actions per node.",
    patch: {
      ...common,
      board: "9c 5d Jc 7s",
      maxRaises: "2",
      oopRange: tight15Weights(),
      ipRange: tight15Weights(),
      ...sameBoth(turnStreets),
    },
  },
  {
    id: "turn-full",
    label: "Turn 9c 5d Jc 7s - 100% ranges",
    note: "configs/validate_turn_fullrange.json. The Pio validation reference: 300 iterations gives nashconv 0.232074, ev 45.9951 / 54.0049.",
    patch: {
      ...common,
      board: "9c 5d Jc 7s",
      maxRaises: "2",
      oopRange: fullRangeWeights(),
      ipRange: fullRangeWeights(),
      ...sameBoth(turnStreets),
    },
  },
];
