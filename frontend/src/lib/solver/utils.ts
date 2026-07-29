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
// Single source of truth for BOTH the ColorKey legend and the DecisionMatrix
// cells. Every action label is colored by the same pure function, so the legend
// and the matrix segments always agree. Passive actions (check/call) share the
// preflop green; folds are blue; bets/raises are a red graded by size so
// distinct sizings are visually distinguishable and consistent between views.

const ACTION_GREEN = "#5ab964"; // Check / Call
const ACTION_BLUE = "#3d7cb8"; // Fold
const ACTION_MIN = "#F03c3c"; // Min (pre-flop min-open)
const ACTION_ALLIN = "#7d1f1e"; // All-in
const BET_LIGHT = "#E8743C"; // smallest bet/raise (orange-red)
const BET_DARK = "#9E2A24"; // largest bet/raise (deep red, still above ALL-IN)
const ACTION_FALLBACK = "#C14c39";

// Retained for backward-compat imports; no longer used for coloring.
export const UNKNOWN_MULTI_COLOR = "#F2733c";

const isPassive = (n: string) =>
  n === "check" || n === "call" || n === "c" || n === "x";
const isFold = (n: string) => n === "fold" || n === "f";
const isAllin = (n: string) => n === "allin" || n === "all-in" || n === "all in";
const isBetOrRaise = (label: string) => /^(bet|raise)\b/i.test(label.trim());

/** Numeric size in a bet/raise label ("Bet 1.8bb", "Raise to 20bb", "Raise 2bb",
 * "Raise 54%") — the first number found, or null. */
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

/**
 * `sizeRef` is how much of the label's unit makes one big blind. It is 1 when
 * the label is already in big blinds (every preflop sim), and the hand's big
 * blind when the label is in a recorded hand's own money - a "Bet 50" in a
 * $5 game is 10bb, and without this every bet at a real stake would exceed
 * the ramp's ceiling and render the same darkest shade.
 */
export const getColorForAction = (action: string, sizeRef = 1): string => {
  const a = (action ?? "").trim();
  const n = a.toLowerCase();
  if (isPassive(n)) return ACTION_GREEN;
  if (isFold(n)) return ACTION_BLUE;
  if (isAllin(n)) return ACTION_ALLIN;
  if (a === "Min") return ACTION_MIN;
  const size = betSize(a);
  if (size != null) {
    // Log ramp so small flop bets and large river bets both spread across the
    // gradient (~0.5bb → light, ~40bb+ → dark).
    const sizeBB = size / (sizeRef > 0 ? sizeRef : 1);
    const t = Math.max(0, Math.min(1, Math.log2(sizeBB + 1) / Math.log2(41)));
    return mixHex(BET_LIGHT, BET_DARK, t);
  }
  if (isBetOrRaise(a)) return BET_LIGHT; // bet/raise with no parsable size
  return ACTION_FALLBACK;
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

