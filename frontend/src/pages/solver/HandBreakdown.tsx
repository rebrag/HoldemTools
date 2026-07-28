// Per-combo breakdown for one hand class (the cell the pointer is over in the
// matrix): each concrete combo renders as a tile whose background is the
// class's action mix (exact preflop - every combo of a class shares the class
// strategy) with per-action percentages listed on top, GTO Wizard style.
// Combos that collide with a board card render as dead tiles.
import React, { useMemo } from "react";
import { HandCellData, orderActionKeys } from "@/lib/solver/utils";
import {
  buildSegmentSlots,
  combosForHand,
  expandHandCombos,
  type SlotSegment,
} from "@/lib/solver/aggregates";
import useElementSize from "@/hooks/useElementSize";
import "./App.css";

interface HandBreakdownProps {
  data: HandCellData[];
  /** Hand class to expand, e.g. "K7s". Null until a cell has been hovered. */
  hand?: string | null;
  /** Board card codes (postflop); combos containing one are dead. */
  board?: string[];
  loading?: boolean;
  className?: string;
}

/* 4-color deck, matching PlayingCard's suit colors. */
const SUIT_GLYPHS: Record<string, { glyph: string; cls: string }> = {
  h: { glyph: "♥", cls: "text-red-600" },
  d: { glyph: "♦", cls: "text-blue-600" },
  c: { glyph: "♣", cls: "text-green-900" },
  s: { glyph: "♠", cls: "text-gray-900" },
};

/** Both cards of a combo in one light header chip, e.g. "K♠7♠". */
const ComboChip: React.FC<{ c1: string; c2: string; dim?: boolean }> = ({
  c1,
  c2,
  dim,
}) => (
  <span
    className={`inline-flex items-center rounded-[3px] bg-slate-100 px-1.5 py-0.5 text-[13px] font-bold leading-none text-gray-900 shadow-sm ring-1 ring-black/20 ${
      dim ? "opacity-60" : ""
    }`}
  >
    {[c1, c2].map((code) => {
      const suit = SUIT_GLYPHS[code[1]] ?? SUIT_GLYPHS.s;
      return (
        <span key={code} className="inline-flex items-center">
          {code[0]}
          <span className={suit.cls}>{suit.glyph}</span>
        </span>
      );
    })}
  </span>
);

/** "37.2" / "100" / "0" like the reference: one decimal, trimmed when whole. */
const fmtPct = (weight: number): string => {
  const p = weight * 100;
  return Math.abs(p % 1) < 0.05 ? p.toFixed(0) : p.toFixed(1);
};

interface ActionRow {
  action: string;
  pct: string;
}

const ComboTile: React.FC<{
  c1: string;
  c2: string;
  rows: ActionRow[];
  segments: SlotSegment[];
  blocked: boolean;
}> = React.memo(({ c1, c2, rows, segments, blocked }) => (
  <div className="relative flex h-full min-h-[82px] flex-col justify-between overflow-hidden rounded-[4px] bg-slate-900/60 ring-1 ring-black/30">
    {/* stacked action-mix background */}
    {!blocked && (
      <div className="absolute inset-0 flex" aria-hidden="true">
        {segments.map(({ slot, width, color }) => (
          <div
            key={slot}
            className="segment h-full"
            style={{ width: `${width}%`, backgroundColor: color }}
          />
        ))}
      </div>
    )}

    {/* header: combo chip + % column mark */}
    <div className="relative z-10 flex items-start justify-between px-1 pt-1">
      <ComboChip c1={c1} c2={c2} dim={blocked} />
      {!blocked && (
        <span className="text-[9px] font-semibold text-slate-900/70">%</span>
      )}
    </div>

    {/* per-action rows over the colored background */}
    {!blocked && (
      <div className="relative z-10 px-1 pb-1 pt-0.5">
        {rows.map(({ action, pct }) => (
          <div
            key={action}
            className="flex items-baseline justify-between gap-1 leading-tight"
          >
            <span className="truncate text-[10px] font-medium text-slate-900/90">
              {action}
            </span>
            <span className="text-[10px] font-semibold tabular-nums text-slate-900/90">
              {pct}
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
));
ComboTile.displayName = "ComboTile";

const TILE_MIN_W = 150; // px per grid column before adding another

const HandBreakdown: React.FC<HandBreakdownProps> = ({
  data,
  hand,
  board,
  loading,
  className,
}) => {
  const { ref, width } = useElementSize<HTMLDivElement>({ hysteresis: 6 });

  const cell = useMemo(
    () => (hand ? data.find((c) => c.hand === hand) : undefined),
    [data, hand]
  );
  const hasData =
    !!cell &&
    Object.keys(cell.actions).filter((a) => a !== "Position").length > 0;

  /* One segment array + row list per class, shared by all of its tiles.
   * Rows list every action of the class (zero-weight included, like the
   * reference) in the same canonical order the segments use. */
  const { rows, segments } = useMemo(() => {
    if (!hasData) return { rows: [] as ActionRow[], segments: [] as SlotSegment[] };
    const ordered = orderActionKeys(
      Object.keys(cell!.actions).filter((a) => a !== "Position")
    );
    return {
      rows: ordered.map((action) => ({
        action,
        pct: fmtPct(cell!.actions[action] || 0),
      })),
      segments: buildSegmentSlots(cell!.actions),
    };
  }, [cell, hasData]);

  const boardSet = useMemo(() => new Set(board ?? []), [board]);

  const combos = useMemo(() => {
    if (!hand || !hasData) return [];
    return expandHandCombos(hand).map(([c1, c2]) => ({
      key: `${c1}${c2}`,
      c1,
      c2,
      blocked: boardSet.has(c1) || boardSet.has(c2),
    }));
  }, [hand, hasData, boardSet]);

  const isLoading = (loading ?? false) || data.length === 0;

  /* Suited classes read best 2-up (like the reference); pairs and offsuit go
   * wider, clamped by what the measured panel width can fit. Until the
   * ResizeObserver delivers a width, trust the ideal count. */
  const idealCols = hand ? (hand[2] === "s" ? 2 : 3) : 3;
  const maxCols = width ? Math.max(1, Math.floor(width / TILE_MIN_W)) : idealCols;
  const cols = Math.min(idealCols, maxCols);

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded-md border border-white/15 bg-slate-950/35 ${
        className ?? ""
      }`}
    >
      <div className="flex flex-shrink-0 items-center justify-between border-b border-white/10 px-2 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300">
          Hands
        </span>
        {!isLoading && hand && hasData && (
          <span className="text-[10px] tabular-nums text-slate-400">
            {hand} · {combosForHand(hand)} combos
          </span>
        )}
      </div>

      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin] p-1.5">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="min-h-[82px] rounded-[4px] bg-slate-200/20 animate-pulse"
              />
            ))}
          </div>
        ) : !hand ? (
          <div className="flex h-full items-center justify-center py-6 text-center text-xs text-slate-400">
            Hover a hand in the matrix to see its combos
          </div>
        ) : !hasData ? (
          <div className="flex h-full items-center justify-center py-6 text-xs text-slate-400">
            No data for {hand} at this node
          </div>
        ) : (
          <div
            className="grid h-full gap-1"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              // Fill the panel height (tiles stretch like the reference);
              // overflow past the minimum row height scrolls instead.
              gridAutoRows: "minmax(82px, 1fr)",
            }}
          >
            {combos.map(({ key, c1, c2, blocked }) => (
              <ComboTile
                key={key}
                c1={c1}
                c2={c2}
                rows={rows}
                segments={segments}
                blocked={blocked}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HandBreakdown;
