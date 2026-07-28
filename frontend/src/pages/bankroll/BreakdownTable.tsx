// src/bankroll/BreakdownTable.tsx
import React, { useMemo } from "react";
import { formatHours, formatMoney } from "./utils";
import type { BankrollSession } from "./types";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export type BreakdownTableMode = "weekday" | "month" | "year";

type BreakdownRow = {
  label: string;
  totalProfit: number;
  totalHours: number;
  numSessions: number;
  hourly: number;
  sortValue: number;
};

function buildBreakdownRows(
  sessions: BankrollSession[],
  mode: BreakdownTableMode
): BreakdownRow[] {
  const groups: Record<string, BreakdownRow> = {};

  for (const s of sessions) {
    if (!s.start) continue;

    const startDate = new Date(s.start);
    if (Number.isNaN(startDate.getTime())) continue;

    const profit = s.profit ?? 0;
    const hours = s.hours ?? 0;

    let key: string;
    let label: string;
    let sortValue: number;

    if (mode === "weekday") {
      const day = startDate.getDay(); // 0 = Sun
      key = `wd-${day}`;
      label = WEEKDAY_LABELS[day];
      sortValue = day;
    } else if (mode === "month") {
      const year = startDate.getFullYear();
      const month = startDate.getMonth(); // 0-based
      key = `m-${year}-${month}`;
      label = `${MONTH_LABELS[month]} ${year}`;
      sortValue = year * 12 + month; // bigger = more recent
    } else {
      const year = startDate.getFullYear();
      key = `y-${year}`;
      label = `${year}`;
      sortValue = year; // bigger = more recent
    }

    const existing = groups[key];
    if (!existing) {
      groups[key] = {
        label,
        totalProfit: profit,
        totalHours: hours,
        numSessions: 1,
        hourly: 0,
        sortValue,
      };
    } else {
      existing.totalProfit += profit;
      existing.totalHours += hours;
      existing.numSessions += 1;
    }
  }

  const rows = Object.values(groups);

  for (const row of rows) {
    row.hourly =
      row.totalHours > 0 ? row.totalProfit / row.totalHours : 0;
  }

  rows.sort((a, b) => {
    if (mode === "weekday") {
      // Sun → Sat
      return a.sortValue - b.sortValue;
    }
    // Month / Year: newest first
    return b.sortValue - a.sortValue;
  });

  return rows;
}

export type TableTheme = "light" | "dark";

const THEMES = {
  light: {
    empty: "px-3 py-3 text-center text-sm text-gray-500 bg-white",
    table: "w-full table-fixed divide-y divide-gray-200 text-left",
    thead: "bg-gray-50",
    th: "px-2 py-2 text-[11px] font-semibold text-gray-700",
    tbody: "divide-y divide-gray-100 bg-white",
    rowHover: "transition-colors hover:bg-emerald-50/60",
    cell: "text-gray-800",
    cellMuted: "text-gray-700",
    profitPos: "text-emerald-600",
    profitNeg: "text-rose-600",
    profitZero: "text-slate-700",
  },
  dark: {
    empty: "px-3 py-3 text-center text-sm text-emerald-100/70",
    table: "w-full table-fixed divide-y divide-white/10 text-left",
    thead: "bg-white/5",
    th: "px-2 py-2 text-[11px] font-semibold text-emerald-100/80",
    tbody: "divide-y divide-white/5",
    rowHover: "transition-colors hover:bg-white/5",
    cell: "text-emerald-50/95",
    cellMuted: "text-emerald-100/75",
    profitPos: "text-emerald-300",
    profitNeg: "text-rose-300",
    profitZero: "text-emerald-50/80",
  },
} as const;

// Memoized (see usage) so modal keystrokes / the draft ticker in the parent
// don't re-aggregate every session on each render.
const BreakdownTable: React.FC<{
  sessions: BankrollSession[];
  mode: BreakdownTableMode;
  theme?: TableTheme;
}> = React.memo(({ sessions, mode, theme = "light" }) => {
  const rows = useMemo(() => buildBreakdownRows(sessions, mode), [sessions, mode]);
  const t = THEMES[theme];

  if (!sessions.length) {
    return (
      <div className={t.empty}>
        No sessions match the current filters.
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className={t.empty}>
        Not enough data to compute this breakdown.
      </div>
    );
  }

  const heading =
    mode === "weekday"
      ? "Weekday"
      : mode === "month"
      ? "Month"
      : "Year";

  return (
    <table className={t.table}>
      <colgroup>
        <col className="w-[26%]" />{/* Period */}
        <col className="w-[14%]" />{/* Sessions */}
        <col className="w-[18%]" />{/* Hours */}
        <col className="w-[21%]" />{/* Net */}
        <col className="w-[21%]" />{/* Hourly */}
      </colgroup>
      <thead className={t.thead}>
        <tr>
          <th className={`${t.th} text-left`}>{heading}</th>
          <th className={`${t.th} text-right`}>Sessions</th>
          <th className={`${t.th} text-right`}>Hours</th>
          <th className={`${t.th} text-right`}>Net</th>
          <th className={`${t.th} text-right`}>Hourly</th>
        </tr>
      </thead>
      <tbody className={t.tbody}>
        {rows.map((row) => {
          const profitColor =
            row.totalProfit > 0
              ? t.profitPos
              : row.totalProfit < 0
              ? t.profitNeg
              : t.profitZero;

          return (
            <tr key={row.label} className={t.rowHover}>
              <td className={`px-2 py-1.5 text-[11px] sm:text-xs ${t.cell}`}>
                {row.label}
              </td>
              <td className={`px-2 py-1.5 text-[11px] sm:text-xs text-right ${t.cellMuted}`}>
                {row.numSessions}
              </td>
              <td className={`px-2 py-1.5 text-[11px] sm:text-xs text-right ${t.cellMuted}`}>
                {formatHours(row.totalHours)}
              </td>
              <td
                className={`px-2 py-1.5 text-[11px] sm:text-xs text-right font-semibold ${profitColor}`}
              >
                ${formatMoney(row.totalProfit)}
              </td>
              <td className={`px-2 py-1.5 text-[11px] sm:text-xs text-right ${t.cellMuted}`}>
                ${formatMoney(row.hourly)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});

export default BreakdownTable;
