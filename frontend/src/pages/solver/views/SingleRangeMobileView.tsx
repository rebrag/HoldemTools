// views/SingleRangeMobileView.tsx
//
// Mobile single-range "tabbed dock" layout: everything the desktop study view
// shows, folded into a portrait phone without scrolling the page. Top to
// bottom: the Table / Stats / Hands dock (table by default), the matrix
// controls, then the decision matrix with the clickable action buttons
// stacked vertically beside it - matrix + actions together span the full
// width. Widths need concrete pixel values - the PokerTable's aspect-ratio
// box collapses without a definite ancestor width.
import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import useElementSize from "@/hooks/useElementSize";
import LoadingOverlay from "@/components/LoadingOverlay";
import PokerTable from "@/components/PokerTable";
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
import { boardCardWidth, solverPotLabel } from "../boardDisplay";
import useActiveRange from "./useActiveRange";
import useTopOffset from "./useTopOffset";
import type { SingleRangeMobileViewProps } from "./types";

type DockTab = "table" | "stats" | "hands";

const DOCK_TABS: { key: DockTab; label: string }[] = [
  { key: "table", label: "Table" },
  { key: "stats", label: "Stats" },
  { key: "hands", label: "Hands" },
];

/* ── layout budget (px) ───────────────────────────────────────────────── */
const SIDE_PAD = 20;
const CTRL_H = 36; // the pills' `compact` h-9
const SEG_H = 30; // segmented control
const GAP = 8; // vertical gap between the stacked rows
const MIN_DOCK = 150; // the dock never shrinks below a usable panel
const ACTION_MIN_W = 84; // the action column's legibility floor
const ROOT_PY = 16; // this view's own py-2

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
   * sized so the dock keeps at least MIN_DOCK; the dock is the column's flex
   * remainder, so a row rendering a few pixels off its budgeted constant
   * shrinks the dock instead of scrolling the page. */
  const effTop = top > 0 ? top : vh * 0.3;
  const FIXED_CHROME = SEG_H + CTRL_H + GAP * 3;
  const availH = Math.max(320, vh - effTop - ROOT_PY - bottomInset);
  const matrixSize = Math.round(
    Math.max(
      200,
      Math.min(
        availW - ACTION_MIN_W - GAP,
        availH - FIXED_CHROME - MIN_DOCK,
        560
      )
    )
  );
  /* The action column takes whatever width the (usually height-bound) square
   * matrix leaves, so the pair always spans the full row. */
  const actionW = Math.max(ACTION_MIN_W, availW - matrixSize - GAP);
  const dockH = Math.round(
    Math.max(MIN_DOCK, availH - FIXED_CHROME - matrixSize)
  );
  const tableW = Math.min(availW, Math.floor((dockH * 7) / 5));

  const potLabel =
    actualPot != null ? solverPotLabel(actualPot, money) : undefined;

  return (
    <div ref={wrapRef} className="relative flex justify-center py-2 w-full">
      <div
        ref={container.ref}
        className="relative z-10 flex w-full flex-col items-center"
        style={{ gap: GAP, height: availH }}
      >
        {/* Loading */}
        <LoadingOverlay active={loading} />

        {/* Dock: Table / Stats / Hands, above the matrix */}
        <SegmentedControl
          options={DOCK_TABS}
          value={tab}
          onChange={setTab}
          className="flex-shrink-0"
        />
        {/* The dock is the column's flex remainder (nominally dockH): if any
            fixed row renders taller than budgeted, the dock absorbs it. */}
        <div
          data-testid="mobile-dock"
          className="relative min-h-0 flex-1 overflow-y-auto"
          style={{ width: availW }}
        >
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
                <div
                  className="relative mx-auto flex-shrink-0"
                  style={{ width: tableW }}
                >
                  <PokerTable
                    size={tableSeatsOverride?.length ?? positions.length}
                    seats={navSeats}
                    onSeatClick={onSeatClick}
                    className="w-full"
                    maxWidthClassName="max-w-none"
                    aspectClassName="aspect-[7/5]"
                    moneyToggle={money}
                    potAmount={
                      actualPot != null ? Math.max(0, actualPot) : undefined
                    }
                    potLabel={potLabel}
                    center={
                      board && board.length > 0 ? (
                        <SolverTableCenter
                          board={board}
                          cardWidth={boardCardWidth(tableW)}
                        />
                      ) : undefined
                    }
                  />
                </div>
              ) : tab === "stats" ? (
                nodeStats ? (
                  <SeatStatsPanel
                    stats={nodeStats}
                    actorSeat={actorSeat}
                    names={seatNames}
                    money={money}
                  />
                ) : (
                  <p className="px-2 py-4 text-center text-[11px] text-slate-400">
                    Range-wide EV, equity, and combo counts appear here inside
                    a postflop solve.
                  </p>
                )
              ) : (
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
              )}
            </motion.div>
          </AnimatePresence>
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
