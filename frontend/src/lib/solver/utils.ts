// src/utils/utils.ts

export interface HandData {
  [hand: string]: [number, number]; // [strategyWeight, EV]
}

export interface JsonData {
  Position: string;
  bb: number;
  // All other keys (like "Fold", "Call", etc.) will be action data.
  [action: string]: string | number | HandData;
}

// Extend HandCellData to carry both strategy and EVs
export interface HandCellData {
  hand: string;
  actions: Record<string, number>;
  evs: Record<string, number>;
}

// Generate a consistent color from a string using a hash function.
export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = "#";
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff;
    color += ("00" + value.toString(16)).substr(-2);
  }
  return color;
}

// src/utils/utils.ts

// ...keep your existing interfaces above...

// ---- Action colors ----
//
// Single source of truth for the ColorKey legend, the DecisionMatrix cells, the
// action summary and both line strips, so every view agrees. Passive actions
// (check/call) share the preflop green; folds are blue; bets and raises run a
// warm orange -> deep red ramp graded by size, and all-in is darker than
// anything the ramp can reach.
//
// Two rules the ramp has to satisfy at once, which is what makes this more than
// a lerp:
//   1. DARKER IS ALWAYS BIGGER, and roughly stable across nodes, so a shade
//      means something on its own.
//   2. Sizes that actually appear together at one node must be TELLABLE APART.
// An absolute ramp alone fails (2): a 2 / 2.5 / 3bb open family lands within a
// few percent of the gradient. So buildActionPalette anchors each bet
// absolutely, then guarantees a minimum gap between the sizes present at that
// node. getColorForAction stays as the single-label fallback.

const ACTION_GREEN = "#5ab964"; // Check / Call
const ACTION_BLUE = "#3d7cb8"; // Fold
const ACTION_MIN = "#F03c3c"; // Min (pre-flop min-open)
/** All-in. Deliberately far darker than BET_DARK - it used to sit ~33 points of
 *  red away from the ramp's end, which read as "just the biggest bet". */
const ACTION_ALLIN = "#5B1210";
const BET_LIGHT = "#F08A4B"; // smallest bet/raise (warm orange)
const BET_DARK = "#A02722"; // largest bet/raise (deep red, still short of all-in)
const ACTION_FALLBACK = "#C14c39";

const isPassive = (n: string) =>
  n === "check" || n === "call" || n === "c" || n === "x";
const isFold = (n: string) => n === "fold" || n === "f";
const isAllin = (n: string) => n === "allin" || n === "all-in" || n === "all in";
const isBetOrRaise = (label: string) => /^(bet|raise)\b/i.test(label.trim());

/** What a bet label's number is denominated in. */
export type BetUnit = "pct" | "bb";

export interface ParsedBetSize {
  /** Percent of pot when unit is "pct"; big blinds when "bb". */
  value: number;
  unit: BetUnit;
}

/**
 * Size and UNIT of a bet/raise label.
 *
 * Reading the number without its unit is what used to break the ramp: preflop
 * plates mix "Raise 3bb" with "Raise 54%" / "Raise 75%" / "Raise 100%" /
 * "Raise 125%" (see lib/solver/constants.ts), and treating 54..125 as big
 * blinds pushed every percent-labelled raise past the ramp's ceiling, so they
 * all rendered the identical darkest red - indistinguishable from each other
 * and nearly indistinguishable from all-in.
 *
 * A bare number is the hand's own money; `sizeRef` (money per big blind)
 * converts it, so "Bet 50" in a $5 game is 10bb.
 */
