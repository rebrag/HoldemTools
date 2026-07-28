// Per-combo breakdown for one hand class (the cell the pointer is over in the
// matrix): each concrete combo renders as a tile whose background is that
// combo's own action mix, with its percentages listed on top, GTO Wizard style.
// Combos that collide with a board card render as dead tiles.
//
// Postflop, combos of one class genuinely play differently - blockers make Ah5h
// a different hand from Ac5c - so `comboDetail` supplies each combo's real mix.
// Preflop (and on pre-schema-4 solves) there is no per-combo data and every
// combo of a class shares the class strategy, which is exact preflop.
import React, { useMemo } from "react";
import { HandCellData, orderActionKeys } from "@/lib/solver/utils";
import {
  buildSegmentSlots,
  combosForHand,
  expandHandCombos,
  type SlotSegment,
} from "@/lib/solver/aggregates";
import { comboKey, type ComboDetail } from "@/lib/solver/comboDetail";
import useElementSize from "@/hooks/useElementSize";
import "./App.css";

interface HandBreakdownProps {
  data: HandCellData[];
  /** Hand class to expand, e.g. "K7s". Null until a cell has been hovered. */
  hand?: string | null;
  /** Board card codes (postflop); combos containing one are dead. */
  board?: string[];
  /** Real per-combo mixes; falls back to the class average when absent. */
  comboDetail?: ComboDetail | null;
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

interface ComboTileData {
  key: string;
  c1: string;
  c2: string;
  blocked: boolean;
  rows: ActionRow[];
  segments: SlotSegment[];
  /** Reach weight 0..1; below 1 the combo is only partly in the range. */
  weight: number | null;
  /** Equity vs the opponent's range at this node, 0..1. */
  equity: number | null;
}

const ComboTile: React.FC<Omit<ComboTileData, "key">> = React.memo(
  ({ c1, c2, rows, segments, blocked, weight, equity }) => (
    <div
      data-testid="combo-tile"
      data-combo={`${c1}${c2}`}
      data-blocked={blocked ? "1" : "0"}
      className="relative flex h-full min-h-[82px] flex-col justify-between overflow-hidden rounded-[4px] bg-slate-900/60 ring-1 ring-black/30"
    >
      {/* stacked action-mix background */}
      {!blocked && (
        <div className="absolute inset-0 flex" aria-hidden="true">
          {segments.map(({ slot, width, color }) => (
            <div
              key={slot}
              data-testid="combo-segment"
              data-slot={slot}
              data-width={width.toFixed(3)}
              className="segment h-full"
              style={{ width: `${width}%`, backgroundColor: color }}
            />
          ))}
        </div>
      )}

      {/* header: combo chip (+ partial-weight badge) + % column mark */}
      <div className="relative z-10 flex items-start justify-between gap-1 px-1 pt-1">
        <div className="flex min-w-0 items-center gap-1">
          <ComboChip c1={c1} c2={c2} dim={blocked} />
          {!blocked && weight != null && weight < 0.995 && (
            <span
              className="rounded-[2px] bg-slate-900/45 px-1 text-[8px] font-semibold leading-[1.4] text-white/90"
              title={`Only ${fmtPct(weight)}% of this combo reaches here`}
            >
              {fmtPct(weight)}%
            </span>
          )}
        </div>
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
          {equity != null && (
            <div className="mt-0.5 flex items-baseline justify-between gap-1 border-t border-slate-900/20 pt-0.5 leading-tight">
              <span className="truncate text-[9px] font-medium uppercase tracking-wide text-slate-900/60">
                Equity
              </span>
              <span className="text-[9px] font-semibold tabular-nums text-slate-900/80">
                {fmtPct(equity)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
);
ComboTile.displayName = "ComboTile";

const TILE_MIN_W = 150; // px per grid column before adding another

const HandBreakdown: React.FC<HandBreakdownProps> = ({
  data,
  hand,
  board,
  comboDetail,
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

  /* Canonical action order for the class, shared by every tile so the rows and
   * the colored segments line up column-wise down the grid. Zero-weight actions
   * stay listed, like the reference. */
  const orderedActions = useMemo(
    () =>
      hasData
        ? orderActionKeys(
            Object.keys(cell!.actions).filter((a) => a !== "Position")
          )
        : [],
    [cell, hasData]
  );

  const boardSet = useMemo(() => new Set(board ?? []), [board]);

  const combos = useMemo<ComboTileData[]>(() => {
    if (!hand || !hasData) return [];

    // Class-average fallback, used preflop and for pre-schema-4 solves where
    // no per-combo data exists. Built once and shared by every tile.
    const classMix = cell!.actions;
    const classRows = orderedActions.map((action) => ({
      action,
      pct: fmtPct(classMix[action] || 0),
    }));
    const classSegments = buildSegmentSlots(classMix);

    return expandHandCombos(hand).map(([c1, c2]) => {
      const blocked = boardSet.has(c1) || boardSet.has(c2);
      const detail = blocked
        ? undefined
        : comboDetail?.byCombo.get(comboKey(c1, c2));

      if (!detail) {
        return {
          key: `${c1}${c2}`,
          c1,
          c2,
          blocked,
          rows: classRows,
          segments: classSegments,
          weight: null,
          equity: null,
        };
      }

      // This combo's own mix: the whole point of the panel.
      const mix: Record<string, number> = {};
      for (const action of orderedActions) {
        mix[action] = detail.actions[action]?.freq ?? 0;
      }
      return {
        key: `${c1}${c2}`,
        c1,
        c2,
        blocked,
        rows: orderedActions.map((action) => ({
          action,
          pct: fmtPct(mix[action]),
        })),
        segments: buildSegmentSlots(mix),
        weight: detail.weight,
        equity: detail.equity,
      };
    });
  }, [hand, hasData, boardSet, cell, orderedActions, comboDetail]);

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
            {combos.map(({ key, ...tile }) => (
              <ComboTile key={key} {...tile} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HandBreakdown;
