// src/lib/solver/treeConfig.ts
//
// Structured representation of a PioSOLVER tree-building config and the single
// serializer that turns it into the text uploaded via POST /api/gametrees.
//
// The watcher pastes the resulting `Text` VERBATIM into PioViewer's tree
// builder (see watcher/README.md), so the emitted line order and formatting
// are load-bearing: for identical inputs, buildTreeConfigText must keep
// emitting the same line order and formatting as the pre-refactor
// handleActionClick.ts + Solver.tsx (default sizes have since been
// deliberately changed to a 33% flop bet for both seats).
// Golden example (solver page, non-ICM, default sizes):
//
//   #Type#NoLimit
//   #Range0#22:1,AA:0.5
//   #Range1#33:0.169,KK:1
//   #ICM.ICMFormat#Pio ICM structure
//   #ICM.Payouts#0\n0\n0
//   #ICM.Stacks#2100\n2100\n2250
//   #Board#Ah Kd 9c
//   #Pot#550
//   #EffectiveStacks#2100
//   #AllinThreshold#60
//   #AddAllinOnlyIfLessThanThisTimesThePot#250
//   #MergeSimilarBets#True
//   #MergeSimilarBetsThreshold#12
//   #CapEnabled#True
//   #CapMode#NoLimit
//   #FlopConfig.BetSize#33
//   #FlopConfig.RaiseSize#33
//   #FlopConfig.AddAllin#True
//   #TurnConfig.BetSize#50
//   #TurnConfig.RaiseSize#a
//   #TurnConfig.AddAllin#True
//   #RiverConfig.BetSize#30 66
//   #RiverConfig.RaiseSize#a
//   #RiverConfig.AddAllin#True
//   #RiverConfig.DonkBetSize#30
//   #FlopConfigIP.BetSize#33
//   #FlopConfigIP.RaiseSize#a
//   #FlopConfigIP.AddAllin#True
//   #TurnConfigIP.BetSize#50
//   #TurnConfigIP.RaiseSize#a
//   #TurnConfigIP.AddAllin#True
//   #RiverConfigIP.BetSize#30 66
//   #RiverConfigIP.RaiseSize#a
//   #RiverConfigIP.AddAllin#True
//
// (#ICM.Enabled#True is inserted after #ICM.ICMFormat# for ICM sims;
// a #...BetSize# line is omitted when the corresponding size is unset,
// though the defaults now set one on every street.)

/** Postflop acting order, worst position first. Mirrors POSTFLOP_ORDER in
 *  watcher/extraction.py — the watcher re-derives OOP/IP from this ordering,
 *  so every uploaded position label must come from this list. */
export const POSTFLOP_ORDER = [
  "SB",
  "BB",
  "UTG",
  "UTG1",
  "LJ",
  "HJ",
  "CO",
  "BTN",
] as const;

/** Sizes for one street/seat. Values are Pio size strings: percent-of-pot
 *  numbers, space-separated lists ("30 66"), or "a" (all-in). An undefined
 *  field means the corresponding #...# line is omitted entirely. */
export interface StreetSizes {
  betSize?: string;
  raiseSize?: string;
  /** OOP only; lead into the prior street's aggressor. */
  donkBetSize?: string;
  addAllin: boolean;
}

export interface TreeSizes {
  flop: StreetSizes;
  turn: StreetSizes;
  river: StreetSizes;
}

/** Pio rounds every bet to a whole chip, so the config has to express money as
 *  integers. Scale by the smallest power of ten that both keeps every amount
 *  whole and leaves the pot enough chips for percentage sizes to resolve: at a
 *  pot of 11 chips a 33% bet rounds to 4, which is really 36%. */
