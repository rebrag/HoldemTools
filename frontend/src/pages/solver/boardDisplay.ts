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

/** "Flop · Pot 12.5 bb" - matches the hand replayer's pot label. */
export const solverPotLabel = (pot: number, board?: string[]): string =>
  `${streetNameForBoard(board)} · Pot ${fmtBB(Math.max(0, pot), 1)} bb`;

/**
 * Board card width for a table of `tableWidth` px. The felt is ~82% of the
 * table box, so five cards plus gaps stay comfortably inside it on a small
 * phone while still reading clearly on the desktop study layout.
 */
export const boardCardWidth = (tableWidth: number): number =>
  Math.max(20, Math.min(36, Math.round(tableWidth * 0.082)));
