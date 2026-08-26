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
  /** Units of the bet labels per big blind; see getColorForAction. */
  sizeRef?: number;
  loading?: boolean;
  onActionClick?: (action: string) => void;
  /** Shorter panels (mobile dock): the % drops a size and the combo line
   *  shares a row with it, so the strip fits a tight height budget. */
  compact?: boolean;
  /** Stack the panels top-to-bottom in a narrow column (the mobile matrix's
   *  sidebar) instead of side by side. The panels split the parent's height
   *  equally, so give the wrapper a definite height. */
  vertical?: boolean;
  /** Display label of the action actually taken in the hand behind this
   *  solve, when known - its panel gets a PLAYED badge. */
  playedAction?: string | null;
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
const PANEL_MIN_H_COMPACT = 48;

const ActionSummary: React.FC<ActionSummaryProps> = ({
  data,
  sizeRef = 1,
  loading,
  onActionClick = () => {},
  compact,
  vertical,
  playedAction,
}) => {
  const panelMinH = compact ? PANEL_MIN_H_COMPACT : PANEL_MIN_H;
  /* Vertical panels split the parent's height instead of carrying a floor. */
  const rootCls = vertical ? "flex h-full w-full flex-col" : "w-full";
  const rowCls = vertical
    ? "flex min-h-0 w-full flex-1 flex-col gap-1"
    : "flex gap-1 w-full";
  const panelSizing = vertical ? "min-h-0 flex-1" : "flex-1 min-w-0";
  const aggregates = useMemo(
    () => computeActionAggregates(data, sizeRef),
    [data, sizeRef]
  );

  /* Distribution bar: normalize the per-action shares so the slots sum to 100
   * even when weights drift slightly from 1 per hand. */
  const barSegments = useMemo(() => {
    const total = aggregates.reduce((s, a) => s + a.combos, 0);
    if (total <= 0) return buildSegmentSlots({}, sizeRef);
    const shares: Record<string, number> = {};
    for (const a of aggregates) shares[a.action] = a.combos / total;
    return buildSegmentSlots(shares, sizeRef);
    // sizeRef belongs here: it decides how a bet label is read, so switching
    // between money and big blinds re-colours the bar.
  }, [aggregates, sizeRef]);

  const isLoading = (loading ?? false) || aggregates.length === 0;

  if (isLoading) {
    /* same structure / heights as the loaded state, so no layout shift */
    return (
      <div className={rootCls}>
        <div className={rowCls}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={`${panelSizing} rounded-md bg-slate-200/70 shadow-sm animate-pulse`}
              style={vertical ? undefined : { minHeight: panelMinH }}
            />
          ))}
        </div>
        <div className="mt-1 h-1.5 w-full flex-shrink-0 rounded-full bg-slate-200/50 animate-pulse" />
      </div>
    );
  }

  return (
    <div className={rootCls}>
      <div className={rowCls}>
        {aggregates.map((agg) => {
          const hover = shadeColor(agg.color, -18);
          return (
            <motion.button
              key={agg.action}
              type="button"
              onClick={() => onActionClick(agg.action)}
              title={`Click to see reactions to ${agg.action}`}
              className={`${panelSizing} rounded-md shadow-md px-1.5 py-1.5 text-left flex flex-col justify-between cursor-pointer`}
              style={{
                backgroundColor: agg.color,
                ...(vertical ? {} : { minHeight: panelMinH }),
              }}
              whileTap={{ scale: 0.95 }}
              whileHover={{ backgroundColor: hover }}
              transition={{ type: "spring", stiffness: 900, damping: 50 }}
            >
              <span className="flex items-center justify-between gap-1">
                <span className="block truncate text-[11px] font-semibold text-white/90 leading-tight">
                  {agg.action}
                </span>
                {playedAction === agg.action && (
                  <span
                    className="rounded-sm bg-black/30 px-1 text-[0.5rem] font-semibold uppercase leading-tight tracking-wide text-amber-200"
                    title="What you did in this hand"
                  >
                    Played
                  </span>
                )}
              </span>
              {compact ? (
                <span className="flex items-baseline justify-between gap-1">
                  <span className="block text-sm font-bold tabular-nums text-white leading-tight">
                    {agg.pctOfRange.toFixed(1)}%
                  </span>
                  <span className="block truncate text-[9px] tabular-nums text-white/75 leading-tight">
                    {agg.combos.toFixed(1)}c
                  </span>
                </span>
              ) : (
                <>
                  <span className="block text-lg font-bold tabular-nums text-white leading-tight">
                    {agg.pctOfRange.toFixed(1)}%
                  </span>
                  <span className="block truncate text-[10px] tabular-nums text-white/75 leading-tight">
                    {agg.combos.toFixed(2)} combos
                  </span>
                </>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Thin animated distribution bar (stable always-mounted slots). */}
      <div className="mt-1 flex h-1.5 w-full flex-shrink-0 overflow-hidden rounded-full bg-slate-900/30">
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
