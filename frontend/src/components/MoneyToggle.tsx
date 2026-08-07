// src/components/MoneyToggle.tsx
// Chips/bb display toggle, styled after the hand recorder's "Show in BB" pill.
// Lives in components because PokerTable can render it in its own corner (see
// PokerTable's `moneyToggle` prop) wherever a money-denominated table appears.
// Only rendered for money-denominated data (sims have no chip scale).

/** The slice of a money display the toggle needs. Structurally compatible
 *  with the solver's MoneyDisplay (boardDisplay.ts). */
export interface MoneyToggleMoney {
  mode: "money" | "bb";
  bbSize: number;
  onToggle: () => void;
}

const MoneyToggle = ({
  money,
  className,
}: {
  money?: MoneyToggleMoney | null;
  className?: string;
}) => {
  // No toggle on a sim, and none when the solve carries no big blind to
  // convert to - there would be nothing to switch between.
  if (!money || !(money.bbSize > 0)) return null;
  return (
    <button
      type="button"
      onClick={money.onToggle}
      className={`rounded-full border border-white/20 bg-slate-900/70 px-2.5 py-0.5 text-[11px] font-medium text-gray-200 shadow-sm transition-colors hover:bg-slate-800 hover:text-white ${className ?? ""}`}
      title={
        money.mode === "money"
          ? "Showing the hand's real chip amounts - switch to big blinds"
          : "Showing big blinds - switch to the hand's real chip amounts"
      }
    >
      {money.mode === "money" ? "Show in BB" : "Show in chips"}
    </button>
  );
};

export default MoneyToggle;
