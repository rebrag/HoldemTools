// src/bankroll/BankrollStatsGrid.tsx
import React from "react";
import AutoFitText from "../components/AutoFitText";
import AnimatedNumber from "./AnimatedNumber";
import type { BankrollStats } from "./types";

interface Props {
  stats: BankrollStats;
  displayStats: BankrollStats;
  isHoveringChart: boolean;
}

const BankrollStatsGrid: React.FC<Props> = ({
  stats,
  displayStats,
  isHoveringChart,
}) => {
  // When hovering the chart, use the "snapshot" stats; otherwise use overall stats
  const active = isHoveringChart ? displayStats : stats;

  const totalProfit = active.totalProfit ?? 0;
  const totalHours = active.totalHours ?? 0;
  const numSessions = active.numSessions ?? 0;
  const hourly = active.hourly ?? 0;

  const profitPositive = totalProfit >= 0;
  const hourlyPositive = hourly >= 0;

  const humanHoursLabel = (() => {
    if (!Number.isFinite(totalHours) || totalHours <= 0) {
      return "0 Hrs 0 Mins";
    }
    const totalMinutes = Math.round(totalHours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h} Hrs ${String(m).padStart(2, "0")} Mins`;
  })();

  return (
    <div className="w-full grid grid-cols-4 gap-3">
      {/* total profit */}
      <div className="rounded-xl bg-white/10 border border-emerald-400/40 px-3 py-2 sm:px-4 sm:py-3 backdrop-blur-sm shadow-sm shadow-emerald-500/20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-1 min-w-0">
          <div className="text-[10px] sm:text-[11px] uppercase tracking-wide text-emerald-100/90">
            <AutoFitText>Total profit</AutoFitText>
          </div>
        </div>

        <div
          className={`mt-1.5 sm:mt-2 text-base sm:text-md font-semibold ${
            profitPositive ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          {profitPositive ? "+" : "-"}$
          <AnimatedNumber
            value={Math.abs(totalProfit)}
            animate={true}
            durationMs={450}
            format={(v) =>
              Math.abs(v).toLocaleString(undefined, {
                maximumFractionDigits: 0,
                minimumFractionDigits: 0,
              })
            }
          />
        </div>
      </div>

      {/* hours played (no animation, new format) */}
      <div className="rounded-xl bg-white/10 border border-emerald-400/30 px-3 py-2 backdrop-blur-sm">
        <div className="text-[11px] uppercase tracking-wide text-emerald-100/80">
          <AutoFitText>Hours played</AutoFitText>
        </div>
        <div className="font-semibold text-emerald-50 text-[8px] sm:text-base md:text-lg lg:text-xl">
          {humanHoursLabel}
        </div>
      </div>

      {/* sessions (no animation) */}
      <div className="rounded-xl bg-white/10 border border-emerald-400/30 px-3 py-2 backdrop-blur-sm">
        <div className="text-[11px] uppercase tracking-wide text-emerald-100/80">
          Sessions
        </div>
        <div className="text-lg font-semibold text-emerald-50">
          {numSessions}
        </div>
      </div>

      {/* winrate */}
      <div className="rounded-xl bg-white/10 border border-emerald-400/30 px-3 py-2 backdrop-blur-sm">
        <div className="text-[11px] uppercase tracking-wide text-emerald-100/80">
          <AutoFitText>Winrate ($ / hr)</AutoFitText>
        </div>
        <div
          className={`text-lg font-semibold ${
            hourlyPositive ? "text-emerald-200" : "text-rose-200"
          }`}
        >
          {hourlyPositive ? "+" : "-"}$
          <AnimatedNumber
            value={Math.abs(hourly)}
            animate={true}
            durationMs={450}
            format={(v) => Math.abs(v).toFixed(2)}
          />
        </div>
      </div>
    </div>
  );
};

export default BankrollStatsGrid;