export function parseBetSize(label: string, sizeRef = 1): ParsedBetSize | null {
  if (!isBetOrRaise(label)) return null;
  const m = label.match(/(\d+(?:\.\d+)?)\s*(%|bb)?/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = (m[2] ?? "").toLowerCase();
  if (suffix === "%") return { value, unit: "pct" };
  if (suffix === "bb") return { value, unit: "bb" };
  return { value: value / (sizeRef > 0 ? sizeRef : 1), unit: "bb" };
}

/** The raw number in a bet/raise label, unit-blind. Kept for callers that only
 *  need to sort within one node, where every label shares a unit. */
export function betSize(label: string): number | null {
  if (!isBetOrRaise(label)) return null;
  const m = label.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

export const hexToRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};
export const mixHex = (c1: string, c2: string, t: number): string => {
  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  const ch = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return (
    "#" + [ch(0), ch(1), ch(2)].map((x) => x.toString(16).padStart(2, "0")).join("")
  );
};

/* Ramp calibration, one band per unit. A node's labels always share a unit, so
 * per-unit anchoring keeps "darker is bigger" true wherever it is observable.
 * Both are log-spaced because bet sizes are perceived multiplicatively - the
 * step from 33% to 50% reads like the step from 100% to 150%. */
const PCT_MIN = 20; // a small stab
const PCT_MAX = 300; // a big overbet
const BB_MIN = 0.75;
const BB_MAX = 60;

const logNorm = (v: number, lo: number, hi: number): number =>
  Math.max(0, Math.min(1, Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo)));

/** Absolute ramp position, 0 = smallest, 1 = largest. */
const betRampT = (size: ParsedBetSize): number =>
  size.unit === "pct"
    ? logNorm(size.value, PCT_MIN, PCT_MAX)
    : logNorm(size.value, BB_MIN, BB_MAX);

/**
 * Smallest perceptual step we are willing to render between two bet sizes at
 * the same node. Roughly a fifth of the ramp, which on this gradient is a
 * clearly visible change in both hue and lightness.
 */
const MIN_BET_GAP = 0.19;

/**
 * Push ascending ramp positions apart so adjacent ones differ visibly, without
 * reordering them and without leaving the ramp.
 *
 * Order is preserved by construction (each pass only ever moves a value toward
 * the neighbour it is too close to, never past it). When more sizes are present
 * than the ramp can separate at MIN_BET_GAP, the gap shrinks to an even split
 * rather than clipping the largest ones together at the dark end.
 */
const spreadRamp = (ascending: number[]): number[] => {
  const n = ascending.length;
  if (n < 2) return ascending;

  const gap = Math.min(MIN_BET_GAP, 1 / (n - 1));
  const t = [...ascending];

  const pushUp = () => {
    for (let i = 1; i < n; i++) t[i] = Math.max(t[i], t[i - 1] + gap);
  };

  pushUp();
  if (t[n - 1] > 1) {
    // Ran off the dark end: pin the largest at the ramp's end and push back
    // down, then repair any collision that creates at the light end.
    t[n - 1] = 1;
    for (let i = n - 2; i >= 0; i--) t[i] = Math.min(t[i], t[i + 1] - gap);
    t[0] = Math.max(0, t[0]);
    pushUp();
  }
  return t.map((v) => Math.max(0, Math.min(1, v)));
};

const betColorAt = (t: number): string => mixHex(BET_LIGHT, BET_DARK, t);

/** Color for a non-bet label, or null when it is a bet/raise. */
const categoricalColor = (action: string): string | null => {
  const a = (action ?? "").trim();
  const n = a.toLowerCase();
  if (isPassive(n)) return ACTION_GREEN;
  if (isFold(n)) return ACTION_BLUE;
  if (isAllin(n)) return ACTION_ALLIN;
  if (a === "Min") return ACTION_MIN;
  if (isBetOrRaise(a)) return null;
  return ACTION_FALLBACK;
};

/**
 * Colors for every action at ONE node, with bet sizes guaranteed to be
 * distinguishable from each other.
 *
 * Prefer this over getColorForAction wherever the whole action set is in hand -
 * which is everywhere that matters, since the legend, the cells, the summary
 * and the line strips all enumerate a node's options. Using it everywhere is
 * also what keeps them agreeing: a bet's color depends on the node's size set,
 * so two views that pass different sets would disagree.
 *
 * `sizeRef` is how much of the label's unit makes one big blind: 1 when the
 * label is already in big blinds (every preflop sim), the hand's big blind when
 * it is in a recorded hand's own money.
 */
