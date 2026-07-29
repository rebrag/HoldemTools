// Compact sim picker for the desktop study strip: sim name + info popover on
// top, a "Select Sim" search input below that opens the same dropdown (and
// keyboard nav / tier gating) as the wide FolderSelector, plus the filter
// popover and the Single Range toggle. Replaces FolderSelector in that view.
import React, { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { FolderMetadata } from "@/hooks/useFolders";
import type { Tier } from "@/lib/stripe/stripeTiers";
import FolderSelectorDropdown from "./FolderSelectorDropdown";
import { useFolderSearch, parseFolderSafe } from "./useFolderSearch";
import {
  FolderFilterPanel,
  FilterIcon,
  MatrixHeightModePill,
  SingleRangeTogglePill,
} from "./FolderSelector";
import type { MatrixHeightMode } from "@/lib/solver/matrixHeight";

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

  singleRangeView: boolean;
  onToggleSingleRange: () => void;

  heightMode?: MatrixHeightMode;
  onHeightModeChange?: (mode: MatrixHeightMode) => void;
}

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
  heightMode,
  onHeightModeChange,
}) => {
  const reduceMotion = useReducedMotion();

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

  return (
    <div className="relative flex h-full flex-col justify-between gap-1.5 rounded-xl border border-hairline bg-surface/85 p-2 shadow-md backdrop-blur-md overflow-visible">
      {/* Row 1: sim identity + info popover */}
      <div className="relative group min-w-0">
        <button
          type="button"
          onClick={() => setInfoOpen((o) => !o)}
          className="flex w-full min-w-0 items-center gap-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-md"
          aria-label="Solution info"
          title={simName || currentFolder}
        >
          <Info size={14} strokeWidth={2.2} className="shrink-0 text-emerald-400" />
          <span className="truncate text-xs font-semibold text-slate-100">
            {simName || currentFolder}
          </span>
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
          <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
            <div className="mb-2 break-words text-sm font-semibold text-gray-900">
              {simName || currentFolder}
            </div>

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
        </div>
      </div>

      {/* Row 2: Select Sim input + filter + Single Range toggle */}
      <div className="flex items-stretch gap-1">
        <div ref={inputWrapRef} className="relative min-w-0 flex-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={nav}
            placeholder="Select Sim"
            className="
              h-9 w-full rounded-lg border border-hairline
              bg-white/5 px-2.5 text-sm text-slate-100
              placeholder:font-semibold placeholder:text-slate-300
              shadow-sm transition-colors
              hover:border-white/25 hover:bg-white/10
              focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40
            "
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

        {/* Filter */}
        <div className="relative flex-shrink-0">
          <button
            type="button"
            aria-label="Open filters"
            title="Filters"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowFilter((p) => !p)}
            className={`
              h-9 w-9 inline-flex items-center justify-center
              rounded-lg border shadow-sm transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60
              ${
                showFilter || playersFilter !== null || ftFilter !== "any"
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-hairline bg-white/5 text-slate-300 hover:border-white/25 hover:text-slate-100"
              }
            `}
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

        <SingleRangeTogglePill
          singleRangeView={singleRangeView}
          onToggle={onToggleSingleRange}
          compact
        />

        {heightMode && onHeightModeChange && (
          <MatrixHeightModePill
            heightMode={heightMode}
            onChange={onHeightModeChange}
            compact
          />
        )}
      </div>

      {/* Dropdown (portal, anchored to the input) */}
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
