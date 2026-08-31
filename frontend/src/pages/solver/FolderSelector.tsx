// Shared solver control pieces: the filter popover body, the filter icon, the
// single-range toggle pill, and the cell-height menu. The wide FolderSelector
// component that used to live here is gone - every layout now goes through
// SimSelect in StudyTopStrip - but these pieces stay shared between SimSelect
// and the per-layout control rows.
import React, { useCallback, useRef, useState } from "react";
import { useDismissOnOutside } from "@/hooks/useDismissOnOutside";
import { AlignEndHorizontal, LayoutGrid, Square } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { type FTFilter } from "./useFolderSearch";
import {
  MATRIX_HEIGHT_MODE_OPTIONS,
  type MatrixHeightMode,
} from "@/lib/solver/matrixHeight";

/* ────────────────────────────────────────────────────────────────── */
/*  Filter popover styling                                            */
/* ────────────────────────────────────────────────────────────────── */
const FILTER_LABEL =
  "text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 mb-1.5";

const chipClass = (active: boolean) =>
  [
    "px-2 py-1 rounded-lg text-xs border transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
    active
      ? "bg-accent/20 text-accent border-accent/50"
      : "bg-white/5 text-slate-300 border-hairline hover:bg-white/10 hover:text-slate-100",
  ].join(" ");

/** Shared filter popover body (players + Final Table chips). Also used by SimSelect. */
export const FolderFilterPanel: React.FC<{
  playersFilter: number | null;
  setPlayersFilter: React.Dispatch<React.SetStateAction<number | null>>;
  ftFilter: FTFilter;
  setFtFilter: React.Dispatch<React.SetStateAction<FTFilter>>;
  onClose: () => void;
}> = ({ playersFilter, setPlayersFilter, ftFilter, setFtFilter, onClose }) => (
  <>
    {/* Number of players */}
    <div className="mb-3">
      <div className={FILTER_LABEL}>Number of players</div>
      <div className="flex flex-wrap gap-1">
        <button
          className={chipClass(playersFilter === null)}
          onClick={() => setPlayersFilter(null)}
        >
          Any
        </button>
        {[2, 3, 4, 5, 6, 7, 8].map((n) => (
          <button
            key={n}
            className={chipClass(playersFilter === n)}
            onClick={() => setPlayersFilter((prev) => (prev === n ? null : n))}
          >
            {n}
          </button>
        ))}
      </div>
    </div>

    {/* Final Table */}
    <div className="mb-2">
      <div className={FILTER_LABEL}>Final Table</div>
      <div className="flex flex-wrap gap-1">
        <button className={chipClass(ftFilter === "any")} onClick={() => setFtFilter("any")}>
          Any
        </button>
        <button className={chipClass(ftFilter === "only")} onClick={() => setFtFilter("only")}>
          Final Table
        </button>
        <button
          className={chipClass(ftFilter === "exclude")}
          onClick={() => setFtFilter("exclude")}
        >
          Exclude FT
        </button>
      </div>
    </div>

    <div className="pt-2 border-t border-hairline flex items-center justify-between">
      <button
        className="text-xs text-accent hover:underline"
        onClick={() => {
          setPlayersFilter(null);
          setFtFilter("any");
        }}
      >
        Reset filters
      </button>
      <button className="text-xs text-slate-400 hover:text-slate-200" onClick={onClose}>
        Close
      </button>
    </div>
  </>
);

/** Funnel icon used by both the wide selector and SimSelect's filter button. */
export const FilterIcon: React.FC<{ className?: string }> = ({
  className = "h-4 w-4 sm:h-5 sm:w-5",
}) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M3 5a1 1 0 011-1h16a1 1 0 01.8 1.6l-6.2 8.27V19a1 1 0 01-.553.894l-3 1.5A1 1 0 019 20.5v-5.63L2.2 5.6A1 1 0 013 5z" />
  </svg>
);

/** Single Range toggle pill. Carries the intro-tour target; it mounts only in
 *  SimSelect's control row, which every layout shares, so the "exactly one
 *  instance" rule holds by construction rather than by convention. */
