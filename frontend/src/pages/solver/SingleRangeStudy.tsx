// Desktop (>=1024px) single-range "study" layout: the active player's big
// range matrix on the left; poker table, action summary, and per-combo hand
// breakdown stacked in a right column. Mobile uses SingleRangeMobileView's
// stacked layout instead; this component is desktop-only (rendered by
// views/SingleRangeDesktopView).
import React, { useEffect, useMemo, useState } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import PokerTable, { type PokerTableSeat } from "@/components/PokerTable";
import { HandCellData } from "@/lib/solver/utils";
import type { ComboDetail } from "@/lib/solver/comboDetail";
import type { MatrixHeightMode } from "@/lib/solver/matrixHeight";
import {
  buildMatrixDisplayData,
  type MatrixDisplayMode,
} from "@/lib/solver/matrixDisplayMode";
import type { NodeStats } from "@/lib/solver/nodeStats";
import SeatStatsPanel from "./SeatStatsPanel";
import DecisionMatrix from "./DecisionMatrix";
import MatrixDisplayModeSelect from "./MatrixDisplayModeSelect";
import { MatrixHeightModePill, SingleRangeTogglePill } from "./FolderSelector";
import ActionSummary from "./ActionSummary";
import HandBreakdown from "./HandBreakdown";
import SolverTableCenter from "./SolverTableCenter";
import MoneyToggle from "./MoneyToggle";
import { boardCardWidth, solverPotLabel, type MoneyDisplay } from "./boardDisplay";

interface SingleRangeStudyProps {
  tableSeats: PokerTableSeat[];
  seatCount: number;
  /** Chips actually in the pot (excludes bets still in front of players). */
  pot?: number;
  /** Board card codes when in a postflop session: dealt onto the table's
   *  center slot, and used by HandBreakdown to block dead combos. */
  board?: string[];

  activeGrid: HandCellData[];
  activeFile?: string;
  /** True once the active plate's JSON is present. */
  activeDataLoaded: boolean;

  loading: boolean;
  isICMSim?: boolean;
  randomFillEnabled: boolean;
  /** Matrix cell-height mode (GTO Wizard style). */
  heightMode?: MatrixHeightMode;
  /** Cell-height setter: this view's control row owns the pill, rather than
   *  the sim panel (the other layouts keep theirs in FolderSelector). */
  onHeightModeChange?: (mode: MatrixHeightMode) => void;
  /** Single-range toggle. Required: this pill carries the intro tour's
   *  `color-key-btn` target and must always be mounted here. */
  singleRangeView: boolean;
  onToggleSingleRange: () => void;
  /** Saved display mode; may fall back to Strategy when data is missing. */
  displayMode?: MatrixDisplayMode;
  onDisplayModeChange?: (mode: MatrixDisplayMode) => void;
  /** Hand class -> reach 0..1 for the displayed range; null preflop. */
  reachByHand?: Map<string, number> | null;
  onActionClick: (action: string, file: string) => void;

  /** Real per-combo mixes for the displayed range, when available. */
  comboDetail?: ComboDetail | null;
  /** Range-wide per-seat numbers for the current postflop node. */
  nodeStats?: NodeStats | null;
  /** Pio chips per unit of display money (manifest chip_scale; 100 for sims). */
  chipScale?: number;
  /** Seat acting at that node. */
  actorSeat?: string;
  /** Position -> real player name (hand-history solves). */
  seatNames?: Record<string, string>;
  /** Chips/bb display toggle (hand-history solves only). */
  money?: MoneyDisplay;
  /** Seat whose range is on screen; the pinned hand is tracked per seat. */
  activePlayer?: string;
  /** Seat -> the hand that seat held in the recorded hand (hand-history
   *  solves). Seeds the pin when a board is opened. */
  autoPinBySeat?: Record<string, { hand: string; combo: string }>;

