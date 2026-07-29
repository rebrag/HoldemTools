// Chips/bb display toggle for the postflop viewer. Only rendered for
// hand-history solves (sims have no chip scale), styled after the hand
// recorder's "Show in BB" pill.
import type { MoneyDisplay } from "./boardDisplay";

const MoneyToggle = ({ money, className }: { money?: MoneyDisplay; className?: string }) => {
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
