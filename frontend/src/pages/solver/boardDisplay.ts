// src/pages/solver/boardDisplay.ts
// Board-derived presentation values shared by the solver's two single-range
// tables: which street the board implies, the pot label that goes with it, and
// how wide the community cards should render for a given table size.
//
// Deliberately component-free: the e2e specs typecheck against this module
// (money-units.spec.ts), and reaching a .tsx file from here breaks their
// JSX-less tsconfig.

/** "12.5" for fractional bb amounts, "12" for whole ones. */
export const fmtBB = (n: number, decimals = 1) =>
  Math.abs(n % 1) > 1e-9 ? n.toFixed(decimals) : n.toFixed(0);

/** How money is displayed in the postflop viewer.
 *
 *  Every amount handed to `fmtMoney` is already in the solve's own display
 *  money: big blinds for a preflop sim, the hand's chips for a recorded hand.
 *  A sim passes no MoneyDisplay at all, which is why every shared component
 *  keeps its plain "bb" label without a single conditional. */
export type MoneyDisplay = {
  mode: "money" | "bb";
  /** Display money per big blind (the recorded hand's big blind size). */
  bbSize: number;
  onToggle: () => void;
};

export type MoneyOpts = Pick<MoneyDisplay, "mode" | "bbSize">;

const fmtChipAmount = (n: number): string => {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
};

/** The amount in the chosen unit, with no unit suffix - for tight layouts
 *  like the postflop line's cards, which have never shown one. */
export const fmtMoneyValue = (amount: number, money?: MoneyOpts | null): string => {
  if (!money) return fmtBB(amount, 1);
  if (money.mode === "bb") {
    return money.bbSize > 0 ? fmtBB(amount / money.bbSize, 1) : fmtChipAmount(amount);
  }
  return fmtChipAmount(amount);
};

/** Render an amount of display money ("2.75" / "5.5 bb"). */
export const fmtMoney = (amount: number, money?: MoneyOpts | null): string => {
  const value = fmtMoneyValue(amount, money);
  return !money || money.mode === "bb" ? `${value} bb` : value;
};

/** "Pot 12.5 bb" - matches the hand replayer's pot label. */
export const solverPotLabel = (pot: number, money?: MoneyOpts | null): string =>
  `Pot ${fmtMoney(Math.max(0, pot), money)}`;

/**
 * Board card width for a table of `tableWidth` px. The felt is ~82% of the
 * table box, so five cards plus gaps stay comfortably inside it on a small
 * phone while still reading clearly on the desktop study layout.
 */
export const boardCardWidth = (tableWidth: number): number =>
  Math.max(20, Math.min(36, Math.round(tableWidth * 0.082)));
