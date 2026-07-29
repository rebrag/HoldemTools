// Per-combo breakdown for one hand class (the cell the pointer is over in the
// matrix): each concrete combo renders as a tile whose background is that
// combo's own action mix, with its percentages listed on top, GTO Wizard style.
// Combos that collide with a board card render as dead tiles.
//
// Postflop, combos of one class genuinely play differently - blockers make Ah5h
// a different hand from Ac5c - so `comboDetail` supplies each combo's real mix.
// Preflop (and on pre-schema-4 solves) there is no per-combo data and every
// combo of a class shares the class strategy, which is exact preflop.
//
// The panel follows the matrix's display mode: Strategy shows action
// frequencies over the mix-colored background, EV shows each action's EV over
// a heat-colored background, Equity shows the combo's equity likewise.
//
// The grid never scrolls: tiles split the panel height evenly, and their
// content steps down through density tiers as rows get short.
import React, { useMemo } from "react";
import { HandCellData, orderActionKeys } from "@/lib/solver/utils";
import {
  buildSegmentSlots,
  combosForHand,
  expandHandCombos,
  type SlotSegment,
} from "@/lib/solver/aggregates";
import { comboKey, type ComboDetail } from "@/lib/solver/comboDetail";
import {
  heatColor,
  normalizeToRange,
  type MatrixDisplayMode,
  type ValueRange,
} from "@/lib/solver/matrixDisplayMode";
import type { MoneyDisplay } from "./boardDisplay";
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
  /** Effective matrix display mode; the tiles mirror it. */
  displayMode?: MatrixDisplayMode;
  /** EV normalization the matrix used, so both share one heat scale. */
  evRange?: ValueRange | null;
  /** Whether combo EVs are chip-denominated (bb-convertible); ICM is not. */
  chipEv?: boolean;
  /** Chips/bb display toggle (hand-history solves only). */
  money?: Pick<MoneyDisplay, "mode" | "bbSize">;
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
const ComboChip: React.FC<{ c1: string; c2: string; dim?: boolean; small?: boolean }> = ({
  c1,
  c2,
  dim,
  small,
}) => (
  <span
    className={`inline-flex items-center rounded-[3px] bg-slate-100 font-bold leading-none text-gray-900 shadow-sm ring-1 ring-black/20 ${
      small ? "px-1 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-[13px]"
    } ${dim ? "opacity-60" : ""}`}
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

/**
 * Rescale an action mix so it sums to 1, which makes every tile's bar span its
 * full width instead of trailing off into background.
 *
 * A strategy is a distribution, so a shortfall is always an artifact rather
 * than information. The usual source is a class average taken over all of a
 * class's combos including ones the player cannot hold - a board-blocked combo
 * contributes a row of zeros, so 65s on a board with one of its cards averages
 * to 0.75 and the bar renders three-quarters wide. Normalising both the widths
 * and the printed percentages from the same numbers keeps them consistent.
 *
 * An all-zero mix (a hand not in the range at all) is left alone: there is no
 * strategy to show, and the tile should stay empty rather than invent one.
 */
const normalizeMix = (mix: Record<string, number>): Record<string, number> => {
  const total = Object.values(mix).reduce((sum, w) => sum + (w || 0), 0);
  if (total <= 0 || Math.abs(total - 1) < 1e-6) return mix;
  const scaled: Record<string, number> = {};
  for (const [action, weight] of Object.entries(mix)) {
    scaled[action] = (weight || 0) / total;
  }
  return scaled;
};

interface ActionRow {
  action: string;
  value: string;
}

type Density = "normal" | "compact" | "minimal";

interface ComboTileData {
  key: string;
  c1: string;
  c2: string;
  blocked: boolean;
  rows: ActionRow[];
  /** Strategy-mode stacked background; empty in EV/Equity mode. */
  segments: SlotSegment[];
  /** EV/Equity-mode heat background; null in strategy mode. */
  bg: string | null;
  /** Reach weight 0..1; below 1 the combo is only partly in the range. */
  weight: number | null;
}

const ComboTile: React.FC<
  Omit<ComboTileData, "key"> & { colMark: string; density: Density }
> = React.memo(({ c1, c2, rows, segments, bg, blocked, weight, colMark, density }) => (
  <div
    data-testid="combo-tile"
    data-combo={`${c1}${c2}`}
    data-blocked={blocked ? "1" : "0"}
    title={
      density === "minimal" && rows.length
        ? rows.map((r) => `${r.action} ${r.value}`).join(", ")
        : undefined
    }
    className="relative flex h-full min-h-0 flex-col justify-between overflow-hidden rounded-[4px] bg-slate-900/60 ring-1 ring-black/30"
  >
    {/* stacked action-mix background (strategy mode) */}
    {!blocked && segments.length > 0 && (
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

    {/* heat background (EV / Equity mode); alpha keeps white text readable */}
    {!blocked && bg && (
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{ backgroundColor: bg }}
      />
    )}

    {/* header: combo chip (+ partial-weight badge) + value column mark */}
    <div className="relative z-10 flex items-start justify-between gap-1 px-1 pt-1">
      <div className="flex min-w-0 items-center gap-1">
        <ComboChip c1={c1} c2={c2} dim={blocked} small={density !== "normal"} />
        {!blocked && density === "normal" && weight != null && weight < 0.995 && (
          <span
            className="rounded-[2px] bg-slate-900/45 px-1 text-[8px] font-semibold leading-[1.4] text-white/90"
            title={`Only ${fmtPct(weight)}% of this combo reaches here`}
          >
            {fmtPct(weight)}%
          </span>
        )}
      </div>
      {!blocked && density !== "minimal" && (
        <span className="text-[9px] font-semibold text-white/75">{colMark}</span>
      )}
    </div>

    {/* per-action rows over the colored background */}
    {!blocked && density !== "minimal" && (
      <div
        className={`relative z-10 px-1 ${
          density === "compact" ? "pb-0.5 pt-px" : "pb-1 pt-0.5"
        }`}
      >
        {rows.map(({ action, value }) => (
          <div
            key={action}
            className="flex items-baseline justify-between gap-1 leading-tight"
          >
            <span
              className={`truncate font-medium text-white ${
                density === "compact" ? "text-[9px] leading-[1.15]" : "text-[10px]"
              }`}
            >
              {action}
            </span>
            <span
              className={`font-semibold tabular-nums text-white ${
                density === "compact" ? "text-[9px] leading-[1.15]" : "text-[10px]"
              }`}
            >
              {value}
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
  comboDetail,
  displayMode = "strategy",
  evRange,
  chipEv,
  money,
  loading,
  className,
}) => {
  const { ref, width, height } = useElementSize<HTMLDivElement>({ hysteresis: 6 });

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

  /* Per-combo EVs arrive in chips (bb = chips/100 when the solve is
   * chip-denominated); class-level fallback EVs are already in bb / $. */
  const fmtComboEv = (evChips: number): string => {
    if (chipEv === false) return evChips.toFixed(2);
    const bb = evChips / 100;
    return money?.mode === "chips" ? (bb * money.bbSize).toFixed(2) : bb.toFixed(2);
  };

  const combos = useMemo<ComboTileData[]>(() => {
    if (!hand || !hasData) return [];

    const mode = displayMode;

    // Class-average fallback, used preflop and for pre-schema-4 solves where
    // no per-combo data exists. Built once and shared by every tile.
    const classMix = normalizeMix(cell!.actions);
    const classRows =
      mode === "ev"
        ? orderedActions.map((action) => {
            const ev = cell!.evs[action];
            return {
              action,
              value:
                typeof ev === "number" && Number.isFinite(ev)
                  ? ev.toFixed(2)
                  : "-",
            };
          })
        : orderedActions.map((action) => ({
            action,
            value: fmtPct(classMix[action] || 0),
          }));
    const classSegments = mode === "strategy" ? buildSegmentSlots(classMix) : [];
    const classBg =
      mode === "ev" && evRange
        ? (() => {
            // Same strategy-weighted class EV the matrix's solid cells use.
            let wSum = 0;
            let evSum = 0;
            for (const action of orderedActions) {
              const w = cell!.actions[action] || 0;
              const ev = cell!.evs[action];
              if (w <= 0 || typeof ev !== "number" || !Number.isFinite(ev))
                continue;
              wSum += w;
              evSum += w * ev;
            }
            return wSum > 0
              ? `${heatColor(normalizeToRange(evSum / wSum, evRange))}BF`
              : null;
          })()
        : null;

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
          rows: comboDetail && mode !== "strategy" ? [] : classRows,
          segments: comboDetail && mode !== "strategy" ? [] : classSegments,
          // Class heat only applies on the class-average fallback; with real
          // per-combo data a missing combo is simply not in the range.
          bg: comboDetail ? null : classBg,
          weight: null,
        };
      }

      if (mode === "equity") {
        return {
          key: `${c1}${c2}`,
          c1,
          c2,
          blocked,
          rows:
            detail.equity != null
              ? [{ action: "Equity", value: fmtPct(detail.equity) }]
              : [],
          segments: [],
          bg: detail.equity != null ? `${heatColor(detail.equity)}BF` : null,
          weight: detail.weight,
        };
      }

      if (mode === "ev") {
        return {
          key: `${c1}${c2}`,
          c1,
          c2,
          blocked,
          rows: orderedActions.map((action) => {
            const ev = detail.actions[action]?.ev;
            return { action, value: ev != null ? fmtComboEv(ev) : "-" };
          }),
          segments: [],
          bg:
            detail.ev != null && evRange
              ? `${heatColor(normalizeToRange(detail.ev, evRange))}BF`
              : null,
          weight: detail.weight,
        };
      }

      // Strategy mode: this combo's own mix - the whole point of the panel.
      const raw: Record<string, number> = {};
      for (const action of orderedActions) {
        raw[action] = detail.actions[action]?.freq ?? 0;
      }
      const mix = normalizeMix(raw);
      return {
        key: `${c1}${c2}`,
        c1,
        c2,
        blocked,
        rows: orderedActions.map((action) => ({
          action,
          value: fmtPct(mix[action]),
        })),
        segments: buildSegmentSlots(mix),
        bg: null,
        weight: detail.weight,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hand,
    hasData,
    boardSet,
    cell,
    orderedActions,
    comboDetail,
    displayMode,
    evRange,
    chipEv,
    money?.mode,
    money?.bbSize,
  ]);

  const isLoading = (loading ?? false) || data.length === 0;

  /* Suited classes read best 2-up (like the reference); pairs and offsuit go
   * wider, clamped by what the measured panel width can fit. Until the
   * ResizeObserver delivers a width, trust the ideal count. */
  const idealCols = hand ? (hand[2] === "s" ? 2 : 3) : 3;
  const maxCols = width ? Math.max(1, Math.floor(width / TILE_MIN_W)) : idealCols;
  const cols = Math.min(idealCols, maxCols);

  /* The grid never scrolls: tiles split the height evenly, and content steps
   * down (normal -> compact -> minimal) as rows get short. */
  const rowCount = Math.max(1, Math.ceil(combos.length / cols));
  const rowH = height
    ? (height - 12 /* p-1.5 */ - (rowCount - 1) * 4 /* gap-1 */) / rowCount
    : Infinity;
  const density: Density =
    rowH >= 72 ? "normal" : rowH >= 48 ? "compact" : "minimal";

  const colMark =
    displayMode === "ev" ? "EV" : displayMode === "equity" ? "EQ" : "%";

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

      <div ref={ref} className="min-h-0 flex-1 overflow-hidden p-1.5">
        {isLoading ? (
          <div className="grid h-full grid-cols-2 gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="min-h-0 rounded-[4px] bg-slate-200/20 animate-pulse"
              />
            ))}
          </div>
        ) : !hand ? (
          <div className="flex h-full items-center justify-center py-6 text-center text-xs text-slate-400">
            Hover or click a hand in the matrix to see its combos
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
              gridAutoRows: "minmax(0, 1fr)",
            }}
          >
            {combos.map(({ key, ...tile }) => (
              <ComboTile key={key} {...tile} colMark={colMark} density={density} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HandBreakdown;
