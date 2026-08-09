// Compact sim picker for the study strip. Desktop stacks the sim name (with
// its info popover) over a "Select Sim" search input; the phone merges the two
// into a single trigger that shows the loaded sim, and drops the controls onto
// their own row beneath it. Both open the same dropdown (and keyboard nav /
// tier gating) as the wide FolderSelector this replaced. The panel owns every
// control that is about *which* solution is open - filter, solved-flops
// library, single-range toggle - while the matrix's own controls (display
// mode, cell height) sit above the matrix; see SingleRangeStudy.
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { FolderMetadata } from "@/hooks/useFolders";
import type { Tier } from "@/lib/stripe/stripeTiers";
import useIsMobile from "@/hooks/useIsMobile";
import FolderSelectorDropdown from "./FolderSelectorDropdown";
import { useFolderSearch, parseFolderSafe } from "./useFolderSearch";
import {
  FolderFilterPanel,
  FilterIcon,
  SingleRangeTogglePill,
} from "./FolderSelector";

export interface SimSelectProps {
  folders: string[];
  currentFolder: string;
  onFolderSelect: (folder: string) => void;
  metaByFolder?: Record<string, FolderMetadata | null>;
  userTier?: Tier;

  simName?: string;
  playerCount: number;
  avgStack?: number | null;
  ante?: number;
  icm?: number[];

  /** Single-range toggle. This panel is the toggle's only mount point across
   *  all four layouts, so it also carries the intro tour's `color-key-btn`
   *  target - which is why these are required rather than optional. */
  singleRangeView: boolean;
  onToggleSingleRange: () => void;

  /** Solved-flops library button. A slot because Solver owns the postflop
   *  index and the modal; this panel only owns the row it sits in. */
  libraryButton?: ReactNode;
}

/** Square icon button shared by the filter and info controls, sized to match
 *  the library button and the single-range pill in their `compact` form. */
const ICON_BTN = (active: boolean) =>
  [
    "h-9 w-9 inline-flex items-center justify-center",
    "rounded-lg border shadow-sm transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
    active
      ? "border-accent/50 bg-accent/15 text-accent"
      : "border-hairline bg-white/5 text-slate-300 hover:border-white/25 hover:text-slate-100",
  ].join(" ");

