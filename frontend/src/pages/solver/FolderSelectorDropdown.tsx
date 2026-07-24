import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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

/* ────────────────────────────────────────────────────────────────── */
/*  Metrics                                                           */
/*  Desktop hangs the tag rail outside the panel; mobile has no room  */
/*  for that, so tags fold into a leading column instead. Both read   */
/*  their row height from here so the two grids line up to the pixel. */
/* ────────────────────────────────────────────────────────────────── */
const RAIL_W = 46; // px — desktop tag gutter, hangs off the panel's left edge
const RAIL_GAP = 6; // px — breathing room between rail and panel border
const ROW_H = 28; // px
const HEAD_H = 26; // px
const TITLE_H = 40; // px — mobile sheet title bar
const PANEL_BORDER = 1; // px — the panel's own border, offsets the first row
const CHIP_COL_W = 42; // px — mobile inline tag column

/* Column sizing. The dropdown is sized by its own content, not by the
   search bar, so the stack columns always get a legible width. */
const AVG_W = 44; // px
const SEAT_W = 52; // px — fits "12.5" at 11px with room to spare
const VIEWPORT_MARGIN = 8; // px

/* The scroll gutter is reserved chrome, so it is added to the panel width
   rather than taken out of it - otherwise the last seat column sits under
   the scrollbar. Measured once with the same `thin` scrollbar the panel
   uses, since the reserved gutter has to match the real one. */
let scrollbarWidthCache: number | null = null;
const scrollbarWidth = (): number => {
  if (scrollbarWidthCache !== null) return scrollbarWidthCache;
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;width:100px;height:100px;overflow-y:scroll;scrollbar-width:thin";
  document.body.appendChild(probe);
  scrollbarWidthCache = probe.offsetWidth - probe.clientWidth;
  document.body.removeChild(probe);
  return scrollbarWidthCache;
};

/* ────────────────────────────────────────────────────────────────── */
/*  Tags                                                              */
/* ────────────────────────────────────────────────────────────────── */
const TAG_STYLES: Record<string, string> = {
  FT: "text-amber-200 bg-amber-400/15 border-amber-400/35",
  ICM: "text-blue-200 bg-blue-500/15 border-blue-400/35",
  HU: "text-violet-200 bg-violet-500/15 border-violet-400/35",
};
const TAG_FALLBACK = "text-slate-300 bg-white/5 border-white/15";
/* Locked wins the chip's colour: it is the one thing that changes whether
   the row can be opened at all. */
const LOCK_STYLE = "text-amber-200 bg-amber-400/20 border-amber-400/45";

/** Most-informative tag first, so the one pill the rail shows is the useful one. */
const TAG_PRIORITY = ["FT", "ICM", "HU"];