const CHIP_SCALES = [0.01, 0.1, 1, 10, 100, 1000, 10000] as const;
/**
 * PioSOLVER keeps the pot and both stack sizes in 16 bits and rejects the tree
 * outright above 65535 ("consider dividing stacks/pot by 10 or 100"), so this
 * is a hard ceiling and not a preference - a $738 stack at 100 chips per dollar
 * is 73800 and never builds.
 *
 * The bound is applied to the largest pot the tree can ever reach, not just to
 * the numbers in the config: the pot grows as bets go in, and if Pio holds node
 * pots in the same 16 bits then maxing out the stack would fail later instead
 * of at set_eff_stack. Only the setup limit is documented, so this is
 * deliberately the cautious reading - it costs at most one rung of the ladder,
 * and every hand still lands well inside 1% bet-size error.
 */
const PIO_MAX_CHIPS = 60000;

const isIntegral = (value: number, scale: number): boolean => {
  const scaled = value * scale;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6 * Math.max(1, Math.abs(scaled));
};

/**
 * Pio chips per one unit of the hand's money: the biggest power of ten that
 * still fits under Pio's limit.
 *
 * Bigger is strictly better here. Pio rounds every bet to a whole chip, so the
 * more chips the pot is worth the closer a percentage size lands to what was
 * asked for, and there is no cost to spending the headroom. Wanting the amounts
 * to stay whole also pushes the same way, and both are monotonic in the scale,
 * so the largest scale that fits is simultaneously the most precise and the
 * most likely to be exact - one comparison decides it.
 */
export const pickChipScale = (moneyValues: number[], potMoney: number): number => {
  const values = [...moneyValues, potMoney].filter((v) => Number.isFinite(v) && v > 0);
  const largest = values.length ? Math.max(...values) : potMoney;
  /* Both players can end up all-in, so this is the most the pot can grow to. */
  const worstCasePot = potMoney + 2 * largest;

  const allowed = CHIP_SCALES.filter((s) => worstCasePot * s <= PIO_MAX_CHIPS);
  if (allowed.length === 0) {
    // Playing for more chips than Pio can represent even at a hundredth of a
    // chip per unit. Take the coarsest scale and let the ceiling warning speak.
    console.warn(
      "pickChipScale:", worstCasePot, "exceeds Pio's 16-bit limit at every scale"
    );
    return CHIP_SCALES[0];
  }

  const scale = allowed[allowed.length - 1];
  if (!values.every((v) => isIntegral(v, scale))) {
    // Finer than this scale can express, and a larger one would not fit. Pio
    // only takes integers, so the amounts round; the config stays consistent.
    console.warn("pickChipScale: no exact scale for", moneyValues, "- rounding at", scale);
  }
  return scale;
};

/** Everything that goes into the tree text except the board. Weights are
 *  0..1 per 169 hand class; chip fields are Pio chips, `chipScale` of them
 *  per unit of the solve's display money. */
export interface TreeParams {
  rangeOOP: Record<string, number>; // -> #Range0#
  rangeIP: Record<string, number>; // -> #Range1#
  potChips: number;
  effectiveStackChips: number;
  /** Pio chips per unit of display money. 100 for a preflop sim, where the
   *  display money is big blinds; chosen by pickChipScale for a recorded hand. */
  chipScale: number;
  allinThreshold: number;
  addAllinOnlyIfLessThanThisTimesThePot: number;
  mergeSimilarBets: boolean;
  mergeSimilarBetsThreshold: number;
  oop: TreeSizes;
  ip: TreeSizes;
  /** Payouts/stacks literals use literal "\n" (backslash-n) separators and
   *  stacks are ordered OOP first, IP second, then the remaining seats —
   *  Pio matches them positionally against Range0/Range1. */
  icm: { enabled: boolean; payoutsLiteral: string; stacksLiteral: string };
}

/** The bet-size defaults uploaded when nothing overrides them (formerly
 *  hardcoded in handleActionClick.ts). Every street carries a bet size so no
 *  seat is ever left without a lead option; the flop default is 33% pot for
 *  both seats. */
