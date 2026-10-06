// views/SingleRangeMobileView.tsx
//
// Mobile single-range "dock" layout: everything the desktop study view shows,
// folded into a viewport narrower than the desktop breakpoint without
// scrolling the page. Top to bottom: the dock (table, seat stats, per-combo
// hands), the matrix controls, then the decision matrix with the clickable
// action buttons stacked vertically beside it - matrix + actions together
// span the full width. Widths need concrete pixel values - the PokerTable's
// aspect-ratio box collapses without a definite ancestor width.
//
// The dock adapts to the room it gets (see `DockArrangement`): a phone shows
// one panel at a time behind Table / Stats / Hands tabs, while a portrait
// tablet or a tall window - where that single panel would float in empty
// backdrop - shows the table with the stats and hands beside or below it, the
// way the desktop study does, and drops the tabs.
import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import useElementSize from "@/hooks/useElementSize";
import LoadingOverlay from "@/components/LoadingOverlay";
import PokerTable, { TABLE_ASPECT } from "@/components/PokerTable";
import SegmentedControl from "@/components/SegmentedControl";
import DecisionMatrix from "../DecisionMatrix";
import SolverTableCenter from "../SolverTableCenter";
import MatrixDisplayModeSelect from "../MatrixDisplayModeSelect";
import { MatrixHeightModePill } from "../FolderSelector";
import SeatStatsPanel from "../SeatStatsPanel";
import ActionSummary from "../ActionSummary";
import HandBreakdown from "../HandBreakdown";
import useStudyState from "../useStudyState";
import { useSeatNavigation } from "../seatNavigation";
import { solverPotLabel } from "../boardDisplay";
import useActiveRange from "./useActiveRange";
import useTopOffset from "./useTopOffset";
import type { SingleRangeMobileViewProps } from "./types";

type DockTab = "table" | "stats" | "hands";

const DOCK_TABS: { key: DockTab; label: string }[] = [
  { key: "table", label: "Table" },
  { key: "stats", label: "Stats" },
  { key: "hands", label: "Hands" },
];

/** How the dock lays out its panels, decided from the pixel budget below.
 *  `wide`: table on the left, stats + hands in a column beside it.
 *  `tall`: table on top, stats + hands below it.
 *  `tabs`: one panel at a time behind the segmented control (phones). */
type DockArrangement = "wide" | "tall" | "tabs";

/* ── layout budget (px) ───────────────────────────────────────────────── */
const SIDE_PAD = 20;
const CTRL_H = 36; // the pills' `compact` h-9
const SEG_H = 30; // segmented control (tabs arrangement only)
const GAP = 8; // vertical gap between the stacked rows
/* The dock never shrinks below a usable panel: an absolute floor for short
 * phones, and a share of the height on taller viewports, so a portrait tablet
 * does not hand the matrix its cap and starve the dock down to a toy table. */
const MIN_DOCK = 150;
const DOCK_SHARE = 0.32;
const ACTION_MIN_W = 84; // the action column's legibility floor
const ROOT_PY = 16; // this view's own py-2
/* The stats + hands column beside (wide) or under (tall) the table. */
const PANEL_MIN_W = 260;
const PANEL_MIN_H = 160;
const TABLE_SHARE_WIDE = 0.6; // of the dock width, when beside the panel

