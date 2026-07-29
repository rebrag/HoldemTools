// src/lib/solver/treeConfig.ts
//
// Structured representation of a PioSOLVER tree-building config and the single
// serializer that turns it into the text uploaded via POST /api/gametrees.
//
// The watcher pastes the resulting `Text` VERBATIM into PioViewer's tree
// builder (see watcher/README.md), so the emitted line order and formatting
// are load-bearing: for identical inputs, buildTreeConfigText must reproduce
// the exact string the pre-refactor handleActionClick.ts + Solver.tsx
// produced. Golden example (solver page, non-ICM, caller later than raiser):
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
//   #FlopConfig.BetSize#25
//   #FlopConfig.RaiseSize#33
//   #FlopConfig.AddAllin#True
//   #TurnConfig.BetSize#50
//   #TurnConfig.RaiseSize#a
//   #TurnConfig.AddAllin#True
//   #RiverConfig.BetSize#30 66
//   #RiverConfig.RaiseSize#a
//   #RiverConfig.AddAllin#True
//   #RiverConfig.DonkBetSize#30
//   #FlopConfigIP.BetSize#25
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
// #FlopConfig.BetSize# appears only when oop.flop.betSize is set.)

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
const POT_CHIP_FLOOR = 500;
/**
 * PioSOLVER keeps the pot and both stack sizes in 16 bits and rejects the tree
 * outright above 65535 ("consider dividing stacks/pot by 10 or 100"), so this
 * is a hard ceiling, not a preference - a \$735 stack at 100 chips per dollar
 * is 73500 and never builds. Leave a little headroom under the limit.
 */
const PIO_MAX_CHIPS = 60000;

const isIntegral = (value: number, scale: number): boolean => {
  const scaled = value * scale;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6 * Math.max(1, Math.abs(scaled));
};

/**
 * Pio chips per one unit of the hand's money.
 *
 * Three things pull on the scale, and they do NOT all point the same way:
 *   - Pio's 16-bit ceiling caps it (hard - the tree is refused above 65535).
 *   - Keeping amounts whole pushes it up (Pio only takes integers).
 *   - Giving the pot enough chips to resolve percentage bets pushes it up too.
 *
 * So the ceiling is applied first and wins; the other two are preferences
 * satisfied within whatever room it leaves. A deep hand can exhaust that room -
 * \$735 effective into a \$31 pot cannot have both a 500-chip pot and a stack
 * under 65535 - and then the best available resolution is the answer.
 */
export const pickChipScale = (moneyValues: number[], potMoney: number): number => {
  const values = [...moneyValues, potMoney].filter((v) => Number.isFinite(v) && v > 0);
  const largest = values.length ? Math.max(...values) : potMoney;

  const allowed = CHIP_SCALES.filter((s) => largest * s <= PIO_MAX_CHIPS);
  if (allowed.length === 0) {
    // Even a hundredth of a chip per unit overflows, so the hand is playing for
    // more than ~6.5m chips. Nothing legal is left; take the smallest scale.
    console.warn(
      "pickChipScale: largest amount", largest, "exceeds Pio's 16-bit limit at every scale"
    );
    return CHIP_SCALES[0];
  }

  // Smallest scale that is exact and leaves the pot workable.
  for (const scale of allowed) {
    if (values.every((v) => isIntegral(v, scale)) && Math.round(potMoney * scale) >= POT_CHIP_FLOOR) {
      return scale;
    }
  }
  // Nothing clears the pot floor within the ceiling: take the most resolution
  // the ceiling allows, preferring one that is still exact.
  const bestFirst = [...allowed].reverse();
  const exact = bestFirst.find((scale) => values.every((v) => isIntegral(v, scale)));
  if (exact) return exact;

  const fallback = bestFirst[0];
  console.warn(
    "pickChipScale: no exact scale for", moneyValues, "- rounding at", fallback
  );
  return fallback;
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

/** The bet-size defaults the solver page has always uploaded
 *  (formerly hardcoded in handleActionClick.ts). */
export const DEFAULT_TREE_SIZES: { oop: TreeSizes; ip: TreeSizes } = {
  oop: {
    flop: { raiseSize: "33", addAllin: true },
    turn: { betSize: "50", raiseSize: "a", addAllin: true },
    river: { betSize: "30 66", raiseSize: "a", donkBetSize: "30", addAllin: true },
  },
  ip: {
    flop: { betSize: "25", raiseSize: "a", addAllin: true },
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
