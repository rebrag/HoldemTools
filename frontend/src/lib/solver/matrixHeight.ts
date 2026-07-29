// The matrix's hand-cell height modes (GTO Wizard style): how tall each cell's
// colored strategy bar renders relative to the hand class's reach weight at
// the current node. Kept out of the page components so Solver, DecisionMatrix,
// and the header menus can all import it without cycles.

export type MatrixHeightMode = "normalized" | "range" | "full";

export const DEFAULT_MATRIX_HEIGHT_MODE: MatrixHeightMode = "normalized";

export const MATRIX_HEIGHT_MODE_KEY = "matrixHeightMode";

/** The three cell-height modes, in menu order. */
export const MATRIX_HEIGHT_MODE_OPTIONS: Array<{
  mode: MatrixHeightMode;
  label: string;
  desc: string;
}> = [
  {
    mode: "normalized",
    label: "Normalized",
    desc: "Most frequent hand fills its cell; the rest scale to it",
  },
  {
    mode: "range",
    label: "Range height",
    desc: "Height shows how much of the hand reaches this spot",
  },
  {
    mode: "full",
    label: "Full height",
    desc: "Every cell is always filled",
  },
];

const MODES: readonly MatrixHeightMode[] = ["normalized", "range", "full"];

export function loadMatrixHeightMode(): MatrixHeightMode {
  try {
    const raw = localStorage.getItem(MATRIX_HEIGHT_MODE_KEY);
    if (raw && (MODES as readonly string[]).includes(raw)) {
      return raw as MatrixHeightMode;
    }
  } catch {
    /* private mode / SSR: fall through to default */
  }
  return DEFAULT_MATRIX_HEIGHT_MODE;
}

export function saveMatrixHeightMode(mode: MatrixHeightMode): void {
  try {
    localStorage.setItem(MATRIX_HEIGHT_MODE_KEY, mode);
  } catch {
    /* best effort */
  }
}
