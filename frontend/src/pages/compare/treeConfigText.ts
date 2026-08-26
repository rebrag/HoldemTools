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

const RANKS = "AKQJT98765432";

/** One street's boxes for one seat. Size strings are whatever the user typed:
 *  percent-of-pot numbers separated by spaces or commas, or "a" for all-in. */
export interface StreetBoxes {
  bet: string;
  raise: string;
  /** OOP only: lead into the previous street's aggressor. */
  donk: string;
  addAllin: boolean;
  /** IP only: never make the third aggressive action of a street. */
  noThreeBet: boolean;
}

export interface SeatBoxes {
  flop: StreetBoxes;
  turn: StreetBoxes;
  river: StreetBoxes;
}

export type StreetKey = keyof SeatBoxes;
export const STREET_KEYS: StreetKey[] = ["flop", "turn", "river"];

/** Everything the clipboard format carries. */
export interface TreeConfigText {
  oopRange: Record<string, number>;
  ipRange: Record<string, number>;
  board: string;
  pot: string;
  effectiveStacks: string;
  allinThresholdPct: string;
  addAllinCapPct: string;
  oop: SeatBoxes;
  ip: SeatBoxes;
}

export const emptyStreet = (): StreetBoxes => ({
  bet: "",
  raise: "",
  donk: "",
  addAllin: false,
  noThreeBet: false,
});

export const emptySeat = (): SeatBoxes => ({
  flop: emptyStreet(),
  turn: emptyStreet(),
  river: emptyStreet(),
});

export const cloneSeat = (seat: SeatBoxes): SeatBoxes => ({
  flop: { ...seat.flop },
  turn: { ...seat.turn },
  river: { ...seat.river },
});

/* ---------- ranges ---------- */

/** 0.5 -> "0.5", 1 -> "1", 0.25 -> "0.25" (no trailing zeros). */
const formatWeight = (w: number): string => String(Math.round(w * 10000) / 10000);

const token = (hand: string, w: number): string =>
  w >= 1 ? hand : `${hand}:${formatWeight(w)}`;

/**
 * Weights (0..1 per 169-class key) -> Pio's range string.
 *
 * Emission order matches PioViewer's own: every pair from AA down to 22,
 * then the non-pairs by descending high card and then descending kicker.
 * Order is not semantically load-bearing for Pio, but matching it byte for
 * byte is what makes a copy/paste round trip diff-clean.
 */
export const serializeRangeTokens = (weights: Record<string, number>): string => {
  const out: string[] = [];
  const at = (hand: string) => {
    const w = weights[hand] ?? 0;
    return w > 0 ? Math.min(1, w) : 0;
  };

  for (const rank of RANKS) {
    const pair = rank + rank;
    const w = at(pair);
    if (w > 0) out.push(token(pair, w));
  }
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i + 1; j < RANKS.length; j++) {
      const base = RANKS[i] + RANKS[j];
      const ws = at(`${base}s`);
      const wo = at(`${base}o`);
      if (ws > 0 && ws === wo) {
        out.push(token(base, ws));
        continue;
      }
      if (ws > 0) out.push(token(`${base}s`, ws));
      if (wo > 0) out.push(token(`${base}o`, wo));
    }
  }
  return out.join(",");
};

const isRank = (c: string) => RANKS.includes(c);

/** Inverse of serializeRangeTokens. A rankless token like "T4" expands to
 *  both T4s and T4o; unrecognized tokens are skipped rather than throwing,
 *  so one stray entry cannot lose the whole pasted range. */
export const parseRangeTokens = (text: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const raw of text.split(/[,\s]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const [handRaw, weightRaw] = part.split(":");
    const hand = handRaw.trim();
    if (hand.length < 2) continue;
    const hi = hand[0].toUpperCase();
    const lo = hand[1].toUpperCase();
    if (!isRank(hi) || !isRank(lo)) continue;
    const w = weightRaw === undefined ? 1 : Number(weightRaw);
    if (!Number.isFinite(w) || w <= 0) continue;
    const weight = Math.min(1, w);

    if (hi === lo) {
      out[hi + lo] = weight;
      continue;
    }
    // Pio always writes the higher rank first; normalize in case a
    // hand-typed range does not.
    const [a, b] = RANKS.indexOf(hi) <= RANKS.indexOf(lo) ? [hi, lo] : [lo, hi];
    const suffix = hand[2]?.toLowerCase();
    if (suffix === "s") out[`${a}${b}s`] = weight;
    else if (suffix === "o") out[`${a}${b}o`] = weight;
    else {
      out[`${a}${b}s`] = weight;
      out[`${a}${b}o`] = weight;
    }
  }
  return out;
};

/** Every 169-class key at full weight - the "100%" starting range. */
export const fullRangeWeights = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (let i = 0; i < RANKS.length; i++) {
    out[RANKS[i] + RANKS[i]] = 1;
    for (let j = i + 1; j < RANKS.length; j++) {
      out[`${RANKS[i]}${RANKS[j]}s`] = 1;
      out[`${RANKS[i]}${RANKS[j]}o`] = 1;
    }
  }
  return out;
};

/* ---------- board ---------- */

export const parseBoardCards = (board: string): string[] =>
  (board.match(/[2-9TJQKA][hdcs]/gi) ?? []).map(
    (c) => c[0].toUpperCase() + c[1].toLowerCase()
  );

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