const SimSelect: React.FC<SimSelectProps> = ({
  folders,
  currentFolder,
  onFolderSelect,
  metaByFolder,
  userTier = "free",
  simName,
  playerCount,
  avgStack,
  ante = 0,
  icm,
  singleRangeView,
  onToggleSingleRange,
  libraryButton,
}) => {
  const reduceMotion = useReducedMotion();
  /* On mobile the trigger stays an <input> (so the focus/blur open-close
   * wiring and the dropdown's mousedown row-commit keep working) but is made
   * non-typeable: tap opens the sheet, filtering happens via the filter
   * button instead of the soft keyboard. */
  const isMobile = useIsMobile();

  const {
    input,
    setInput,
    open,
    setOpen,
    items,
    hi,
    setHi,
    header,
    lockedSet,
    playersFilter,
    setPlayersFilter,
    ftFilter,
    setFtFilter,
    choose,
    handleInputKeyDown,
  } = useFolderSearch({ folders, currentFolder, onFolderSelect, metaByFolder, userTier });

  const [showFilter, setShowFilter] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const inputWrapRef = useRef<HTMLDivElement | null>(null);

  /* A new sim replaces the popover's content; don't leave it hanging open. */
  useEffect(() => {
    setInfoOpen(false);
  }, [currentFolder]);

  const nav: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Escape") setShowFilter(false);
    handleInputKeyDown(e);
  };

  const isICM = Array.isArray(icm) && icm.length > 0;
  const label = simName || currentFolder;

  /* ---- Pieces shared by both layouts ------------------------------- */

  const infoCard = (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
      <div className="mb-2 break-words text-sm font-semibold text-gray-900">{label}</div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
          {playerCount} players
        </span>
        {avgStack != null && (
          <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-sky-200">
            {avgStack} bb avg
          </span>
        )}
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
          {ante > 0 ? `${ante} bb ante` : "No ante"}
        </span>
      </div>

      {isICM ? (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            ICM payouts
          </div>
          <div className="space-y-0.5">
            {icm!.map((value, idx) => {
              const rank = idx + 1;
              const suffix =
                rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th";
              return (
                <div key={idx} className="flex justify-between gap-2 text-xs text-gray-700">
                  <span>
                    {rank}
                    <sup>{suffix}</sup> place
                  </span>
                  <span className="font-medium tabular-nums">
                    ${value.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-xs text-gray-500">Chip EV · no ICM</div>
      )}
    </div>
  );

  const filterControl = (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        aria-label="Open filters"
        title="Filters"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShowFilter((p) => !p)}
        className={ICON_BTN(
          showFilter || playersFilter !== null || ftFilter !== "any"
        )}
      >
        <FilterIcon className="h-4 w-4" />
      </button>

      {showFilter && (
        <motion.div
          className="
            absolute left-0 mt-2 w-68 z-50 p-3
            rounded-xl border border-hairline
            bg-surface/90 backdrop-blur-md
            shadow-[0_18px_40px_rgba(2,6,23,0.45)]
          "
          onMouseDown={(e) => e.preventDefault()}
          initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformOrigin: "top left" }}
        >
          <FolderFilterPanel
            playersFilter={playersFilter}
            setPlayersFilter={setPlayersFilter}
            ftFilter={ftFilter}
            setFtFilter={setFtFilter}
            onClose={() => setShowFilter(false)}
          />
        </motion.div>
      )}
    </div>
  );

  const togglePill = (
    <SingleRangeTogglePill
      singleRangeView={singleRangeView}
      onToggle={onToggleSingleRange}
      compact
    />
  );

  return (
    <div className="relative flex h-full flex-col justify-between gap-1 rounded-xl border border-hairline bg-surface/85 p-1.5 shadow-md backdrop-blur-md overflow-visible sm:gap-1.5 sm:p-2">
      {/* Row 1 (desktop): sim identity + info popover. The phone shows the sim
          in the trigger below instead, and reaches this card via its own info
          button - two lines of chrome is more than a 170px panel can spare. */}
      {!isMobile && (
        <div className="relative group min-w-0">
          <button
            type="button"
            onClick={() => setInfoOpen((o) => !o)}
            className="flex w-full min-w-0 items-center gap-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-md"
            aria-label="Solution info"
            title={label}
          >
            <Info size={14} strokeWidth={2.2} className="shrink-0 text-emerald-400" />
            <span className="truncate text-xs font-semibold text-slate-100">{label}</span>
          </button>
          <div className="mt-0.5 truncate text-[10px] tabular-nums text-slate-400">
            {playerCount} players
            {avgStack != null && <> · {avgStack} bb avg</>}
            {" · "}
            {ante > 0 ? `${ante} bb ante` : "no ante"}
            {isICM && " · ICM"}
          </div>

          {/* Info popover on hover / click (same pattern as the wide header chip) */}
          <div
            className={[
              "transition-opacity duration-150 absolute left-0 top-full mt-1 z-50 w-64",
              infoOpen
                ? "opacity-100 pointer-events-auto"
                : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
            ].join(" ")}
          >
            {infoCard}
          </div>
        </div>
      )}

      {/* Trigger row. Desktop keeps the controls beside the search box; the
          phone gives the trigger the full width and wraps the controls below. */}
      <div className="flex items-stretch gap-1">
        <div ref={inputWrapRef} className="relative min-w-0 flex-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            /* Re-open on tap when already focused (e.g. after the sheet's ✕),
               since onFocus won't fire again. */
            onClick={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={nav}
            /* Nothing is typed on mobile, so the placeholder is free to name
               the loaded sim - the panel has no room for a separate label.
               The accessible name is pinned separately for that reason: the
               placeholder is layout-dependent (and was never a real label). */
            placeholder={isMobile ? label || "Select Sim" : "Select Sim"}
            aria-label="Select Sim"
            data-testid="sim-select"
            readOnly={isMobile}
            inputMode={isMobile ? "none" : undefined}
            title={isMobile ? label : undefined}
            className={`
              h-9 w-full rounded-lg border border-hairline
              bg-white/5 pl-2.5 pr-7 text-sm text-slate-100
              placeholder:font-semibold placeholder:text-slate-300
              shadow-sm transition-colors
              hover:border-white/25 hover:bg-white/10
              focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40
              ${isMobile ? "caret-transparent cursor-pointer" : ""}
            `}
          />
          <svg
            className={`pointer-events-none absolute inset-y-0 right-2 my-auto h-4 w-4 text-slate-400 transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.23 8.27a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        {!isMobile && (
          <>
            {filterControl}
            {libraryButton}
            {togglePill}
          </>
        )}
      </div>

      {/* Controls row (mobile only): info, filter, solved flops, single range. */}
      {isMobile && (
        <div className="flex items-stretch gap-1">
          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => setInfoOpen((o) => !o)}
              aria-label="Solution info"
              title="Solution info"
              className={ICON_BTN(infoOpen)}
            >
              <Info size={16} strokeWidth={2.2} className="text-emerald-400" />
            </button>
            {infoOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 w-64">{infoCard}</div>
            )}
          </div>
          {filterControl}
          {libraryButton}
          {togglePill}
        </div>
      )}

      {/* Dropdown (portal, anchored to the trigger) */}
      <FolderSelectorDropdown
        open={open}
        anchorRef={inputWrapRef}
        items={items}
        header={header}
        hi={hi}
        setHi={setHi}
        onChoose={choose}
        onClose={() => setOpen(false)}
        metaByFolder={metaByFolder}
        parseFolderSafe={parseFolderSafe}
        lockedSet={lockedSet}
      />
    </div>
  );
};

export default SimSelect;
