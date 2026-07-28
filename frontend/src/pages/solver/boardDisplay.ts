// src/pages/solver/boardDisplay.ts
// Board-derived presentation values shared by the solver's two single-range
// tables: which street the board implies, the pot label that goes with it, and
// how wide the community cards should render for a given table size.
import { fmtBB } from "./views/useActiveRange";

/** Street implied by how many community cards are out. */
export const streetNameForBoard = (board?: string[]): string => {
  const n = board?.length ?? 0;
  if (n === 0) return "Preflop";
  if (n <= 3) return "Flop";
  if (n === 4) return "Turn";
  return "River";
};

/** How money is displayed in the postflop viewer. "chips" is only offered for
 *  hand-history solves, whose manifest carries the hand's big blind size. */
export type MoneyDisplay = {
  mode: "chips" | "bb";
  /** Real chips per big blind (from the recorded hand). */
  bbSize: number;
  onToggle: () => void;
};

const fmtChipAmount = (n: number): string => {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
};

/** Format a bb amount in the chosen display unit ("2.75" chips / "5.5 bb"). */
export const fmtMoney = (
  bbAmount: number,
  money?: Pick<MoneyDisplay, "mode" | "bbSize"> | null
): string =>
  money && money.mode === "chips"
    ? fmtChipAmount(bbAmount * money.bbSize)
    : `${fmtBB(bbAmount, 1)} bb`;

/** "Flop · Pot 12.5 bb" - matches the hand replayer's pot label. */
export const solverPotLabel = (
  pot: number,
  board?: string[],
  money?: Pick<MoneyDisplay, "mode" | "bbSize"> | null
): string =>
  `${streetNameForBoard(board)} · Pot ${fmtMoney(Math.max(0, pot), money)}`;

/**
 * Board card width for a table of `tableWidth` px. The felt is ~82% of the
 * table box, so five cards plus gaps stay comfortably inside it on a small
 * phone while still reading clearly on the desktop study layout.
 */
export const boardCardWidth = (tableWidth: number): number =>
  Math.max(20, Math.min(36, Math.round(tableWidth * 0.082)));
