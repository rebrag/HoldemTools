/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import type { FolderMetadata } from "../hooks/useFolders";

type Props = {
  open: boolean;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  items: string[];
  header: string[];
  hi: number;
  setHi: React.Dispatch<React.SetStateAction<number>>;
  onChoose: (folder: string) => void;
  metaByFolder?: Record<string, FolderMetadata | null>;
  parseFolderSafe: (folder: string) => { stacks: Record<string, number>; avg: number };
  lockedSet?: Set<string>;
};

const FtPill: React.FC = () => (
  <span
    className="
      inline-flex items-center px-1.5 py-[1px]
      rounded-full text-[10px] leading-4
      bg-amber-200 text-amber-900 border border-amber-300 shadow-sm
      pointer-events-none
    "
  >
    FT
  </span>
);

const LockIcon: React.FC<{ className?: string; title?: string }> = ({
  className = "h-3.5 w-3.5 text-amber-700",
  title = "Locked — requires upgrade",
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    role="img"
    className={className}
    focusable="false"
  >
    <path d="M7 10V8a5 5 0 0 1 10 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="15" r="1.25" fill="currentColor" />
    <title>{title}</title>
  </svg>
);

const FolderSelectorDropdown: React.FC<Props> = ({
  open,
  items,
  header,
  hi,
  setHi,
  onChoose,
  metaByFolder,
  parseFolderSafe,
  lockedSet,
}) => {
  if (!open) return null;

  // Fixed column widths to keep the right border of Avg. aligned.
  // Tags: 2.5rem | Avg: 4.5rem | Seats: equal flexible columns.
  const GRID_TEMPLATE_COLUMNS = `3.5rem 4rem repeat(${header.length}, minmax(0, 1fr))`;

  // Shared cell metrics (header + rows) so row height == header height.
  const CELL_TEXT = "text-[11px] leading-4";
  const CELL_PY = "py-1";
  const CELL_TAGS_PX = "px-1"; // tags col is visually tighter
  const CELL_STD_PX = "px-1";

  const COL_COUNT = 2 + header.length;
  const cellBorderR = (i: number) => (i < COL_COUNT - 1 ? "border-r border-gray-200" : "");

  const isFinalTable = (folder: string): boolean => {
    const meta = metaByFolder?.[folder] ?? null;
    const name = (meta as any)?.name as string | undefined;
    if (name && name.toUpperCase().includes("FT")) return true;
    return folder.toUpperCase().includes("FT");
  };

  return (
    <div
      className="absolute z-10 mt-2 left-1/2 -translate-x-1/2"
      onMouseDown={(e) => e.preventDefault()}
      style={{ transformOrigin: "top center" }}
    >
      <div
        className="
          w-[clamp(18rem,85vw,28rem)]
          max-w-[calc(100vw-1.5rem)]
          rounded-xl border border-gray-200 bg-white/95 backdrop-blur
          shadow-[0_10px_25px_rgba(0,0,0,0.12)]
          overflow-hidden
        "
      >
        {/* One scroll area so header & rows share the same width; stable gutters avoid shifts */}
        <div className="max-h-160 overflow-auto [scrollbar-gutter:stable]">
          {/* HEADER (inside scrollbox), same grid template and SAME PAD/TEXT as rows */}
          <div
            className="grid sticky top-0 z-10 bg-gray-800 text-gray-200 font-semibold border-b border-gray-700"
            style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS, gridAutoRows: "auto" }}
          >
            <div className={`${CELL_TEXT} ${CELL_PY} ${CELL_TAGS_PX} text-center ${cellBorderR(0)}`}>
              Tags
            </div>
            <div className={`${CELL_TEXT} ${CELL_PY} ${CELL_STD_PX} text-center ${cellBorderR(1)}`}>
              Avg.
            </div>
            {header.map((pos, i) => (
              <div
                key={`h-${pos}`}
                className={`${CELL_TEXT} ${CELL_PY} ${CELL_STD_PX} text-center ${cellBorderR(i + 2)}`}
              >
                {pos}
              </div>
            ))}
          </div>

          {/* ROWS — same grid template and SAME PAD/TEXT as header */}
          <div
            className="grid"
            style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS, gridAutoRows: "auto" }}
          >
            {items.map((folder, idx) => {
              const { stacks, avg } = parseFolderSafe(folder);
              if (Object.keys(stacks).length === 0) return null;

              const showFT = isFinalTable(folder);
              const isLocked = lockedSet?.has(folder) ?? false;
              const rowBg = idx === hi ? "bg-blue-100" : "hover:bg-gray-50";
              const choose = () => onChoose(folder);
              const enter = () => setHi(idx);

              return (
                <React.Fragment key={folder}>
                  {/* TAGS */}
                  <div
                    className={`${CELL_TEXT} ${CELL_PY} ${CELL_TAGS_PX} border-t border-gray-200 ${cellBorderR(0)} ${rowBg} cursor-pointer flex items-center justify-center`}
                    onMouseDown={choose}
                    onMouseEnter={enter}
                    title={isLocked ? "Locked — Subscribe!" : undefined}
                  >
                    {showFT ? (
                      <div className="relative flex items-center justify-center">
                        <FtPill />
                        {isLocked && (
                          <span className="absolute -top-1.5 -right-1.5 pointer-events-none select-none">
                            <LockIcon className="h-3.5 w-3.5 text-amber-700 drop-shadow-sm" />
                          </span>
                        )}
                      </div>
                    ) : (
                      isLocked && <LockIcon className="h-4 w-4 text-amber-700" />
                    )}
                  </div>

                  {/* AVG (fixed-width col) */}
                  <div
                    className={`${CELL_TEXT} ${CELL_PY} ${CELL_STD_PX} border-t border-gray-200 ${cellBorderR(1)} ${rowBg} cursor-pointer text-center tabular-nums`}
                    onMouseDown={choose}
                    onMouseEnter={enter}
                  >
                    {avg}
                  </div>

                  {/* SEATS */}
                  {header.map((pos, i) => (
                    <div
                      key={`${folder}-${pos}`}
                      className={`${CELL_TEXT} ${CELL_PY} ${CELL_STD_PX} border-t border-gray-200 ${i < header.length - 1 ? "border-r" : ""} ${rowBg} cursor-pointer text-center`}
                      onMouseDown={choose}
                      onMouseEnter={enter}
                    >
                      {stacks[pos] ?? ""}
                    </div>
                  ))}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FolderSelectorDropdown;