export const buildActionPalette = (
  actions: string[],
  sizeRef = 1
): Record<string, string> => {
  const out: Record<string, string> = {};

  /* One entry per DISTINCT size, so two labels for the same size (a bet and a
   * raise to the same amount) get the same shade instead of being forced
   * apart. */
  const bySize = new Map<number, string[]>();
  for (const action of actions) {
    const flat = categoricalColor(action);
    if (flat !== null) {
      out[action] = flat;
      continue;
    }
    const parsed = parseBetSize(action, sizeRef);
    if (!parsed) {
      out[action] = BET_LIGHT; // bet/raise with no parsable size
      continue;
    }
    const t = betRampT(parsed);
    const bucket = bySize.get(t);
    if (bucket) bucket.push(action);
    else bySize.set(t, [action]);
  }

  const ascending = [...bySize.keys()].sort((a, b) => a - b);
  const spread = spreadRamp(ascending);
  ascending.forEach((key, i) => {
    const color = betColorAt(spread[i]);
    for (const action of bySize.get(key)!) out[action] = color;
  });

  return out;
};

/**
 * Color for a single label, with no node context.
 *
 * This is the fallback: it can only place a bet on the absolute ramp, so two
 * close sizes will look close. Callers that know the node's full option list
 * should use buildActionPalette instead.
 */
export const getColorForAction = (action: string, sizeRef = 1): string => {
  const flat = categoricalColor(action);
  if (flat !== null) return flat;
  const parsed = parseBetSize(action, sizeRef);
  return parsed ? betColorAt(betRampT(parsed)) : BET_LIGHT;
};

export type ActionCategory = "allin" | "bet" | "min" | "passive" | "fold" | "other";

/** Category of an action label — drives ordering and the stable segment slots
 * in HandCell (which keep the CSS width transitions seamless). */
export const actionCategory = (action: string): ActionCategory => {
  const a = (action ?? "").trim();
  const n = a.toLowerCase();
  if (isAllin(n)) return "allin";
  if (isBetOrRaise(a)) return "bet";
  if (a === "Min") return "min";
  if (isPassive(n)) return "passive";
  if (isFold(n)) return "fold";
  return "other";
};

/** Shared ordering for legend bars AND matrix segments so they line up
 * left→right. Preserves the existing look: ALL-IN, bets/raises (largest first),
 * Min, passive (check/call), fold, then anything else. */
const CATEGORY_RANK: Record<ActionCategory, number> = {
  allin: 0,
  bet: 1,
  min: 2,
  passive: 3,
  fold: 4,
  other: 5,
};

const actionRank = (action: string): number => CATEGORY_RANK[actionCategory(action)];

export const orderActionKeys = (actions: string[]): string[] =>
  [...actions].sort((a, b) => {
    const ra = actionRank(a);
    const rb = actionRank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) return (betSize(b) ?? 0) - (betSize(a) ?? 0); // larger bet first
    return a.localeCompare(b);
  });


/** The betting options at a plate's node, in the plate's own key order.
 *  ("c" is the solver's key for a call; every other key is already a label.) */
export const plateActions = (data?: JsonData): string[] => {
  if (!data) return [];
  const acts = Object.keys(data)
    .filter((k) => k !== "Position" && k !== "bb")
    .map((k) => (k === "c" ? "Call" : k));
  return Array.from(new Set(acts));
};

/**
 * The cheapest way to pass the action on at a node: fold if the seat may,
 * else check, else call. Undefined when a node offers none of the three, i.e.
 * the seat cannot get out of the way. Drives the Line's "click a seat to skip
 * ahead to it" shortcut.
 */
export const passiveAction = (options: string[]): string | undefined =>
  ["Fold", "Check", "Call"].find((action) => options.includes(action));

// Combine JsonData into an array of HandCellData objects,
// extracting both strategy weights and EV values per action.
export const combineDataByHand = (data: JsonData): HandCellData[] => {
  const combined: Record<string, HandCellData> = {};

  for (const key in data) {
    if (key === "Position" || key === "bb") continue;

    const actionData = data[key] as HandData;
    if (typeof actionData === "object" && actionData !== null) {
      for (const hand in actionData) {
        const [strategyWeight, evValue] = actionData[hand];

        // normalize action keys
        const actionKey = key === "c" ? "Call" : key;

        if (!combined[hand]) {
          combined[hand] = { hand, actions: {}, evs: {} };
        }

        combined[hand].actions[actionKey] = strategyWeight;
        combined[hand].evs[actionKey] = evValue;
      }
    }
  }

  return Object.values(combined);
};