const SingleRangeMobileView = ({
  files,
  positions,
  plateData,
  loading,
  alivePlayers,
  playerBets,
  potCommitted,
  activePlayer,
  actualPot,
  isICMSim,
  randomFillEnabled,
  heightMode,
  onHeightModeChange,
  displayMode,
  onDisplayModeChange,
  reachByFile,
  onActionClick,
  windowWidth,
  windowHeight,
  board,
  comboDetail,
  nodeStats,
  chipScale,
  actorSeat,
  seatNames,
  tableSeatsOverride,
  money,
  autoPinBySeat,
  seatNav,
  playedAction,
}: SingleRangeMobileViewProps) => {
  const container = useElementSize<HTMLDivElement>({ hysteresis: 6 });
  const { ref: wrapRef, top, bottomInset } = useTopOffset();
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<DockTab>("table");

  const { activeFile, activeData, activeGrid, tableSeats } = useActiveRange({
    positions,
    files,
    plateData,
    alivePlayers,
    playerBets,
    potCommitted,
    activePlayer,
    seatNames,
    money,
  });

  /* Tapping a seat walks the preflop tree to that player's decision, the same
   * way the Line strip's cards do. */
  const { seats: navSeats, onSeatClick } = useSeatNavigation(
    tableSeatsOverride ?? tableSeats,
    seatNav
  );

  /* Pin/hover, auto-pin seeding, display-mode fallback, and matrix display
   * data - identical behavior to the desktop study view. */
  const {
    pinnedHand,
    shownHand,
    highlightCombo,
    onHandSelect,
    onHandHover,
    equityAvailable,
    effectiveMode,
    displayData,
  } = useStudyState({
    activePlayer,
    autoPinBySeat,
    displayMode,
    comboDetail,
    activeGrid,
    board,
  });

  /* Bet labels carry the solve's money; the colour ramp is calibrated in
   * big blinds, so tell it how much money makes one. */
  const sizeRef = money?.bbSize && money.bbSize > 0 ? money.bbSize : 1;
  const vh = windowHeight || 640;
  /* Clamped to the live viewport, not just taken from the container. Every
   * row below turns this into an inline pixel width, and the wrapper centres
   * them - so a measurement that outlives the viewport it was taken in does
   * not merely overflow, it hangs half the matrix off the left edge where no
   * scroll can reach it. The measurement is the fast path; the viewport is
   * the ceiling it can never exceed. */
  const baseW = Math.min(container.width || windowWidth, windowWidth);
  const availW = Math.max(200, baseW - SIDE_PAD * 2);

  /* Height budget: the matrix row (matrix + action column, full width) is
   * sized so the dock keeps at least its minimum; the dock is the column's
   * flex remainder, so a row rendering a few pixels off its budgeted constant
   * shrinks the dock instead of scrolling the page. */
  const effTop = top > 0 ? top : vh * 0.3;
  const CHROME_TABS = SEG_H + CTRL_H + GAP * 3;
  const availH = Math.max(320, vh - effTop - ROOT_PY - bottomInset);
  const dockMin = Math.max(MIN_DOCK, Math.round(availH * DOCK_SHARE));
  const matrixSize = Math.round(
    Math.max(
      200,
      Math.min(
        availW - ACTION_MIN_W - GAP,
        availH - CHROME_TABS - dockMin,
        560
      )
    )
  );
  /* The action column takes whatever width the (usually height-bound) square
   * matrix leaves, so the pair always spans the full row. */
  const actionW = Math.max(ACTION_MIN_W, availW - matrixSize - GAP);

  /* The dock's arrangement is decided with the tabs row budgeted in; the two
   * arrangements that drop the tabs get its height back. A table that fills
   * the dock on its own (every real phone) keeps the tabs; room beside it
   * seats the stats + hands column there, room below seats it underneath. */
  const dockH0 = Math.round(Math.max(MIN_DOCK, availH - CHROME_TABS - matrixSize));
  const tableFitW = Math.min(availW, Math.floor(dockH0 * TABLE_ASPECT));
  const tableFitH = Math.round(tableFitW / TABLE_ASPECT);
  const arrangement: DockArrangement =
    availW - tableFitW - GAP >= PANEL_MIN_W
      ? "wide"
      : dockH0 - tableFitH >= PANEL_MIN_H
      ? "tall"
      : "tabs";
  const dockH = arrangement === "tabs" ? dockH0 : dockH0 + SEG_H + GAP;
  const tableW =
    arrangement === "wide"
      ? Math.min(
          Math.floor(dockH * TABLE_ASPECT),
          availW - PANEL_MIN_W - GAP,
          Math.round(availW * TABLE_SHARE_WIDE)
        )
      : arrangement === "tall"
      ? Math.min(availW, Math.floor((dockH - PANEL_MIN_H - GAP) * TABLE_ASPECT))
      : tableFitW;

  const potLabel =
    actualPot != null ? solverPotLabel(actualPot, money) : undefined;

  const table = (
    <div className="relative flex-shrink-0" style={{ width: tableW }}>
      <PokerTable
        size={tableSeatsOverride?.length ?? positions.length}
        seats={navSeats}
        onSeatClick={onSeatClick}
        className="w-full"
        maxWidthClassName="max-w-none"
        moneyToggle={money}
        potAmount={actualPot != null ? Math.max(0, actualPot) : undefined}
        potLabel={potLabel}
        center={
          board && board.length > 0
            ? ({ cardWidth }) => (
                <SolverTableCenter board={board} cardWidth={cardWidth} />
              )
            : undefined
        }
      />
    </div>
  );
  const stats = (
    <SeatStatsPanel
      stats={nodeStats ?? null}
      actorSeat={actorSeat}
      names={seatNames}
      money={money}
    />
  );
  const hands = (
    <HandBreakdown
      sizeRef={sizeRef}
      data={activeGrid}
      hand={shownHand}
      board={board}
      highlightCombo={highlightCombo}
      comboDetail={comboDetail}
      displayMode={effectiveMode}
      evRange={displayData?.evRange ?? null}
      chipEv={nodeStats?.chipEv}
      chipScale={chipScale}
      money={money}
      loading={!activeData}
      className="min-h-0 flex-1"
    />
  );
  /* Stats over hands, as the desktop column stacks them. SeatStatsPanel
   * renders nothing outside a postflop solve, so preflop this is the hands
   * grid alone. */
  const panel = (
    <div className="flex min-h-0 w-full flex-1 flex-col" style={{ gap: GAP }}>
      {stats}
      {hands}
    </div>
  );

  return (
    <div ref={wrapRef} className="relative flex justify-center py-2 w-full">
      <div
        ref={container.ref}
        className="relative z-10 flex w-full flex-col items-center"
        style={{ gap: GAP, height: availH }}
      >
        {/* Loading */}
        <LoadingOverlay active={loading} />

        {/* Dock: Table / Stats / Hands, above the matrix. The tabs exist only
            when the dock has room for one panel at a time. */}
        {arrangement === "tabs" && (
          <SegmentedControl
            options={DOCK_TABS}
            value={tab}
            onChange={setTab}
            className="flex-shrink-0"
          />
        )}
        {/* The dock is the column's flex remainder (nominally dockH): if any
            fixed row renders taller than budgeted, the dock absorbs it. */}
        <div
          data-testid="mobile-dock"
          data-arrangement={arrangement}
          className="relative min-h-0 flex-1 overflow-y-auto"
          style={{ width: availW }}
        >
          {arrangement === "wide" ? (
            <div className="flex h-full min-h-0 items-stretch" style={{ gap: GAP }}>
              <div className="self-start">{table}</div>
              {panel}
            </div>
          ) : arrangement === "tall" ? (
            <div className="flex h-full min-h-0 flex-col items-center" style={{ gap: GAP }}>
              {table}
              {panel}
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                className="flex h-full min-h-0 flex-col"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {tab === "table" ? (
                  /* A width-bound table can be a little shorter than the
                     dock; centre it rather than leave the slack below it. */
                  <div className="m-auto">{table}</div>
                ) : tab === "stats" ? (
                  nodeStats ? (
                    stats
                  ) : (
                    <p className="px-2 py-4 text-center text-[11px] text-slate-400">
                      Range-wide EV, equity, and combo counts appear here inside
                      a postflop solve.
                    </p>
                  )
                ) : (
                  hands
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/* Matrix controls. z-[60] clears the loading overlay (z-50), which
            stays interactive while a plate loads and would eat taps. */}
        <div
          className="relative z-[60] flex flex-shrink-0 items-center gap-1.5"
          style={{ width: availW, height: CTRL_H }}
        >
          <MatrixDisplayModeSelect
            mode={effectiveMode}
            onChange={(m) => onDisplayModeChange?.(m)}
            equityAvailable={equityAvailable}
          />
          {heightMode && onHeightModeChange && (
            <MatrixHeightModePill
              heightMode={heightMode}
              onChange={onHeightModeChange}
              compact
              align="left"
            />
          )}
        </div>

        {/* Decision matrix + vertical action buttons, spanning the full width */}
        <div
          className="flex flex-shrink-0 items-stretch"
          style={{ width: availW, gap: GAP }}
        >
          <div className="relative flex-shrink-0" style={{ width: matrixSize }}>
            <div className="relative w-full" style={{ aspectRatio: "1 / 1" }}>
              <DecisionMatrix
                money={money}
                gridData={activeGrid}
                randomFillEnabled={randomFillEnabled && !!activeData}
                isICMSim={isICMSim}
                heightMode={heightMode}
                reachByHand={activeFile ? reachByFile?.[activeFile] ?? null : null}
                displayData={displayData}
                selectedHand={pinnedHand}
                onHandSelect={onHandSelect}
                onHandHover={onHandHover}
              />
            </div>
          </div>
          <div
            className="min-w-0 flex-1"
            style={{ width: actionW, height: matrixSize }}
          >
            <ActionSummary
              sizeRef={sizeRef}
              data={activeGrid}
              loading={!activeData}
              compact
              vertical
              onActionClick={(action) =>
                activeFile && onActionClick(action, activeFile)
              }
              playedAction={playedAction}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SingleRangeMobileView;
