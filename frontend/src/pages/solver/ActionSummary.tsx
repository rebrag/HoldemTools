// Per-action summary panels for the desktop study view: one colored panel per
// action (frequency % of range + weighted combo count) over a thin animated
// distribution bar. Clicking a panel navigates the tree, like ColorKey.
import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { HandCellData } from "@/lib/solver/utils";
import {
  buildSegmentSlots,
  computeActionAggregates,
} from "@/lib/solver/aggregates";
import "./App.css";

interface ActionSummaryProps {
  data: HandCellData[];
  loading?: boolean;
  onActionClick?: (action: string) => void;
}

const shadeColor = (hex: string, percent: number) => {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const r = Math.min(255, Math.max(0, (num >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
};

const PANEL_MIN_H = 72; // px, matches the skeleton so loading never shifts layout

const ActionSummary: React.FC<ActionSummaryProps> = ({
  data,
  loading,
  onActionClick = () => {},
}) => {
  const aggregates = useMemo(() => computeActionAggregates(data), [data]);

  /* Distribution bar: normalize the per-action shares so the slots sum to 100
   * even when weights drift slightly from 1 per hand. */
  const barSegments = useMemo(() => {
    const total = aggregates.reduce((s, a) => s + a.combos, 0);
    if (total <= 0) return buildSegmentSlots({});
    const shares: Record<string, number> = {};
    for (const a of aggregates) shares[a.action] = a.combos / total;
    return buildSegmentSlots(shares);
  }, [aggregates]);

  const isLoading = (loading ?? false) || aggregates.length === 0;

  if (isLoading) {
    /* same structure / heights as the loaded state, so no layout shift */
    return (
      <div className="w-full">
        <div className="flex gap-1 w-full">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 min-w-0 rounded-md bg-slate-200/70 shadow-sm animate-pulse"
              style={{ minHeight: PANEL_MIN_H }}
            />
          ))}
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200/50 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex gap-1 w-full">
        {aggregates.map((agg) => {
          const hover = shadeColor(agg.color, -18);
          return (
            <motion.button
              key={agg.action}
              type="button"
              onClick={() => onActionClick(agg.action)}
              title={`Click to see reactions to ${agg.action}`}
              className="flex-1 min-w-0 rounded-md shadow-md px-1.5 py-1.5 text-left flex flex-col justify-between cursor-pointer"
              style={{ backgroundColor: agg.color, minHeight: PANEL_MIN_H }}
              whileTap={{ scale: 0.95 }}
              whileHover={{ backgroundColor: hover }}
              transition={{ type: "spring", stiffness: 900, damping: 50 }}
            >
              <span className="block truncate text-[11px] font-semibold text-white/90 leading-tight">
                {agg.action}
              </span>
              <span className="block text-lg font-bold tabular-nums text-white leading-tight">
                {agg.pctOfRange.toFixed(1)}%
              </span>
              <span className="block truncate text-[10px] tabular-nums text-white/75 leading-tight">
                {agg.combos.toFixed(2)} combos
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Thin animated distribution bar (stable always-mounted slots). */}
      <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-900/30">
        {barSegments.map(({ slot, width, color }) => (
          <div
            key={slot}
            className="segment h-full"
            style={{ width: `${width}%`, backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
};

export default ActionSummary;
