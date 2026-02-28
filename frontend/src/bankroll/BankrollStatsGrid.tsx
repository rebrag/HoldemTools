// src/bankroll/BankrollStatsGrid.tsx
import React from "react";
import AutoFitText from "../components/AutoFitText";
import { SlidingNumber } from "../components/ui/shadcn-io/sliding-number";
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
          className={`mt-1.5 sm:mt-2 ${
            profitPositive ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          <span className="sm:text-xl md:text-2xl font-semibold tabular-nums inline-flex items-baseline whitespace-nowrap">
            <span className="mr-0.5">
              {profitPositive ? "+$" : "-$"}
            </span>
            <SlidingNumber
              number={Math.abs(totalProfit)}
              decimalPlaces={0}      // no decimals
              inView={true}          // always animate in this context
            />
          </span>
        </div>
      </div>

      {/* hours played (no animation) */}
      <div className="rounded-xl bg-white/10 border border-emerald-400/30 px-3 py-2 backdrop-blur-sm">
        <div className="text-[10px] sm:text-[11px] uppercase tracking-wide text-emerald-100/80">
          <AutoFitText>Hours played</AutoFitText>
        </div>
        <div className="mt-1 font-semibold text-emerald-50 text-xs sm:text-sm md:text-base">
          <AutoFitText>{humanHoursLabel}</AutoFitText>
        </div>
      </div>

      {/* sessions (no animation) */}
      <div className="rounded-xl bg-white/10 border border-emerald-400/30 px-3 py-2 backdrop-blur-sm">
        <div className="text-[10px] sm:text-[11px] uppercase tracking-wide text-emerald-100/80">
          Sessions
        </div>
        <div className="mt-1 text-base sm:text-lg font-semibold text-emerald-50 tabular-nums">
          {numSessions}
        </div>
      </div>

      {/* winrate */}
      <div className="rounded-xl bg-white/10 border border-emerald-400/30 px-3 py-2 backdrop-blur-sm">
        <div className="text-[10px] sm:text-[11px] uppercase tracking-wide text-emerald-100/80">
          <AutoFitText>Winrate ($ / hr)</AutoFitText>
        </div>
        <div
          className={`mt-1 ${
            hourlyPositive ? "text-emerald-200" : "text-rose-200"
          }`}
        >
          <span className="text-sm sm:text-base md:text-lg font-medium tabular-nums inline-flex items-baseline whitespace-nowrap">
            <span className="mr-0.5">
              {hourlyPositive ? "+$" : "-$"}
            </span>
            <SlidingNumber
              number={Math.abs(hourly)}
              decimalPlaces={2}
              inView={true}
            />
          </span>
        </div>
      </div>
    </div>
  );
};

export default BankrollStatsGrid;