  /** Measured content width (px) and viewport height / chrome offset. */
  baseW: number;
  viewH: number;
  topOffset: number;
  /** Page chrome reserved below this view (ancestor padding), from
   *  useTopOffset. Counted so the layout fits the viewport exactly instead of
   *  overrunning it by those few pixels. */
  bottomInset?: number;
}

const GAP = 16;
/* Matrix control row above the matrix. HDR_H feeds both the matrix sizing
 * (`availH - HDR_H`) and the right column's height (`matrixSize + HDR_H`), so
 * it is derived rather than written twice - the two must never drift. */
const HDR_CTRL_H = 36; // the pills' `compact` h-9
const HDR_GAP = 8;
const HDR_H = HDR_CTRL_H + HDR_GAP;
const RIGHT_MIN = 300;
const RIGHT_MAX = 620;
/** This view's own root padding (py-2), which sits inside the measured top. */
const ROOT_PY = 16;

const SingleRangeStudy: React.FC<SingleRangeStudyProps> = ({
  tableSeats,
  seatCount,
  pot,
  board,
  activeGrid,
  activeFile,
  activeDataLoaded,
  loading,
  isICMSim,
  randomFillEnabled,
  heightMode,
  onHeightModeChange,
  singleRangeView,
  onToggleSingleRange,
  displayMode,
  onDisplayModeChange,
  reachByHand,
  onActionClick,
  comboDetail,
  nodeStats,
  chipScale,
  actorSeat,
  seatNames,
  money,
  activePlayer,
  autoPinBySeat,
  baseW,
  viewH,
  topOffset,
  bottomInset = 0,
}) => {
  /* Bet labels carry the solve's money; the colour ramp is calibrated in
   * big blinds, so tell it how much money makes one. */
  const sizeRef = money?.bbSize && money.bbSize > 0 ? money.bbSize : 1;

  /* Which hand the breakdown shows. A click pins a class (and clicking it
   * again unpins); while nothing is pinned the pointer drives the panel, and
   * the last hovered class sticks so the panel doesn't blank every time the
   * pointer leaves the grid. The hover is tracked even while pinned, so
   * unpinning lands on whatever the pointer is over rather than on nothing.
   * A pin is kept across node changes, so stepping through a line follows the
   * same hand.
   *
   * Pins are per seat: a hand-history solve opens on what each player actually
   * held, and OOP's KK has nothing to do with IP's AA, so one shared pin would
   * jump to the wrong cell the moment the range toggle is used. */
  const [pinBySeat, setPinBySeat] = useState<Record<string, string | null>>({});
  const [hoveredHand, setHoveredHand] = useState<string | null>(null);

  /* Seed from the recorded hand whenever a different solve is opened. Keyed on
   * the auto-pin map's identity (a new manifest builds a new one), so it does
   * not fight the user's clicks within a board. */
  useEffect(() => {
    setPinBySeat(
      autoPinBySeat
        ? Object.fromEntries(Object.entries(autoPinBySeat).map(([seat, p]) => [seat, p.hand]))
        : {}
    );
  }, [autoPinBySeat]);

  const seatKey = activePlayer ?? "";
  const pinnedHand = pinBySeat[seatKey] ?? null;
  const shownHand = pinnedHand ?? hoveredHand;
  /* Only point at the exact combo while the pinned class is still the one the
   * player held - once the user picks another cell, there is no combo to
   * single out. */
  const auto = autoPinBySeat?.[seatKey];
  const highlightCombo = auto && auto.hand === shownHand ? auto.combo : null;

  /* Equity needs per-combo data (postflop, acting seat). The saved preference
   * is never overwritten: the effective mode just falls back to Strategy, so
   * navigating back to a postflop node restores Equity by itself. */
  const equityAvailable = !!comboDetail;
  const effectiveMode: MatrixDisplayMode =
    displayMode === "equity" && !equityAvailable
      ? "strategy"
      : displayMode ?? "strategy";

  const displayData = useMemo(
    () => buildMatrixDisplayData(effectiveMode, activeGrid, comboDetail, board),
    [effectiveMode, activeGrid, comboDetail, board]
  );

  /* Concrete pixel sizes: the matrix takes all the viewport height it can
   * (minus its dropdown header row); width only binds when the right column
   * would drop below its legibility floor. */
  const effTop = topOffset > 0 ? topOffset : viewH * 0.2;
  const availH = Math.max(320, viewH - effTop - ROOT_PY - bottomInset);
  const matrixSize = Math.round(
    Math.max(360, Math.min(availH - HDR_H, baseW - RIGHT_MIN - GAP))
  );
  const rightW = Math.min(
    Math.max(baseW - matrixSize - GAP, RIGHT_MIN),
    RIGHT_MAX
  );

  const tableW = Math.min(rightW, 440);

  return (
    <div className="relative flex w-full justify-center py-2">
      {/* Loading overlay across both columns */}
      <LoadingOverlay active={loading} />

      <div className="flex items-stretch justify-center" style={{ gap: GAP }}>
        {/* Active player's range matrix, under its control row */}
        <div
          className="flex flex-shrink-0 flex-col self-start"
          style={{ width: matrixSize }}
        >
          {/* Everything that changes how the matrix draws, grouped directly
              above it. z-[60] clears the loading overlay (z-50), which stays
              interactive while a plate loads and would otherwise eat clicks. */}
          <div
            className="relative z-[60] flex items-center gap-1.5"
            style={{ height: HDR_CTRL_H, marginBottom: HDR_GAP }}
          >
            <MatrixDisplayModeSelect
              mode={effectiveMode}
              onChange={(m) => onDisplayModeChange?.(m)}
              equityAvailable={equityAvailable}
            />
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
                align="left"
              />
            )}
          </div>
          <div className="relative w-full" style={{ aspectRatio: "1 / 1" }}>
            <DecisionMatrix
              money={money}
              gridData={activeGrid}
              randomFillEnabled={randomFillEnabled && activeDataLoaded}
              isICMSim={isICMSim}
              heightMode={heightMode}
              reachByHand={reachByHand}
              displayData={displayData}
              selectedHand={pinnedHand}
              onHandSelect={(hand) =>
                setPinBySeat((prev) => ({
                  ...prev,
                  [seatKey]: prev[seatKey] === hand ? null : hand,
                }))
              }
              onHandHover={setHoveredHand}
            />
          </div>
        </div>

        {/* Table + action summary + hand breakdown */}
        <div
          className="flex min-w-0 flex-shrink-0 flex-col gap-3"
          style={{ width: rightW, height: matrixSize + HDR_H }}
        >
          <div className="relative mx-auto w-full flex-shrink-0" style={{ width: tableW }}>
            <MoneyToggle money={money} className="absolute -top-1 right-0 z-20" />
            <PokerTable
              size={seatCount}
              seats={tableSeats}
              className="w-full"
              maxWidthClassName="max-w-none"
              aspectClassName="aspect-[7/5]"
              potAmount={pot != null ? Math.max(0, pot) : undefined}
              potLabel={pot != null ? solverPotLabel(pot, board, money) : undefined}
              center={
                board && board.length > 0 ? (
                  <SolverTableCenter board={board} cardWidth={boardCardWidth(tableW)} />
                ) : undefined
              }
            />
          </div>

          <SeatStatsPanel
            stats={nodeStats ?? null}
            actorSeat={actorSeat}
            names={seatNames}
            money={money}
          />

          <ActionSummary
            sizeRef={sizeRef}
            data={activeGrid}
            loading={!activeDataLoaded}
            onActionClick={(action) => activeFile && onActionClick(action, activeFile)}
          />

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
            loading={!activeDataLoaded}
            className="min-h-0 flex-1"
          />
        </div>
      </div>
    </div>
  );
};

export default SingleRangeStudy;
