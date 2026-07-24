import React, { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import type { FolderMetadata } from "@/hooks/useFolders";

type Props = {
  open: boolean;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  items: string[];
  header: string[];
  hi: number;
  setHi: React.Dispatch<React.SetStateAction<number>>;
  onChoose: (folder: string) => void;
  onClose?: () => void;
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
    <path
      d="M7 10V8a5 5 0 0 1 10 0v2"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <rect
      x="5"
      y="10"
      width="14"
      height="10"
      rx="2.5"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <circle cx="12" cy="15" r="1.25" fill="currentColor" />
    <title>{title}</title>
  </svg>
);

/* Tracks the mobile breakpoint (Tailwind `sm` = 640px) so the dropdown can
   switch between a viewport-centered sheet and an anchored desktop window. */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return isMobile;
}

/* Measures the anchor (search bar) and viewport while open, re-measuring on
   scroll/resize. Used only to *position* the window — never to size it. */
type Anchor = { top: number; left: number; bottom: number; width: number };
function useAnchorRect(
  open: boolean,
  anchorRef: React.RefObject<HTMLDivElement | null>
): { anchor: Anchor; viewport: { w: number; h: number } } | null {
  const [state, setState] = useState<{
    anchor: Anchor;
    viewport: { w: number; h: number };
  } | null>(null);

  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") return;
    const el = anchorRef.current;
    if (!el) return;

    const measure = () => {
      const r = el.getBoundingClientRect();
      setState({
        anchor: { top: r.top, left: r.left, bottom: r.bottom, width: r.width },
        viewport: { w: window.innerWidth, h: window.innerHeight },
      });
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, anchorRef]);

  return state;
}

