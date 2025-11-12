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

const FolderSelectorDropdown: React.FC<Props> = ({
  open,
  items,
  header,
  hi,
  setHi,
  onChoose,
  metaByFolder,
  parseFolderSafe,
}) => {
  if (!open) return null;

  
  // Define the grid layout template. Tags column is small and fixed width.
  // Example: 2.5rem (40px) for tags, then 1fr for Avg, then 1fr for each seat.
  const GRID_TEMPLATE_COLUMNS = `2.5rem 1fr repeat(${header.length}, 1fr)`;

  const isFinalTable = (folder: string): boolean => {
    const meta = metaByFolder?.[folder] ?? null;
    const name = (meta as any)?.name as string | undefined;
    if (name && name.toUpperCase().includes("FT")) return true;
    return folder.toUpperCase().includes("FT");
  };

  return (
    // Center under the control
    <div
      className="absolute z-10 mt-2 left-1/2 -translate-x-1/2"
      onMouseDown={(e) => e.preventDefault()}
      style={{ transformOrigin: "top center" }}
    >
      {/* Panel: Simple white background panel */}
      <div
        className={`
          w-[clamp(18rem,85vw,28rem)]
          max-w-[calc(100vw-1.5rem)]
          rounded-xl border border-gray-200 bg-white/95 backdrop-blur
          shadow-[0_10px_25px_rgba(0,0,0,0.12)]
          overflow-visible
        `}
      >
        {/* Header */}
        <div
          style={{ display: "grid", gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
          className="text-[11px] font-semibold text-gray-200 bg-gray-800 sticky top-0"
        >
          {/* 🛑 NEW TAGS HEADER (small, centered) */}
          <div className="px-1 py-1 text-center border-r border-gray-700">Tags</div>
          {/* AVG HEADER */}
          <div className="px-2 py-1 border-r border-gray-700">Avg.</div>
          {header.map((pos) => (
            <div key={pos} className="px-2 py-1 border-r border-gray-700 text-center">
              {pos}
            </div>
          ))}
        </div>

        {/* Rows: vertical scroll only */}
        <div
          className="max-h-160"
          style={{ overflowY: "auto", overflowX: "visible" }}
        >
          {items.map((folder, idx) => {
            const { stacks, avg } = parseFolderSafe(folder);
            if (Object.keys(stacks).length === 0) return null;

            const showFT = isFinalTable(folder);

            return (
              <div
                key={folder}
                className={`text-xs cursor-pointer transition-colors ${
                  idx === hi ? "bg-blue-100" : "hover:bg-gray-50"
                }`}
                onMouseDown={() => onChoose(folder)}
                onMouseEnter={() => setHi(idx)}
              >
                {/* 🛑 Grid now includes the Tags column */}
                <div
                  style={{ display: "grid", gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
                >
                  {/* 🛑 TAGS COLUMN: Centered, displays the FT badge if needed */}
                  <div className={`px-1 py-1 border-t border-r flex items-center justify-center`}>
                    {showFT && <FtPill />}
                  </div>
                  
                  {/* AVG DATA */}
                  <div className="px-2 py-1 border-t border-r text-center">{avg}</div>
                  
                  {/* SEAT DATA */}
                  {header.map((pos) => (
                    <div key={pos} className="px-2 py-1 border-t text-center">
                      {stacks[pos] ?? ""}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FolderSelectorDropdown;