const LockIcon: React.FC<{ className?: string; title?: string }> = ({
  className = "h-3.5 w-3.5 text-amber-300",
  title = "Locked - requires upgrade",
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

/**
 * One chip per row, carrying the tag and the locked state together.
 * On desktop the chip rides an external rail over whatever the page shows,
 * so a bare icon has nothing to read against - everything here needs a fill.
 */
const RailChip: React.FC<{ tag?: string; locked: boolean }> = ({ tag, locked }) => {
  if (!tag && !locked) return null;
  return (
    <span
      data-testid="rail-chip"
      data-locked={locked ? "true" : "false"}
      className={`
        inline-flex items-center gap-0.5 px-1 py-[1px]
        rounded-full border text-[9px] font-semibold leading-[14px] tracking-[0.06em]
        shadow-[0_1px_3px_rgba(2,6,23,0.5)] backdrop-blur-sm
        pointer-events-none
        ${locked ? LOCK_STYLE : (tag && TAG_STYLES[tag]) || TAG_FALLBACK}
      `}
    >
      {locked && <LockIcon className="h-2.5 w-2.5 shrink-0" />}
      {tag}
    </span>
  );
};

/* ────────────────────────────────────────────────────────────────── */
/*  Hooks                                                             */
/* ────────────────────────────────────────────────────────────────── */

/** Tracks the Tailwind `sm` breakpoint so the dropdown can switch between an
 *  anchored desktop window and a viewport-centered mobile sheet. */
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

type Anchor = { top: number; left: number; bottom: number; width: number };
type Placement = { anchor: Anchor; viewport: { w: number; h: number } };

/**
 * The window is portaled to <body> and positioned in viewport coordinates,
 * so it has to follow the anchor by hand. A rAF poll while open catches
 * everything that can move it - scroll, resize, and the layout shift when the
 * solution-info pill beside the search bar grows once metadata loads - which a
 * resize listener alone would miss, stranding the window off its anchor.
 */
function useAnchorRect(
  open: boolean,
  anchorRef: React.RefObject<HTMLDivElement | null>
): Placement | null {
  const [state, setState] = useState<Placement | null>(null);
  const last = useRef<Placement | null>(null);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      last.current = null;
      setState(null);
      return;
    }
    let frame = 0;
    const tick = () => {
      const el = anchorRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const next: Placement = {
          anchor: { top: r.top, left: r.left, bottom: r.bottom, width: r.width },
          viewport: { w: window.innerWidth, h: window.innerHeight },
        };
        const p = last.current;
        if (
          !p ||
          Math.abs(p.anchor.left - next.anchor.left) > 0.5 ||
          Math.abs(p.anchor.bottom - next.anchor.bottom) > 0.5 ||
          Math.abs(p.anchor.width - next.anchor.width) > 0.5 ||
          p.viewport.w !== next.viewport.w ||
          p.viewport.h !== next.viewport.h
        ) {
          last.current = next;
          setState(next);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, anchorRef]);

  return state;
}

/* ────────────────────────────────────────────────────────────────── */
/*  Component                                                         */
/* ────────────────────────────────────────────────────────────────── */
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
  const reduceMotion = useReducedMotion();
  const isMobile = useIsMobile();
  const placement = useAnchorRect(open, anchorRef);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const railTrackRef = useRef<HTMLDivElement | null>(null);

  /* The desktop rail sits outside the scrolling panel, so it is moved by hand.
     Writing the transform straight to the node keeps this off React's render
     path - re-rendering every row on each scroll frame would stutter. */
  const syncRail = () => {
    const track = railTrackRef.current;
    const scroller = scrollRef.current;
    if (track && scroller) {
      track.style.transform = `translateY(${-scroller.scrollTop}px)`;
    }
  };

  /* Refiltering replaces the list under a scroll offset that no longer means
     anything, so send both back to the top together. */
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    syncRail();
  }, [items]);

  if (typeof document === "undefined") return null;

  /** Ordered, de-duped tags for a folder. Falls back to the folder name for FT. */
  const tagsFor = (folder: string): string[] => {
    const raw = metaByFolder?.[folder]?.tags ?? [];
    const seen = new Set(raw.map((t) => t.toUpperCase()));
    if (seen.size === 0 && folder.toUpperCase().includes("FT")) seen.add("FT");
    const known = TAG_PRIORITY.filter((t) => seen.has(t));
    const rest = [...seen].filter((t) => !TAG_PRIORITY.includes(t));
    return [...known, ...rest];
  };

  /* Rows with no parseable stacks are dropped. The rail walks the same list so
     the two stay index-for-index. */
  const rows = items
    .map((folder, idx) => ({ folder, idx, ...parseFolderSafe(folder) }))
    .filter((r) => Object.keys(r.stacks).length > 0);

  /* ---- Geometry -------------------------------------------------- */
  const gutter = scrollbarWidth();
  const railFootprint = RAIL_W + RAIL_GAP;

  const gridCols = isMobile
    ? `${CHIP_COL_W}px ${AVG_W}px repeat(${header.length}, minmax(0, 1fr))`
    : `${AVG_W}px repeat(${header.length}, minmax(0, 1fr))`;

  let elementLeft = 0;
  let elementTop = 0;
  let elementWidth = 320;
  let panelWidth = 320;
  let scrollMaxHeight = 400;

  if (placement) {
    const { anchor, viewport } = placement;
    elementTop = anchor.bottom + VIEWPORT_MARGIN;

    if (isMobile) {
      // Sheet: near-full-width and centered; the tag rail is inlined instead.
      panelWidth = viewport.w - 2 * VIEWPORT_MARGIN;
      elementLeft = VIEWPORT_MARGIN;
      elementWidth = panelWidth;
      scrollMaxHeight = Math.max(180, viewport.h - elementTop - VIEWPORT_MARGIN - TITLE_H);
    } else {
      // Anchored window: content-driven width plus the reserved scroll gutter,
      // clamped so both the panel (right) and the external rail (left) stay on
      // screen. The element box spans the rail so it encloses what is painted.
      const idealPanelW = AVG_W + header.length * SEAT_W + gutter + 2 * PANEL_BORDER;
      const maxPanelW = viewport.w - 2 * VIEWPORT_MARGIN - railFootprint;
      panelWidth = Math.max(160, Math.min(idealPanelW, maxPanelW));

      const minLeft = VIEWPORT_MARGIN + railFootprint;
      const maxLeft = viewport.w - VIEWPORT_MARGIN - panelWidth;
      const panelLeft = Math.round(
        Math.min(Math.max(anchor.left, minLeft), Math.max(minLeft, maxLeft))
      );
      elementLeft = panelLeft - railFootprint;
      elementWidth = panelWidth + railFootprint;
      scrollMaxHeight = Math.max(180, viewport.h - elementTop - VIEWPORT_MARGIN);
    }
  }

  const CELL_TEXT = "text-[11px] leading-none";
  const COL_COUNT = (isMobile ? 2 : 1) + header.length;
  const cellBorderR = (i: number) => (i < COL_COUNT - 1 ? "border-r border-white/5" : "");

  const headerCells: string[] = isMobile ? ["", "Avg", ...header] : ["Avg", ...header];

  const panel = (
    <div
      data-testid="folder-dropdown-panel"
      className="
        rounded-xl border border-hairline
        bg-surface/85 backdrop-blur-md
        shadow-[0_18px_40px_rgba(2,6,23,0.55)]
        overflow-hidden
      "
      style={{ width: panelWidth }}
    >
      {isMobile && (
        <div
          data-testid="folder-dropdown-titlebar"
          className="flex items-center justify-between gap-2 px-3 border-b border-hairline"
          style={{ height: TITLE_H }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-slate-100 truncate">
              Preflop Solutions
            </span>
            <span className="inline-flex items-center rounded-full bg-accent/15 text-accent text-[11px] font-semibold px-2 py-[1px] tabular-nums">
              {rows.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            aria-label="Close"
            className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-hairline text-slate-400 hover:bg-white/10 hover:text-slate-100 transition"
          >
            <span className="text-sm leading-none">✕</span>
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-400">
          No solutions match your search.
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={syncRail}
          data-testid="folder-dropdown-scroll"
          className="overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin]"
          style={{ maxHeight: scrollMaxHeight }}
        >
          <div>
            {/* HEADER */}
            <div
              className="
                grid sticky top-0 z-10
                bg-slate-950/80 backdrop-blur
                text-slate-400 font-semibold uppercase tracking-[0.04em]
                border-b border-hairline
              "
              data-testid="folder-dropdown-header"
              style={{ gridTemplateColumns: gridCols, height: HEAD_H }}
            >
              {headerCells.map((label, i) => (
                <div
                  key={`h-${i}-${label}`}
                  className={`text-[10px] leading-none px-0.5 flex items-center justify-center ${cellBorderR(
                    i
                  )}`}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* ROWS */}
            <div className="grid" style={{ gridTemplateColumns: gridCols }}>
              {rows.map(({ folder, idx, stacks, avg }) => {
                const active = idx === hi;
                /* Background and text stay in separate strings: these and
                   `text-accent` on the avg cell are all single-class utilities,
                   so a text colour bundled with the background would let the
                   cascade, not class order, decide the winner. */
                const rowBg = active ? "bg-accent/12" : "hover:bg-white/5";
                const rowText = active ? "text-slate-100" : "text-slate-300";
                const choose = () => onChoose(folder);
                const enter = () => setHi(idx);
                const tags = tagsFor(folder);
                const locked = lockedSet?.has(folder) ?? false;

                return (
                  <React.Fragment key={folder}>
                    {/* MOBILE inline tag cell (desktop uses the external rail) */}
                    {isMobile && (
                      <div
                        className={`${CELL_TEXT} px-0.5 border-t border-white/5 ${cellBorderR(
                          0
                        )} ${rowBg} cursor-pointer flex items-center justify-center`}
                        style={{ height: ROW_H }}
                        onMouseDown={choose}
                        onMouseEnter={enter}
                        title={locked ? "Locked - subscribe to open" : tags.join(" ") || undefined}
                      >
                        <RailChip tag={tags[0]} locked={locked} />
                      </div>
                    )}

                    {/* AVG */}
                    <div
                      className={`${CELL_TEXT} px-0.5 border-t border-white/5 ${cellBorderR(
                        isMobile ? 1 : 0
                      )} ${rowBg} cursor-pointer flex items-center justify-center tabular-nums font-semibold text-accent`}
                      data-testid="row-avg"
                      data-row={idx}
                      style={{
                        height: ROW_H,
                        boxShadow: active ? "inset 2px 0 0 var(--color-accent)" : undefined,
                      }}
                      onMouseDown={choose}
                      onMouseEnter={enter}
                    >
                      {avg}
                    </div>

                    {/* SEATS */}
                    {header.map((pos, i) => (
                      <div
                        key={`${folder}-${pos}`}
                        className={`${CELL_TEXT} px-0.5 border-t border-white/5 ${cellBorderR(
                          (isMobile ? 2 : 1) + i
                        )} ${rowBg} ${rowText} cursor-pointer flex items-center justify-center tabular-nums`}
                        style={{ height: ROW_H }}
                        onMouseDown={choose}
                        onMouseEnter={enter}
                      >
                        {stacks[pos] ?? <span className="text-slate-600">-</span>}
                      </div>
                    ))}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {open && placement && (
        <>
          {isMobile && (
            <motion.div
              key="backdrop"
              data-testid="folder-dropdown-backdrop"
              className="fixed inset-0 z-[1290] bg-black/50"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onMouseDown={() => onClose?.()}
              aria-hidden="true"
            />
          )}

          <motion.div
            key="window"
            data-testid="folder-dropdown"
            className="fixed z-[1300]"
            style={{ top: elementTop, left: elementLeft, width: elementWidth }}
            initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.985 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onMouseDown={(e) => e.preventDefault()}
            role="dialog"
            aria-modal={isMobile}
            aria-label="Preflop solutions"
          >
            {isMobile ? (
              panel
            ) : (
              <div className="relative" style={{ paddingLeft: railFootprint }}>
                {/* TAG RAIL — beside the panel, clipped to it, scrolled in step.
                    Absolute offsets resolve against the padding box, so `left: 0`
                    lands outside the panel rather than behind it. */}
                {rows.length > 0 && (
                  <div
                    className="absolute overflow-hidden"
                    data-testid="folder-dropdown-rail"
                    style={{
                      left: 0,
                      width: RAIL_W,
                      top: PANEL_BORDER + HEAD_H,
                      bottom: PANEL_BORDER,
                    }}
                  >
                    <div ref={railTrackRef} className="will-change-transform">
                      {rows.map(({ folder, idx }) => {
                        const tags = tagsFor(folder);
                        const locked = lockedSet?.has(folder) ?? false;
                        return (
                          <div
                            key={`rail-${folder}`}
                            className="relative flex items-center justify-end pr-1 cursor-pointer"
                            data-testid="rail-slot"
                            data-row={idx}
                            style={{ height: ROW_H }}
                            onMouseDown={() => onChoose(folder)}
                            onMouseEnter={() => setHi(idx)}
                            title={
                              locked
                                ? `Locked - subscribe to open${
                                    tags.length ? ` · ${tags.join(" ")}` : ""
                                  }`
                                : tags.join(" ") || undefined
                            }
                          >
                            <RailChip tag={tags[0]} locked={locked} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {panel}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default FolderSelectorDropdown;
