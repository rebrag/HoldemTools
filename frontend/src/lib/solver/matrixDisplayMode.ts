// The matrix's display modes (GTO Wizard style): what the 169 cells' colors
// encode - the strategy mix (default), per-combo EV heat, or per-combo equity
// heat. Kept out of the page components so Solver, DecisionMatrix, and the
// dropdown can all import it without cycles, mirroring matrixHeight.ts.
import { mixHex, type HandCellData } from "./utils";
import { expandHandCombos } from "./aggregates";
import { HAND_ORDER } from "./handOrder";
import { comboKey, type ComboDetail } from "./comboDetail";

export type MatrixDisplayMode = "strategy" | "ev" | "equity";

export const DEFAULT_MATRIX_DISPLAY_MODE: MatrixDisplayMode = "strategy";

export const MATRIX_DISPLAY_MODE_KEY = "matrixDisplayMode";

/** The three display modes, in menu order. */
export const MATRIX_DISPLAY_MODE_OPTIONS: Array<{
  mode: MatrixDisplayMode;
  label: string;
  desc: string;
}> = [
  {
    mode: "strategy",
    label: "Strategy",
    desc: "Cells show each hand's action mix",
  },
  {
    mode: "ev",
    label: "EV",
    desc: "Red-to-green heat by EV, relative to this spot",
  },
  {
    mode: "equity",
    label: "Equity",
    desc: "Red-to-green heat by equity vs the opponent's range",
  },
];

const MODES: readonly MatrixDisplayMode[] = ["strategy", "ev", "equity"];

export function loadMatrixDisplayMode(): MatrixDisplayMode {
  try {
    const raw = localStorage.getItem(MATRIX_DISPLAY_MODE_KEY);
    if (raw && (MODES as readonly string[]).includes(raw)) {
      return raw as MatrixDisplayMode;
    }
  } catch {
    /* private mode / SSR: fall through to default */
  }
  return DEFAULT_MATRIX_DISPLAY_MODE;
}

export function saveMatrixDisplayMode(mode: MatrixDisplayMode): void {
  try {
    localStorage.setItem(MATRIX_DISPLAY_MODE_KEY, mode);
  } catch {
    /* best effort */
  }
}

/* ---------- heat scale ---------- */

const HEAT_RED = "#c0392b";
const HEAT_AMBER = "#e3c94e";
const HEAT_GREEN = "#2f9e57";

/** Red -> amber -> green heat for t in 0..1 (clamped). */
export const heatColor = (t: number): string => {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5
    ? mixHex(HEAT_RED, HEAT_AMBER, c * 2)
    : mixHex(HEAT_AMBER, HEAT_GREEN, (c - 0.5) * 2);
};

export interface ValueRange {
  min: number;
  max: number;
}

/** Map a value onto 0..1 within a range; a degenerate range reads neutral. */
export const normalizeToRange = (v: number, r: ValueRange): number =>
  r.max - r.min < 1e-9 ? 0.5 : (v - r.min) / (r.max - r.min);

/* ---------- per-node display data ---------- */

/**
 * A hand class's strategy-weighted EV from the 169-class data. Preflop this is
 * the true mixed EV (evs are real per-action EVs); postflop the class EV is
 * duplicated across every action key, so the weighting degenerates to that
 * same number - correct either way. Null for hands not in the range.
 */
export const classWeightedEv = (cell: HandCellData): number | null => {
  let wSum = 0;
  let evSum = 0;
  for (const [action, weight] of Object.entries(cell.actions)) {
    const w = weight || 0;
    const ev = cell.evs[action];
    if (w <= 0 || typeof ev !== "number" || !Number.isFinite(ev)) continue;
    wSum += w;
    evSum += w * ev;
  }
  return wSum > 0 ? evSum / wSum : null;
};

export interface MatrixDisplayData {
  mode: "ev" | "equity";
  /**
   * Hand class -> one stripe color per board-unblocked combo, in
   * expandHandCombos order. "transparent" marks combos not in the range.
   * Null when there is no per-combo data (preflop, opponent seat, old docs).
   */
  stripesByHand: Map<string, string[]> | null;
  /** Class-level fallback (EV without per-combo data): hand -> solid color. */
  solidByHand: Map<string, string> | null;
  /** EV normalization actually used, so HandBreakdown shares the same scale. */
  evRange: ValueRange | null;
}

/**
 * Build the per-node cell colors for one display mode. One memoized call per
 * node; "strategy" returns null (cells keep their action-mix rendering).
 *
 * Per-combo values come from ComboRow.ev / ComboRow.equity - the block the
 * watcher uploads per node (schema 4), decoded by buildComboDetail. EV is
 * normalized min..max over the in-range combos (its magnitude tracks the pot,
 * so an absolute scale would wash out small pots); equity is an absolute 0..1
 * scale so the same equity reads the same color at every node.
 */
export function buildMatrixDisplayData(
  mode: MatrixDisplayMode,
  grid: HandCellData[],
  comboDetail: ComboDetail | null | undefined,
  board: string[] | undefined
): MatrixDisplayData | null {
  if (mode === "strategy") return null;

  if (comboDetail) {
    let evRange: ValueRange | null = null;
    if (mode === "ev") {
      let min = Infinity;
      let max = -Infinity;
      for (const row of comboDetail.byCombo.values()) {
        if (row.weight <= 0 || row.ev == null) continue;
        if (row.ev < min) min = row.ev;
        if (row.ev > max) max = row.ev;
      }
      if (min <= max) evRange = { min, max };
    }

    const blocked = new Set(board ?? []);
    const stripesByHand = new Map<string, string[]>();
    for (const hand of HAND_ORDER) {
      const stripes: string[] = [];
      for (const [c1, c2] of expandHandCombos(hand)) {
        if (blocked.has(c1) || blocked.has(c2)) continue; // dead: no stripe
        const row = comboDetail.byCombo.get(comboKey(c1, c2));
        const value =
          row && row.weight > 0 ? (mode === "ev" ? row.ev : row.equity) : null;
        stripes.push(
          value == null
            ? "transparent"
            : heatColor(
                mode === "ev" && evRange
                  ? normalizeToRange(value, evRange)
                  : value
              )
        );
      }
      if (stripes.length) stripesByHand.set(hand, stripes);
    }
    return { mode, stripesByHand, solidByHand: null, evRange };
  }

  // Equity has no class-level source; the dropdown disables it here, so this
  // is only a guard against a stale saved mode.
  if (mode === "equity") return null;

  // EV without per-combo data: solid class-level heat.
  const byHand = new Map<string, number>();
  let min = Infinity;
  let max = -Infinity;
  for (const cell of grid) {
    const ev = classWeightedEv(cell);
    if (ev == null) continue;
    byHand.set(cell.hand, ev);
    if (ev < min) min = ev;
    if (ev > max) max = ev;
  }
  if (!byHand.size) return null;

  const evRange: ValueRange = { min, max };
  const solidByHand = new Map<string, string>();
  for (const [hand, ev] of byHand) {
    solidByHand.set(hand, heatColor(normalizeToRange(ev, evRange)));
  }
  return { mode, stripesByHand: null, solidByHand, evRange };
}
