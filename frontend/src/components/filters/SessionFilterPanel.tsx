// src/components/filters/SessionFilterPanel.tsx
// The session-attribute filter panel, shared by the bankroll tool and the hand
// history list as ONE source of truth: location, game/stakes, and date range
// render identically everywhere, and a future change lands on both tools at
// once. Extracted from pages/bankroll/FilterPanel.tsx with its JSX and theme
// map intact (bankroll renders pixel-identically); tool-specific controls slot
// in via `extraFields` (cells inside the responsive grid) and `extraRows`
// (full-width rows under it, e.g. bankroll's session-length range).
import React from "react";
import type { CommonFilterState, FilterTheme } from "./types";

export type { FilterTheme };

// Class map per theme (the codebase's tone-prop convention; no `dark:`
// variants). Exported so extra fields/rows can style themselves to match.
export const FILTER_THEMES = {
  light: {
    panel: "border-b border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs space-y-2",
    label: "font-medium text-gray-700",
    control:
      "rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500",
    hoursInput:
      "w-24 rounded-md border border-emerald-200 bg-white px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500",
    quickBtn:
      "inline-flex items-center justify-center rounded-md border border-emerald-300 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition",
    dash: "text-gray-500",
    summary: "text-[11px] text-gray-600",
    clearBtn:
      "text-[11px] text-emerald-700 underline underline-offset-2 hover:text-emerald-800",
    hideBtn: "text-[11px] text-gray-600 hover:text-gray-800",
  },
  dark: {
    panel: "border-b border-white/10 bg-white/5 px-3 py-2.5 text-xs space-y-2",
    label: "font-medium text-emerald-100/85",
    control:
      "rounded-md border border-white/15 bg-slate-900/60 px-2 py-1 text-[11px] text-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-400 [color-scheme:dark]",
    hoursInput:
      "w-24 rounded-md border border-white/15 bg-slate-900/60 px-1.5 py-1 text-[11px] text-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-400 [color-scheme:dark]",
    quickBtn:
      "inline-flex items-center justify-center rounded-md border border-emerald-300/40 bg-white/5 px-2 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-400/15 transition",
    dash: "text-emerald-100/60",
    summary: "text-[11px] text-emerald-100/70",
    clearBtn:
      "text-[11px] text-emerald-300 underline underline-offset-2 hover:text-emerald-200",
    hideBtn: "text-[11px] text-emerald-100/70 hover:text-emerald-50",
  },
} as const;

interface Props<T extends CommonFilterState> {
  filters: T;
  setFilters: React.Dispatch<React.SetStateAction<T>>;
  knownLocations: string[];
  /** Stakes strings (see CommonFilterState.game note). */
  knownGames: string[];
  filteredCount: number;
  totalCount: number;
  /** "sessions" | "hands" — the noun in "Showing X / Y …". */
  countNoun: string;
  isFiltering: boolean;
  onReset: () => void;
  onThisYear: () => void;
  onHide?: () => void;
  theme?: FilterTheme;
  /** Grid classes for the field row. Media queries key off the VIEWPORT, not
   *  the container, so a narrow host (the hand-history popout) must ask for
   *  fewer columns or the date inputs clip on a mid-width screen. */
  gridClassName?: string;
  /** Tool-specific cells rendered inside the responsive grid, between the date
   *  inputs and the Quick range button. */
  extraFields?: React.ReactNode;
  /** Tool-specific full-width rows rendered under the grid (e.g. bankroll's
   *  session-length min–max pair). */
  extraRows?: React.ReactNode;
}

function SessionFilterPanel<T extends CommonFilterState>({
  filters,
  setFilters,
  knownLocations,
  knownGames,
  filteredCount,
  totalCount,
  countNoun,
  isFiltering,
  onReset,
  onThisYear,
  onHide,
  theme = "light",
  gridClassName = "grid gap-2 sm:grid-cols-5",
  extraFields,
  extraRows,
}: Props<T>): React.ReactElement {
  const t = FILTER_THEMES[theme];

  return (
    <div className={t.panel}>
      <div className={gridClassName}>
        {/* Location */}
        <div className="flex flex-col gap-1">
          <span className={t.label}>Location</span>
          <select
            className={t.control}
            value={filters.location}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, location: e.target.value }))
            }
          >
            <option value="">All locations</option>
            {knownLocations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </div>

        {/* Game (stakes; see CommonFilterState.game) */}
        <div className="flex flex-col gap-1">
          <span className={t.label}>Game</span>
          <select
            className={t.control}
            value={filters.game}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, game: e.target.value }))
            }
          >
            <option value="">All games</option>
            {knownGames.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        {/* From date */}
        <div className="flex flex-col gap-1">
          <span className={t.label}>From date</span>
          <input
            type="date"
            className={t.control}
            value={filters.fromDate}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, fromDate: e.target.value }))
            }
          />
        </div>

        {/* To date */}
        <div className="flex flex-col gap-1">
          <span className={t.label}>To date</span>
          <input
            type="date"
            className={t.control}
            value={filters.toDate}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, toDate: e.target.value }))
            }
          />
        </div>

        {extraFields}

        {/* Quick range: This year */}
        <div className="flex flex-col gap-1 justify-end">
          <span className={t.label}>Quick range</span>
          <button type="button" onClick={onThisYear} className={t.quickBtn}>
            This year
          </button>
        </div>
      </div>

      {extraRows}

      <div className="flex items-center justify-between gap-2">
        <p className={t.summary}>
          Showing{" "}
          <span className="font-semibold">
            {filteredCount} / {totalCount}
          </span>{" "}
          {countNoun}.
        </p>
        <div className="flex items-center gap-2">
          {isFiltering && (
            <button type="button" onClick={onReset} className={t.clearBtn}>
              Clear filters
            </button>
          )}
          {onHide && (
            <button type="button" onClick={onHide} className={t.hideBtn}>
              Hide
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SessionFilterPanel;
