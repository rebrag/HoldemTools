// src/bankroll/SessionTable.tsx
import React, { useMemo } from "react";
import { formatHours, formatMoney } from "./utils";
import type { BankrollSession } from "./types";

export type SessionTableTheme = "light" | "dark";

interface Props {
  sessions: BankrollSession[];
  onEdit: (session: BankrollSession) => void;
  onDelete: (id: string) => void;
  theme?: SessionTableTheme;
}

const THEMES = {
  light: {
    tbody: "divide-y divide-gray-100 bg-white",
    empty: "px-3 py-3 text-center text-sm text-gray-500",
    row: "transition-colors hover:bg-emerald-50/60 cursor-pointer group",
    cell: "text-gray-800",
    cellMuted: "text-gray-700",
    actionsCell: "text-gray-500",
    profitPos: "text-emerald-600",
    profitNeg: "text-rose-600",
    profitZero: "text-slate-700",
    editChip:
      "inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/70 bg-white group-hover:bg-emerald-100 text-emerald-600 transition",
    deleteBtn:
      "inline-flex h-6 w-6 items-center justify-center rounded-full border border-rose-300/70 bg-white hover:bg-rose-50 text-rose-600 transition relative z-10",
  },
  dark: {
    tbody: "divide-y divide-white/5",
    empty: "px-3 py-3 text-center text-sm text-emerald-100/70",
    row: "transition-colors hover:bg-white/5 cursor-pointer group",
    cell: "text-emerald-50/95",
    cellMuted: "text-emerald-100/75",
    actionsCell: "text-emerald-100/60",
    profitPos: "text-emerald-300",
    profitNeg: "text-rose-300",
    profitZero: "text-emerald-50/80",
    editChip:
      "inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/30 bg-white/5 group-hover:bg-emerald-400/20 text-emerald-300 transition",
    deleteBtn:
      "inline-flex h-6 w-6 items-center justify-center rounded-full border border-rose-300/30 bg-white/5 hover:bg-rose-400/20 text-rose-300 transition relative z-10",
  },
} as const;

// Memoized (see export): the parent re-renders on every modal keystroke and
// on a 1s ticker while a draft session is running, and this table should only
// re-render when the session list itself (or its callbacks) change.
const SessionTable: React.FC<Props> = ({
  sessions,
  onEdit,
  onDelete,
  theme = "light",
}) => {
  const t = THEMES[theme];

  // Sorting copies the array and parses two dates per comparison — worth
  // caching across unrelated re-renders.
  const ordered = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        const aTime = a.start ? new Date(a.start).getTime() : 0;
        const bTime = b.start ? new Date(b.start).getTime() : 0;
        return bTime - aTime;
      }),
    [sessions]
  );

  if (!sessions.length) {
    return (
      <tbody className={t.tbody}>
        <tr>
          <td colSpan={8} className={t.empty}>
            No sessions yet. Add one above to get started.
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody className={t.tbody}>
      {ordered.map((s) => {
        const startDate = s.start ? new Date(s.start) : null;
        const dateStr = startDate ? startDate.toLocaleDateString() : "—";
        const profit = s.profit ?? 0;
        const hoursStr = formatHours(s.hours);
        const profitStr = formatMoney(s.profit);

        const buyInStr =
          s.buyIn != null
            ? Math.round(s.buyIn).toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })
            : "—";
        const cashOutStr =
          s.cashOut != null
            ? Math.round(s.cashOut).toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })
            : "—";

        const profitColor =
          profit > 0 ? t.profitPos : profit < 0 ? t.profitNeg : t.profitZero;

        return (
          <tr key={s.id} onClick={() => onEdit(s)} className={t.row}>
            <td className={`px-2 py-1.5 text-[8px] sm:text-xs ${t.cell}`}>
              <span className="block truncate max-w-[80px]">
                {dateStr}
              </span>
            </td>

            <td className={`px-2 py-1.5 text-[11px] sm:text-xs ${t.cellMuted}`}>
              <span className="block truncate max-w-[110px]">
                {s.location ?? "—"}
              </span>
            </td>

            <td className={`px-2 py-1.5 text-[11px] sm:text-xs ${t.cellMuted}`}>
              <span className="block truncate max-w-[90px]">
                {s.blinds ?? "—"}
              </span>
            </td>

            <td className={`px-2 py-1.5 text-[11px] sm:text-xs text-center ${t.cellMuted}`}>
              {hoursStr}
            </td>

            <td className={`px-2 py-1.5 text-[9px] sm:text-xs ${t.cellMuted}`}>
              <span className="block truncate max-w-[80px]">
                {s.buyIn != null ? `$${buyInStr}` : "—"}
              </span>
            </td>

            <td className={`px-2 py-1.5 text-[9px] sm:text-xs ${t.cellMuted}`}>
              <span className="block truncate max-w-[80px]">
                {s.cashOut != null ? `$${cashOutStr}` : "—"}
              </span>
            </td>

            <td
              className={`px-2 py-1.5 text-[10px] sm:text-xs font-semibold ${profitColor}`}
            >
              <span className="block truncate max-w-[90px]">
                ${profitStr}
              </span>
            </td>

            <td className={`px-2 py-1.5 text-[11px] sm:text-xs ${t.actionsCell}`}>
              <div className="flex items-center gap-1 justify-end">
                {/* Visual indicator for Edit - button behavior now handled by row */}
                <div className={t.editChip} title="Edit session">
                  <svg
                    viewBox="0 0 20 20"
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 13.5V17h3.5L15 8.5l-3.5-3.5L3 13.5zM17.2 6.3c.4-.4.4-1 0-1.4L15.1 2.8c-.4-.4-1-.4-1.4 0L12 4.5l3.5 3.5 1.7-1.7z"
                      fill="currentColor"
                    />
                  </svg>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation(); // Prevents onEdit from firing
                    onDelete(s.id);
                  }}
                  className={t.deleteBtn}
                  title="Delete session"
                >
                  <svg
                    viewBox="0 0 20 20"
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  >
                    <path
                      d="M7 2h6l.75 1H17v2h-1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5H3V3h3.25L7 2zm1 5v7h2V7H8zm4 0v7h2V7h-2z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </div>
            </td>
          </tr>
        );
      })}
    </tbody>
  );
};

export default React.memo(SessionTable);
