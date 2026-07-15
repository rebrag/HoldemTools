/**
 * Parses the real exported solver ranges (src/pages/home/previews/solutionData.ts)
 * into the shape the homepage range grid renders. The "Solutions · live"
 * preview alternates between these states every few seconds so the grid morphs
 * with the same 500ms width transition as the live Solutions grid.
 *
 * Action weights come straight from the solve; colors mirror the app's real
 * action colors (src/lib/solver/constants.ts).
 */

import { HJ_23, CO_23, type RawSolution } from "./solutionData";

export const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

export type ActionKey = "ALLIN" | "Raise 50%" | "Min" | "Call" | "Fold";

// Fixed render order so segments keep their slot across state swaps (this is
// what lets each cell's widths transition smoothly instead of jumping).
export const SEGMENT_ORDER: ActionKey[] = ["ALLIN", "Raise 50%", "Min", "Call", "Fold"];

export const ACTION_COLORS: Record<ActionKey, string> = {
  ALLIN: "#7d1f1e",
  "Raise 50%": "#C14c39",
  Min: "#F03c3c",
  Call: "#5ab964",
  Fold: "#3d7cb8",
};

export const ACTION_LABELS: Record<ActionKey, string> = {
  ALLIN: "All-in",
  "Raise 50%": "Raise 50%",
  Min: "Min",
  Call: "Call",
  Fold: "Fold",
};

export interface CellMix {
  hand: string;
  isPair: boolean;
  mix: Record<ActionKey, number>;
}

export interface RangeState {
  id: string;
  caption: string;
  stack: string;
  legend: ActionKey[];
  cells: CellMix[];
}

function handName(i: number, j: number): { hand: string; isPair: boolean } {
  if (i === j) return { hand: `${RANKS[i]}${RANKS[i]}`, isPair: true };
  const hi = Math.min(i, j);
  const lo = Math.max(i, j);
  return { hand: `${RANKS[hi]}${RANKS[lo]}${i < j ? "s" : "o"}`, isPair: false };
}

function normalize(raw: Record<ActionKey, number>): Record<ActionKey, number> {
  let total = 0;
  for (const key of SEGMENT_ORDER) total += raw[key];
  if (total <= 0) return { ALLIN: 0, "Raise 50%": 0, Min: 0, Call: 0, Fold: 1 };
  const out = { ALLIN: 0, "Raise 50%": 0, Min: 0, Call: 0, Fold: 0 } as Record<ActionKey, number>;
  for (const key of SEGMENT_ORDER) out[key] = raw[key] / total;
  return out;
}

function parseSolution(sol: RawSolution, id: string): RangeState {
  const cells: CellMix[] = [];
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = 0; j < RANKS.length; j++) {
      const { hand, isPair } = handName(i, j);
      const raw = { ALLIN: 0, "Raise 50%": 0, Min: 0, Call: 0, Fold: 0 } as Record<ActionKey, number>;
      for (const key of SEGMENT_ORDER) {
        raw[key] = sol[key]?.[hand]?.[0] ?? 0;
      }
      cells.push({ hand, isPair, mix: normalize(raw) });
    }
  }

  // Legend: only the actions this solve actually uses (a defined action whose
  // weights are all zero, e.g. HJ's all-in, should not show a swatch).
  const used = new Set<ActionKey>();
  for (const cell of cells) {
    for (const key of SEGMENT_ORDER) {
      if (cell.mix[key] > 0.001) used.add(key);
    }
  }
  const legend = SEGMENT_ORDER.filter((key) => used.has(key));

  return {
    id,
    caption: sol.Position,
    stack: `${sol.bb} bb`,
    legend,
    cells,
  };
}

export function buildSolutionRanges(): RangeState[] {
  return [parseSolution(HJ_23, "hj23"), parseSolution(CO_23, "co23")];
}
