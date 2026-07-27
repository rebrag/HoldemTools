// ClassicHeader.tsx
//
// Header used by every solver layout except the desktop single-range study
// strip: sim info chip + popover, the wide FolderSelector, the library
// button, and the Line row underneath. The line and library button are
// passed in as slots because Solver builds them (they need the postflop
// session).
import type { ReactNode, Ref } from "react";
import { Info } from "lucide-react";
import FolderSelector, { type FolderSelectorProps } from "../FolderSelector";

interface SimInfoChipProps {
  simName: string;
  playerCount: number;
  avgStack: number | null;
  ante: number;
  icm: number[];
  open: boolean;
  onToggle: () => void;
}

/** Solution info chip with a hover/click popover (click matters on mobile). */
const SimInfoChip = ({
  simName,
  playerCount,
  avgStack,
  ante,
  icm,
  open,
  onToggle,
}: SimInfoChipProps) => (
  <div className="flex-shrink-0">
    <div className="relative group">
      <button
        type="button"
        onClick={onToggle}
        className="
          h-9 sm:h-10 px-2.5 gap-1.5 max-w-[9rem] sm:max-w-[15rem]
          inline-flex items-center justify-start
          rounded-xl border border-gray-300 bg-white/95 shadow-md
          hover:bg-gray-100 text-gray-800
          focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60
        "
        aria-label="Solution info"
        title={simName}
      >
        <Info size={16} strokeWidth={2.2} className="shrink-0 text-emerald-600" />
        <span className="truncate text-xs font-semibold">
          {simName}
        </span>
      </button>

      {/* Solution info popover on hover / click */}
      <div
        className={[
          "transition-opacity duration-150 absolute left-0 top-full mt-1 z-50 w-64",
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
        ].join(" ")}
      >
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
          <div className="mb-2 break-words text-sm font-semibold text-gray-900">
            {simName}
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

          {Array.isArray(icm) && icm.length > 0 ? (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                ICM payouts
              </div>
              <div className="space-y-0.5">
                {icm.map((value, idx) => {
                  const rank = idx + 1;
                  const suffix =
                    rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th";
                  return (
                    <div
                      key={idx}
                      className="flex justify-between gap-2 text-xs text-gray-700"
                    >
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
  </div>
);

interface ClassicHeaderProps extends FolderSelectorProps {
  simName: string;
  playerCount: number;
  avgStack: number | null;
  ante: number;
  icm: number[];
  simInfoOpen: boolean;
  onToggleSimInfo: () => void;
  line: ReactNode;
  libraryButton: ReactNode;
  lineWrapperRef: Ref<HTMLDivElement>;
}

const ClassicHeader = ({
  simName,
  playerCount,
  avgStack,
  ante,
  icm,
  simInfoOpen,
  onToggleSimInfo,
  line,
  libraryButton,
  lineWrapperRef,
  ...folderSelectorProps
}: ClassicHeaderProps) => (
  <>
    {/* Top row: Sim info button (small), FolderSelector (wide, with filter + SR buttons) */}
    <div className="px-2 sm:px-4 mt-1">
      <div className="mx-auto w-full max-w-xl lg:max-w-3xl">
        <div className="relative z-50">
          <div className="flex items-stretch gap-2">
            {/* Solution info chip + popover, always on the left */}
            {simName && (
              <SimInfoChip
                simName={simName}
                playerCount={playerCount}
                avgStack={avgStack}
                ante={ante}
                icm={icm}
                open={simInfoOpen}
                onToggle={onToggleSimInfo}
              />
            )}

            {/* Folder selector (center, wide) */}
            <div
              data-intro-target="folder-selector"
              className="flex-1 min-w-0"
            >
              <FolderSelector {...folderSelectorProps} />
            </div>

            {/* Solved flops library */}
            {libraryButton}
          </div>
        </div>
      </div>
    </div>

    {/* Line row: preflop seat strip, or the postflop breadcrumb in a session */}
    <div
      ref={lineWrapperRef}
      className="relative flex items-center mt-2 mb-2"
    >
      {line}
    </div>
  </>
);

export default ClassicHeader;
