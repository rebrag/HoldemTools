// src/pages/compare/treeConfigText.ts
//
// The PioViewer "Tree building parameters" clipboard format, both directions.
// Copy to clipboard here produces text PioViewer's Paste accepts, and Paste
// here accepts text PioViewer's Copy to clipboard produced, so a spot can be
// moved between the two without retyping it.
//
// Reference capture (a turn board, 50%/100% turn sizes both seats, river OOP
// 100%, river IP 25%/100% + all-in):
//
//   #Type#NoLimit
//   #Range0#AA,KK,...,T3s,T3o:0.5,...,52s,43,42,32
//   #Range1#TT,99,...
//   #Board#2s 2h 2d 3c
//   #Pot#100
//   #EffectiveStacks#400
//   #AllinThreshold#90
//   #AddAllinOnlyIfLessThanThisTimesThePot#300
//   #TurnConfig.BetSize#50
//   #TurnConfig.RaiseSize#100
//   #RiverConfig.BetSize#100
//   #RiverConfig.RaiseSize#100
//   #TurnConfigIP.BetSize#50
//   #TurnConfigIP.RaiseSize#100
//   #RiverConfigIP.BetSize#25,100
//   #RiverConfigIP.AddAllin#True
//
// Three things that capture pins down and that are easy to get wrong:
//   - A line is emitted only when its box is non-empty (or its checkbox is
//     ticked). The flop lines are absent above because the board is a turn
//     board, so the flop boxes were empty - not because flop is special.
//   - Ranges use Pio's shorthand: bare token at weight 1, `TOKEN:w`
//     otherwise, and a suited/offsuit pair at the SAME weight collapses to
//     the rankless token (`T4`, but `T3s,T3o:0.5` when they differ).
//   - The unsuffixed `#...Config.` lines are OOP; `#...ConfigIP.` are IP.
//     OOP's whole group comes first.

/* The box/seat types are ALIASES of the shared tree-building view model, not
 * copies of it. That is what makes /compare's adapter into TreeBuilding a
 * widening rather than a conversion, so this serializer cannot observe that
 * the shared component exists and the PioViewer round trip holds by
 * construction. Size strings stay exactly what the user typed: percent-of-pot
 * numbers separated by spaces or commas, or "a" for all-in. */
export type {
  TreeStreetView as StreetBoxes,
  TreeSeatView as SeatBoxes,
  TreeStreet as StreetKey,
} from "@/components/treeBuildingView";

import {
  parseRangeTokens,
  serializeRangeTokens,
} from "@/lib/solver/rangeTokens";
import {
  TREE_STREETS,
  emptySeatView,
  emptyStreetView,
  parseBoardCards,
  type TreeBuildingView,
  type TreeClipboardCodec,
  type TreeSeatView,
  type TreeStreet,
  type TreeStreetView,
} from "@/components/treeBuildingView";

/* Local aliases so the rest of this file keeps reading in its own vocabulary
 * (a re-export does not bring the name into scope). */
type StreetBoxes = TreeStreetView;
type SeatBoxes = TreeSeatView;
type StreetKey = TreeStreet;

export const STREET_KEYS: TreeStreet[] = TREE_STREETS;

/** Everything the clipboard format carries: the shared view model minus the
 *  three knobs that are ours and have no PioViewer key. */
export type TreeConfigText = Omit<
  TreeBuildingView,
  "maxRaises" | "preflopAggressor" | "betStructureOnly"
>;

export const emptyStreet = (): TreeStreetView => emptyStreetView();

export const emptySeat = (): TreeSeatView => emptySeatView();

export const cloneSeat = (seat: TreeSeatView): TreeSeatView => ({
  flop: { ...seat.flop },
  turn: { ...seat.turn },
  river: { ...seat.river },
});

/* ---------- ranges ----------
 * Moved to lib/solver/rangeTokens.ts, and re-exported here so this module
 * still reads as "the PioViewer text format, both directions". The range
 * codec had to leave this file because the range picker needs it too, and a
 * component cannot import from a page. */
export {
  fullRangeWeights,
  parseRangeTokens,
  pioRangeCodec,
  serializeRangeTokens,
} from "@/lib/solver/rangeTokens";

/* ---------- board ---------- */

/* Single implementation, shared with the tree-building panel, so the
 * serializer and the UI can never disagree about what a board string means. */
export { parseBoardCards } from "@/components/treeBuildingView";

/* ---------- serialize ---------- */

