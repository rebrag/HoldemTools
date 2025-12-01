// src/bankroll/SessionTable.tsx
import React from "react";
import { formatHours, formatMoney } from "./utils";
import type { BankrollSession } from "./types";

interface Props {
  sessions: BankrollSession[];
  onEdit: (session: BankrollSession) => void;
  onDelete: (id: string) => void;
}

const SessionTable: React.FC<Props> = ({
  sessions,
  onEdit,
  onDelete,
}) => {
  if (!sessions.length) {
    return (
      <tbody className="divide-y divide-gray-100 bg-white">
        <tr>
          <td
            colSpan={8}
            className="px-3 py-3 text-center text-sm text-gray-500"
          >
            No sessions yet. Add one above to get started.
          </td>
        </tr>
      </tbody>
    );
  }

  const ordered = [...sessions].sort((a, b) => {
    const aTime = a.start ? new Date(a.start).getTime() : 0;
    const bTime = b.start ? new Date(b.start).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <tbody className="divide-y divide-gray-100 bg-white">
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
          profit > 0
            ? "text-emerald-600"
            : profit < 0
            ? "text-rose-600"
            : "text-slate-700";

        return (
          <tr
            key={s.id}
            className="transition-colors hover:bg-emerald-50/60"
          >
            {/* Date */}
            <td className="px-2 py-1.5 text-[8px] sm:text-xs text-gray-800">
              <span className="block truncate max-w-[80px]">
                {dateStr}
              </span>
            </td>

            {/* Location */}
            <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-700">
              <span className="block truncate max-w-[110px]">
                {s.location ?? "—"}
              </span>
            </td>

            {/* Blinds */}
            <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-700">
              <span className="block truncate max-w-[90px]">
                {s.blinds ?? "—"}
              </span>
            </td>

            {/* Hours (H:MM) */}
            <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-700 text-center">
              {hoursStr}
            </td>

            {/* Buy-in */}
            <td className="px-2 py-1.5 text-[9px] sm:text-xs text-gray-700">
              <span className="block truncate max-w-[80px]">
                {s.buyIn != null ? `$${buyInStr}` : "—"}
              </span>
            </td>

            {/* Cash-out */}
            <td className="px-2 py-1.5 text-[9px] sm:text-xs text-gray-700">
              <span className="block truncate max-w-[80px]">
                {s.cashOut != null ? `$${cashOutStr}` : "—"}
              </span>
            </td>

            {/* Profit */}
            <td
              className={`px-2 py-1.5 text-[11px] sm:text-xs font-semibold ${profitColor}`}
            >
              <span className="block truncate max-w-[90px]">
                ${profitStr}
              </span>
            </td>

            {/* Actions */}
            <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-500">
              <div className="flex items-center gap-1 justify-end">
                <button
                  type="button"
                  onClick={() => onEdit(s)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/70 bg-white hover:bg-emerald-50 text-emerald-600 transition"
                  title="Edit session"
                >
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
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(s.id)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-rose-300/70 bg-white hover:bg-rose-50 text-rose-600 transition"
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

export default SessionTable;