export const DEFAULT_TREE_SIZES: { oop: TreeSizes; ip: TreeSizes } = {
  oop: {
    flop: { betSize: "33", raiseSize: "33", addAllin: true },
    turn: { betSize: "50", raiseSize: "a", addAllin: true },
    river: { betSize: "30 66", raiseSize: "a", donkBetSize: "30", addAllin: true },
  },
  ip: {
    flop: { betSize: "33", raiseSize: "a", addAllin: true },
    turn: { betSize: "50", raiseSize: "a", addAllin: true },
    river: { betSize: "30 66", raiseSize: "a", addAllin: true },
  },
};

export const cloneTreeSizes = (s: TreeSizes): TreeSizes => ({
  flop: { ...s.flop },
  turn: { ...s.turn },
  river: { ...s.river },
});

/** {"AA":1,"AKs":0.5} -> "AA:1,AKs:0.5" (zero-weight classes are skipped). */
export const serializeRange = (weights: Record<string, number>): string =>
  Object.entries(weights)
    .filter(([, w]) => w > 0)
    .map(([hand, w]) => `${hand}:${w}`)
    .join(",");

/** Inverse of serializeRange; tolerant of whitespace and bare "AA" (weight 1). */
export const parseRangeText = (text: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const part of text.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const [hand, weight] = token.split(":");
    if (!hand) continue;
    const w = weight === undefined ? 1 : Number(weight);
    if (Number.isFinite(w) && w > 0) out[hand.trim()] = w;
  }
  return out;
};

const streetLines = (
  street: "Flop" | "Turn" | "River",
  seatSuffix: "" | "IP",
  sizes: StreetSizes
): string[] => {
  const key = `#${street}Config${seatSuffix}`;
  const lines: string[] = [];
  if (sizes.betSize) lines.push(`${key}.BetSize#${sizes.betSize}`);
  if (sizes.raiseSize) lines.push(`${key}.RaiseSize#${sizes.raiseSize}`);
  if (sizes.addAllin) lines.push(`${key}.AddAllin#True`);
  // Matches the historical ordering: river donk size comes after AddAllin.
  if (sizes.donkBetSize) lines.push(`${key}.DonkBetSize#${sizes.donkBetSize}`);
  return lines;
};

/** Serialize params + flop into the full tree-config text (no trailing \n). */
export const buildTreeConfigText = (
  params: TreeParams,
  flopCards: string[]
): string => {
  const lines: string[] = [
    "#Type#NoLimit",
    `#Range0#${serializeRange(params.rangeOOP)}`,
    `#Range1#${serializeRange(params.rangeIP)}`,
    "#ICM.ICMFormat#Pio ICM structure",
    ...(params.icm.enabled ? ["#ICM.Enabled#True"] : []),
    `#ICM.Payouts#${params.icm.payoutsLiteral}`,
    `#ICM.Stacks#${params.icm.stacksLiteral}`,
    `#Board#${flopCards.join(" ")}`,
    `#Pot#${params.potChips}`,
    `#EffectiveStacks#${params.effectiveStackChips}`,
    `#AllinThreshold#${params.allinThreshold}`,
    `#AddAllinOnlyIfLessThanThisTimesThePot#${params.addAllinOnlyIfLessThanThisTimesThePot}`,
    ...(params.mergeSimilarBets
      ? ["#MergeSimilarBets#True", `#MergeSimilarBetsThreshold#${params.mergeSimilarBetsThreshold}`]
      : []),
    "#CapEnabled#True",
    "#CapMode#NoLimit",
    ...streetLines("Flop", "", params.oop.flop),
    ...streetLines("Turn", "", params.oop.turn),
    ...streetLines("River", "", params.oop.river),
    ...streetLines("Flop", "IP", params.ip.flop),
    ...streetLines("Turn", "IP", params.ip.turn),
    ...streetLines("River", "IP", params.ip.river),
  ];
  return lines.join("\n");
};
