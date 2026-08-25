// src/pages/private/BreakdownTable.tsx
// Per-player points table (Top / Middle / Bottom / Scoop / Total), in the
// same shape as the client's real scoresheet. Shared by the score checker
// and the advanced dealer.
import React from "react";
import type { DealBreakdown } from "@/lib/taiwanese";

const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));
const cell = (n: number) =>
  n > 0 ? "text-emerald-300" : n < 0 ? "text-red-400" : "text-emerald-100/60";

const BreakdownTable: React.FC<{ breakdown: DealBreakdown[]; labels?: string[] }> = ({
  breakdown,
  labels,
}) => (
  <div className="overflow-x-auto">
    <table className="w-full max-w-md text-sm border-collapse">
      <thead>
        <tr className="text-emerald-100/50">
          <th className="text-left font-medium py-1.5 pr-4">Player</th>
          <th className="text-right font-medium py-1.5 px-2">Top</th>
          <th className="text-right font-medium py-1.5 px-2">Middle</th>
          <th className="text-right font-medium py-1.5 px-2">Bottom</th>
          <th className="text-right font-medium py-1.5 px-2">Scoop</th>
          <th className="text-right font-medium py-1.5 pl-2">Total</th>
        </tr>
      </thead>
      <tbody>
        {breakdown.map((d, g) => (
          <tr key={g} className="border-t border-white/10">
            <td className="py-1.5 pr-4 text-emerald-100/90">{labels?.[g] ?? `Player ${g + 1}`}</td>
            <td className={`py-1.5 px-2 text-right font-mono tabular-nums ${cell(d.top)}`}>{fmt(d.top)}</td>
            <td className={`py-1.5 px-2 text-right font-mono tabular-nums ${cell(d.middle)}`}>{fmt(d.middle)}</td>
            <td className={`py-1.5 px-2 text-right font-mono tabular-nums ${cell(d.bottom)}`}>{fmt(d.bottom)}</td>
            <td className={`py-1.5 px-2 text-right font-mono tabular-nums ${cell(d.scoop)}`}>
              {d.scoop === 0 ? "-" : fmt(d.scoop)}
            </td>
            <td className={`py-1.5 pl-2 text-right font-mono tabular-nums font-semibold ${cell(d.total)}`}>
              {fmt(d.total)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default BreakdownTable;
