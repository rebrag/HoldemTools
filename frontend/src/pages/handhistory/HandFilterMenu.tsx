// src/pages/handhistory/HandFilterMenu.tsx
// The hand list's Filters entry point: a trigger that lives in the secondary
// nav next to "Create HH", and the filter panel as a dropdown anchored under
// it. A popout rather than an in-flow panel so opening the filters never
// shoves the hands it filters down the page.
//
// The panel escapes the nav bar because the bar's `overflow-hidden` was moved
// onto its decorative banner (see HandHistorySecondaryNav). CSS anchoring, not
// a portal: the bar is sticky and translates while scrolling, so a portal
// would need a scroll listener to stay glued to it.
//
// It hangs off the BAR's content row, not off the trigger: "Create HH" sits to
// the trigger's right, so a trigger-anchored panel would start ~110px in from
// the page gutter and run off the left edge of a 360px phone. Hence the
// wrapper here is deliberately NOT `relative` — see the `filters` slot's note
// in HandHistorySecondaryNav for the contract that keeps the row positioned.
import React, { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDismissOnOutside } from "@/hooks/useDismissOnOutside";
import HandFilterBar from "./HandFilterBar";
import type { HandFilterState } from "./handFilters";

interface Props {
  filters: HandFilterState;
  setFilters: React.Dispatch<React.SetStateAction<HandFilterState>>;
  knownLocations: string[];
  knownGames: string[];
  filteredCount: number;
  totalCount: number;
  isFiltering: boolean;
  /** Independent criteria active, shown as a badge on the trigger. */
  activeFilterCount: number;
  onReset: () => void;
  onThisYear: () => void;
}

const HandFilterMenu: React.FC<Props> = ({
  filters,
  setFilters,
  knownLocations,
  knownGames,
  filteredCount,
  totalCount,
  isFiltering,
  activeFilterCount,
  onReset,
  onThisYear,
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutside(wrapRef, open, close);

  return (
    <div ref={wrapRef}>
      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Filters"
        /* The word drops below sm: the bar also carries the section title and
           "Create HH", and three full-width items squeeze the title onto two
           lines on a 360px phone. The funnel plus its count still reads. */
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold shadow-md shadow-emerald-950/30 transition-colors sm:px-3.5 ${
          isFiltering
            ? "border-emerald-400 bg-emerald-500 text-white hover:bg-emerald-400"
            : "border-emerald-300/40 bg-white/10 text-emerald-100 hover:bg-white/20 hover:text-white"
        }`}
      >
        <svg
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M2 4h12M4.5 8h7M7 12h2" />
        </svg>
        <span className="hidden sm:inline">Filters</span>
        {activeFilterCount > 0 && (
          <span
            className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
              isFiltering ? "bg-white/25 text-white" : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {activeFilterCount}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.985 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            style={{ transformOrigin: "top right" }}
            role="dialog"
            aria-label="Hand filters"
            /* Clamped to the viewport so the panel keeps a gutter on a 360px
               phone, where the trigger sits ~16px from the right edge. */
            /* Capped and scrollable: the single-column phone layout is ~430px
               tall, which overflows a short viewport in landscape. */
            className="absolute right-4 top-full z-50 mt-2 max-h-[calc(100dvh-8rem)] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-xl border border-emerald-200 bg-white shadow-xl shadow-emerald-950/30 sm:w-[26rem]"
          >
            <HandFilterBar
              filters={filters}
              setFilters={setFilters}
              knownLocations={knownLocations}
              knownGames={knownGames}
              filteredCount={filteredCount}
              totalCount={totalCount}
              isFiltering={isFiltering}
              onReset={onReset}
              onThisYear={onThisYear}
              onHide={close}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default HandFilterMenu;