const STREET_LABEL: Record<StreetKey, string> = {
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

const streetLines = (
  street: StreetKey,
  suffix: "" | "IP",
  boxes: StreetBoxes
): string[] => {
  const key = `#${STREET_LABEL[street]}Config${suffix}`;
  const lines: string[] = [];
  const bet = boxes.bet.trim();
  const raise = boxes.raise.trim();
  const donk = boxes.donk.trim();
  if (bet) lines.push(`${key}.BetSize#${bet}`);
  if (raise) lines.push(`${key}.RaiseSize#${raise}`);
  if (boxes.addAllin) lines.push(`${key}.AddAllin#True`);
  // Donk trails AddAllin in PioViewer's own output.
  if (suffix === "" && donk) lines.push(`${key}.DonkBetSize#${donk}`);
  return lines;
};

/**
 * The full clipboard text (no trailing newline).
 *
 * "Don't 3-bet" is deliberately absent: PioViewer's clipboard format has no
 * field for it that we can round-trip with confidence, and emitting a
 * guessed key would make the text fail to paste back into PioViewer. The
 * builder warns when the setting is on so it is never silently dropped.
 */
export const serializeTreeConfigText = (config: TreeConfigText): string => {
  const cards = parseBoardCards(config.board);
  const lines: string[] = [
    "#Type#NoLimit",
    `#Range0#${serializeRangeTokens(config.oopRange)}`,
    `#Range1#${serializeRangeTokens(config.ipRange)}`,
    `#Board#${cards.join(" ")}`,
    `#Pot#${config.pot.trim()}`,
    `#EffectiveStacks#${config.effectiveStacks.trim()}`,
    `#AllinThreshold#${config.allinThresholdPct.trim()}`,
    `#AddAllinOnlyIfLessThanThisTimesThePot#${config.addAllinCapPct.trim()}`,
  ];
  for (const street of STREET_KEYS) lines.push(...streetLines(street, "", config.oop[street]));
  for (const street of STREET_KEYS) lines.push(...streetLines(street, "IP", config.ip[street]));
  return lines.join("\n");
};

/* ---------- parse ---------- */

export interface ParsedTreeConfigText {
  /** Ranges / board / pot / stacks / thresholds, absent when the text had none. */
  spot: Partial<Omit<TreeConfigText, "oop" | "ip">>;
  /** Always complete: a pasted config REPLACES the betting structure, so a
   *  street the text does not mention comes back empty rather than stale. */
  oop: SeatBoxes;
  ip: SeatBoxes;
}

const CONFIG_LINE = /^(Flop|Turn|River)Config(IP)?\.(BetSize|RaiseSize|DonkBetSize|AddAllin)$/;

/** Parse PioViewer clipboard text. Throws only when the text is clearly not
 *  a tree config; unknown keys (ICM, cap, merge) are ignored. */
export const parseTreeConfigText = (text: string): ParsedTreeConfigText => {
  const result: ParsedTreeConfigText = { spot: {}, oop: emptySeat(), ip: emptySeat() };
  let matched = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("#")) continue;
    const cut = line.indexOf("#", 1);
    if (cut < 0) continue;
    const key = line.slice(1, cut);
    const value = line.slice(cut + 1).trim();
    matched += 1;

    const config = CONFIG_LINE.exec(key);
    if (config) {
      const street = config[1].toLowerCase() as StreetKey;
      const seat = config[2] === "IP" ? result.ip : result.oop;
      const boxes = seat[street];
      if (config[3] === "BetSize") boxes.bet = value;
      else if (config[3] === "RaiseSize") boxes.raise = value;
      else if (config[3] === "DonkBetSize") boxes.donk = value;
      else boxes.addAllin = value.toLowerCase() === "true";
      continue;
    }

    switch (key) {
      case "Range0":
        result.spot.oopRange = parseRangeTokens(value);
        break;
      case "Range1":
        result.spot.ipRange = parseRangeTokens(value);
        break;
      case "Board":
        result.spot.board = parseBoardCards(value).join(" ");
        break;
      case "Pot":
        result.spot.pot = value;
        break;
      case "EffectiveStacks":
        result.spot.effectiveStacks = value;
        break;
      case "AllinThreshold":
        result.spot.allinThresholdPct = value;
        break;
      case "AddAllinOnlyIfLessThanThisTimesThePot":
        result.spot.addAllinCapPct = value;
        break;
      default:
        // #Type#, #ICM.*#, #Cap*#, #MergeSimilarBets*# - nothing this page models.
        matched -= 1;
        break;
    }
  }

  if (matched === 0) {
    throw new Error(
      "That does not look like a PioViewer tree config - expected lines like #Board#Ah Kd 9c."
    );
  }
  return result;
};

/**
 * The clipboard half of this module, packaged for the shared tree-building
 * panel. The panel takes it as a prop rather than importing it, because
 * src/components must not depend on src/pages - and passing it doubles as the
 * feature flag, since a screen that cannot round-trip through PioViewer simply
 * has no codec to hand over.
 */
export const pioClipboardCodec: TreeClipboardCodec = {
  serialize: serializeTreeConfigText,
  parse: parseTreeConfigText,
};