export const SingleRangeTogglePill: React.FC<{
  singleRangeView?: boolean;
  onToggle: () => void;
  /** Icon-only square button sized to SimSelect's compact row. */
  compact?: boolean;
}> = ({ singleRangeView, onToggle, compact = false }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={singleRangeView ?? false}
    data-intro-target="color-key-btn"
    className={[
      compact
        ? "h-9 w-9 rounded-lg shadow-sm"
        : "h-9 sm:h-10 px-2 sm:px-3 gap-1.5 rounded-xl shadow-md backdrop-blur-md",
      "inline-flex items-center justify-center whitespace-nowrap",
      "border transition-colors",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
      singleRangeView
        ? "border-accent/50 bg-accent/15 text-accent"
        : compact
        ? "border-hairline bg-white/5 text-slate-300 hover:border-white/25 hover:text-slate-100"
        : "border-hairline bg-surface/85 text-slate-300 hover:border-white/20 hover:text-slate-100",
    ].join(" ")}
    title="Toggle Single Range View"
  >
    {singleRangeView ? (
      <Square size={16} strokeWidth={2.2} />
    ) : (
      <LayoutGrid size={16} strokeWidth={2.2} />
    )}
    {!compact && (
      <span className="hidden sm:inline text-xs font-semibold">Single Range</span>
    )}
  </button>
);

/** Cell-height mode menu: icon button opening a 3-way radio popover
 *  (Normalized / Range height / Full height), GTO Wizard style. */
export const MatrixHeightModePill: React.FC<{
  heightMode: MatrixHeightMode;
  onChange: (mode: MatrixHeightMode) => void;
  /** Icon-only square button sized to SimSelect's compact row. */
  compact?: boolean;
  /** Which edge the popover hangs from. Defaults to the right, which suits a
   *  pill at the end of a row; a left-grouped pill needs "left" or the 240px
   *  menu runs off the viewport. */
  align?: "left" | "right";
  /** Extra classes on the wrapper (e.g. responsive visibility). */
  className?: string;
}> = ({ heightMode, onChange, compact = false, align = "right", className = "" }) => {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  /* Close on any press outside the button + popover, or on Escape. */
  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutside(wrapRef, open, close);

  return (
    <div ref={wrapRef} className={`relative flex-shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="height-mode-btn"
        className={[
          compact
            ? "h-9 w-9 rounded-lg shadow-sm"
            : "h-9 sm:h-10 w-9 sm:w-10 rounded-xl shadow-md backdrop-blur-md",
          "inline-flex items-center justify-center",
          "border transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          open
            ? "border-accent/50 bg-accent/15 text-accent"
            : compact
            ? "border-hairline bg-white/5 text-slate-300 hover:border-white/25 hover:text-slate-100"
            : "border-hairline bg-surface/85 text-slate-300 hover:border-white/20 hover:text-slate-100",
        ].join(" ")}
        title="Hand cell height"
      >
        <AlignEndHorizontal size={16} strokeWidth={2.2} />
      </button>

      {open && (
        <motion.div
          role="menu"
          aria-label="Hand cell height"
          data-testid="height-mode-menu"
          className={[
            "absolute mt-2 w-60 z-50 p-1.5",
            "rounded-xl border border-hairline",
            "bg-surface/90 backdrop-blur-md",
            "shadow-[0_18px_40px_rgba(2,6,23,0.45)]",
            align === "left" ? "left-0" : "right-0",
          ].join(" ")}
          initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformOrigin: align === "left" ? "top left" : "top right" }}
        >
          <div className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Hand cell height
          </div>
          {MATRIX_HEIGHT_MODE_OPTIONS.map(({ mode, label, desc }) => {
            const active = mode === heightMode;
            return (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                data-mode={mode}
                onClick={() => {
                  onChange(mode);
                  setOpen(false);
                }}
                className={[
                  "w-full rounded-lg px-2 py-1.5 text-left transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  active
                    ? "bg-accent/20 text-accent"
                    : "text-slate-200 hover:bg-white/10",
                ].join(" ")}
              >
                <span className="block text-xs font-semibold">{label}</span>
                <span
                  className={`block text-[10px] leading-snug ${
                    active ? "text-accent/80" : "text-slate-400"
                  }`}
                >
                  {desc}
                </span>
              </button>
            );
          })}
        </motion.div>
      )}
    </div>
  );
};

