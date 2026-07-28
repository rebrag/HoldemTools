// src/bankroll/SessionHistoryTable.tsx
// Full session-history table (colgroup + header + rows). Shared between the
// mobile layout and the desktop layout variants; `theme` only swaps colors.
import React from "react";
import SessionTable, { type SessionTableTheme } from "./SessionTable";
import type { BankrollSession } from "./types";

interface Props {
  sessions: BankrollSession[];
  onEdit: (session: BankrollSession) => void;
  onDelete: (id: string) => void;
  theme?: SessionTableTheme;
}

const THEMES = {
  light: {
    table: "w-full table-fixed divide-y divide-gray-200 text-left",
    thead: "bg-gray-50",
    th: "font-semibold text-gray-700 text-center",
  },
  dark: {
    table: "w-full table-fixed divide-y divide-white/10 text-left",
    thead: "bg-white/5",
    th: "font-semibold text-emerald-100/80 text-center",
  },
} as const;

const SessionHistoryTable: React.FC<Props> = ({
  sessions,
  onEdit,
  onDelete,
  theme = "light",
}) => {
  const t = THEMES[theme];

  return (
    <table className={t.table}>
      <colgroup>
        <col className="w-[12%]" />{/* Date */}
        <col className="w-[18%]" />{/* Location */}
        <col className="w-[14%]" />{/* Blinds */}
        <col className="w-[8%]" />{/* Hours */}
        <col className="w-[12%]" />{/* Buy-in */}
        <col className="w-[12%]" />{/* Cash-out */}
        <col className="w-[14%]" />{/* Profit */}
        <col className="w-[10%]" />{/* Actions */}
      </colgroup>
      <thead className={t.thead}>
        <tr>
          <th className={`px-2 py-2 text-[11px] ${t.th}`}>Date</th>
          <th className={`px-2 py-2 text-[11px] ${t.th}`}>Location</th>
          <th className={`px-2 py-2 text-[11px] ${t.th}`}>Blinds</th>
          <th className={`px-1 py-2 text-[11px] ${t.th}`}>Hours</th>
          <th className={`px-2 py-2 text-[10px] ${t.th}`}>Buyin</th>
          <th className={`px-2 py-2 text-[10px] ${t.th}`}>Cashout</th>
          <th className={`px-2 py-2 text-[11px] ${t.th}`}>Profit</th>
          <th className={`px-2 py-2 text-[11px] ${t.th}`}>{/* Actions */}</th>
        </tr>
      </thead>
      <SessionTable
        sessions={sessions}
        onEdit={onEdit}
        onDelete={onDelete}
        theme={theme}
      />
    </table>
  );
};

export default SessionHistoryTable;