const FolderSelectorDropdown: React.FC<Props> = ({
  open,
  anchorRef,
  items,
  header,
  hi,
  setHi,
  onChoose,
  onClose,
  metaByFolder,
  parseFolderSafe,
  lockedSet,
}) => {
  const isMobile = useIsMobile();
  const placement = useAnchorRect(open, anchorRef);

  // Fixed column widths keep the right border of Avg. aligned; seat columns get
  // a min width so a wide table scrolls horizontally instead of squishing.
  const GRID_TEMPLATE_COLUMNS = `3rem 3rem repeat(${header.length}, minmax(2.75rem, 1fr))`;

  // Shared cell metrics (header + rows) so row height == header height.
  const CELL_TEXT = "text-[11px] leading-4";
  const CELL_PY = "py-1";
  const CELL_TAGS_PX = "px-1"; // tags col is visually tighter
  const CELL_STD_PX = "px-1";

  const COL_COUNT = 2 + header.length;
  const cellBorderR = (i: number) => (i < COL_COUNT - 1 ? "border-r border-gray-200" : "");

  const isFinalTable = (folder: string): boolean => {
    const meta = metaByFolder?.[folder] ?? null;
    const tags = meta?.tags;
    if (tags && tags.some((t) => t.toUpperCase() === "FT")) return true;

    // Fallback if metadata missing:
    return folder.toUpperCase().includes("FT");
  };

  if (typeof document === "undefined") return null;

  // Geometry: the window sizes itself from its content (bounded by the
  // viewport), decoupled from the search bar's width.
  const MARGIN = 8; // px gap from viewport edges
  let winStyle: React.CSSProperties = {};
  let scrollMaxHeight = 480;

  if (placement) {
    const { anchor, viewport } = placement;
    const top = anchor.bottom + MARGIN;

    if (isMobile) {
      // Sheet: near-full-width, centered, with a dimmed backdrop behind it.
      const width = viewport.w - MARGIN * 2;
      winStyle = { top, left: MARGIN, width };
    } else {
      // Anchored window: content-driven width, clamped to the viewport, shifted
      // to stay fully on-screen relative to the search bar.
      const contentPx = 48 /* tags */ + 48 /* avg */ + header.length * 52 + 24;
      const width = Math.min(viewport.w - MARGIN * 2, Math.max(360, contentPx));
      let left = anchor.left;
      if (left + width > viewport.w - MARGIN) left = viewport.w - MARGIN - width;
      if (left < MARGIN) left = MARGIN;
      winStyle = { top, left, width };
    }

    // Leave room for the title bar (~44px) plus the bottom margin.
    scrollMaxHeight = Math.max(200, viewport.h - top - MARGIN - 44);
  }

  return createPortal(
    <AnimatePresence>
      {open && placement && (
        <>
          {isMobile && (
            <motion.div
              key="backdrop"
              className="fixed inset-0 z-[1290] bg-black/30 sm:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onMouseDown={() => onClose?.()}
              aria-hidden="true"
            />
          )}

          <motion.div
            key="window"
            className="fixed z-[1300]"
            style={winStyle}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 500, damping: 34, mass: 0.7 }}
            // Keep the search input focused so row onMouseDown fires before blur.
            onMouseDown={(e) => e.preventDefault()}
            role="dialog"
            aria-modal={isMobile}
            aria-label="Preflop solutions"
          >
            <div
              className="
                rounded-2xl border border-gray-200 bg-white
                shadow-[0_20px_60px_rgba(0,0,0,0.25)]
                overflow-hidden
              "
            >
              {/* Title bar — gives the window a modal-like identity and a close
                  affordance (essential on mobile, handy on desktop). */}
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 bg-white">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-semibold text-gray-800 truncate">
                    Preflop Solutions
                  </span>
                  <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 text-[11px] font-semibold px-2 py-[1px]">
                    {items.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onClose?.()}
                  aria-label="Close"
                  className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
                >
                  <span className="text-sm leading-none">✕</span>
                </button>
              </div>

              {items.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-gray-500">
                  No solutions match your search.
                </div>
              ) : (
                /* One scroll area so header & rows share the same width; stable gutters avoid shifts */
                <div
                  className="overflow-auto [scrollbar-gutter:stable]"
                  style={{ maxHeight: scrollMaxHeight }}
                >
                  {/* HEADER (inside scrollbox), same grid template and SAME PAD/TEXT as rows */}
                  <div
                    className="grid sticky top-0 z-10 bg-gray-800 text-gray-200 font-semibold border-b border-gray-700"
                    style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS, gridAutoRows: "auto" }}
                  >
                    <div
                      className={`${CELL_TEXT} ${CELL_PY} ${CELL_TAGS_PX} text-center ${cellBorderR(
                        0
                      )}`}
                    >
                      Tags
                    </div>
                    <div
                      className={`${CELL_TEXT} ${CELL_PY} ${CELL_STD_PX} text-center ${cellBorderR(
                        1
                      )}`}
                    >
                      Avg.
                    </div>
                    {header.map((pos, i) => (
                      <div
                        key={`h-${pos}`}
                        className={`${CELL_TEXT} ${CELL_PY} ${CELL_STD_PX} text-center ${cellBorderR(
                          i + 2
                        )}`}
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
                            className={`${CELL_TEXT} ${CELL_PY} ${CELL_TAGS_PX} border-t border-gray-200 ${cellBorderR(
                              0
                            )} ${rowBg} cursor-pointer flex items-center justify-center`}
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
                            className={`${CELL_TEXT} ${CELL_PY} ${CELL_STD_PX} border-t border-gray-200 ${cellBorderR(
                              1
                            )} ${rowBg} cursor-pointer text-center tabular-nums`}
                            onMouseDown={choose}
                            onMouseEnter={enter}
                          >
                            {avg}
                          </div>

                          {/* SEATS */}
                          {header.map((pos, i) => (
                            <div
                              key={`${folder}-${pos}`}
                              className={`${CELL_TEXT} ${CELL_PY} ${CELL_STD_PX} border-t border-gray-200 ${
                                i < header.length - 1 ? "border-r" : ""
                              } ${rowBg} cursor-pointer text-center`}
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
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default FolderSelectorDropdown;
