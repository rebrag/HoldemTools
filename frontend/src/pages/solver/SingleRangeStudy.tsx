// Desktop (>=1024px) single-range "study" layout: the active player's big
// range matrix on the left; poker table, action summary, and per-combo hand
// breakdown stacked in a right column. Mobile uses SingleRangeMobileView's
// stacked layout instead; this component is desktop-only (rendered by
// views/SingleRangeDesktopView).
import React from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import PokerTable, { TABLE_ASPECT, type PokerTableSeatData } from "@/components/PokerTable";
import { HandCellData } from "@/lib/solver/utils";
import type { ComboDetail } from "@/lib/solver/comboDetail";
import type { MatrixHeightMode } from "@/lib/solver/matrixHeight";
import type { MatrixDisplayMode } from "@/lib/solver/matrixDisplayMode";
import type { NodeStats } from "@/lib/solver/nodeStats";
import useStudyState from "./useStudyState";
import SeatStatsPanel from "./SeatStatsPanel";
import DecisionMatrix from "./DecisionMatrix";
import MatrixDisplayModeSelect from "./MatrixDisplayModeSelect";
import { MatrixHeightModePill } from "./FolderSelector";
import ActionSummary from "./ActionSummary";
import HandBreakdown from "./HandBreakdown";
import SolverTableCenter from "./SolverTableCenter";
import { useSeatNavigation, type SeatNavTarget } from "./seatNavigation";
import { solverPotLabel, type MoneyDisplay } from "./boardDisplay";

interface SingleRangeStudyProps {
  tableSeats: PokerTableSeatData[];
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
  /** Click-to-navigate for the table's seats — see seatNavigation.ts. */
  seatNav?: (pos: string) => SeatNavTarget | null;
  /** Display label of the action actually taken in the hand, badged PLAYED
   *  on the action summary. */
  playedAction?: string | null;

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
/* The right column takes every pixel the (height-bound, square) matrix leaves,
 * so the pair fills the window the way GTO Wizard's does and stays flush with
 * the top strip; only past RIGHT_MAX (an ultra-wide monitor) is anything left
 * over to centre. */
const RIGHT_MIN = 300;
const RIGHT_MAX = 1400;
/* From this width the column stops stacking the table over the action
 * summary and puts them side by side instead: a 500px table centred in a
 * 900px column would just move the dead space inside the column. */
const WIDE_RIGHT = 720;
const TABLE_MAX_STACKED = 520;
const TABLE_MAX_WIDE = 560;
const TABLE_SHARE_WIDE = 0.6; // of the column's width, when side by side
const TABLE_SHARE_H = 0.55; // of the column's height, either arrangement
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
  seatNav,
  playedAction,
  baseW,
  viewH,
  topOffset,
  bottomInset = 0,
}) => {
  /* Bet labels carry the solve's money; the colour ramp is calibrated in
   * big blinds, so tell it how much money makes one. */
  const sizeRef = money?.bbSize && money.bbSize > 0 ? money.bbSize : 1;

  /* Clicking a seat walks the preflop tree to that player's decision, the same
   * way the Line strip's cards do. */
  const { seats: navSeats, onSeatClick } = useSeatNavigation(tableSeats, seatNav);

  /* Pin/hover, auto-pin seeding, display-mode fallback, and matrix display
   * data - shared with the mobile dock via useStudyState. */
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

  const wide = rightW >= WIDE_RIGHT;
  /* The table also yields to the column's height: past TABLE_SHARE_H of it
   * the hands grid underneath would be too short to show a class's combos,
   * which on a 1280x800 laptop is what a 520px table would do. */
  const colH = matrixSize + HDR_H;
  const tableHCap = Math.round(colH * TABLE_SHARE_H * TABLE_ASPECT);
  const tableW = wide
    ? Math.min(TABLE_MAX_WIDE, Math.round(rightW * TABLE_SHARE_WIDE), tableHCap)
    : Math.min(rightW, TABLE_MAX_STACKED, tableHCap);
  /* The table's rendered height: the side-by-side row is sized to it so the
   * action column beside it stretches to exactly the table's bottom edge. */
  const tableH = Math.round(tableW / TABLE_ASPECT);

  const table = (
    <PokerTable
      moneyToggle={money}
      size={seatCount}
      seats={navSeats}
      onSeatClick={onSeatClick}
      className="w-full"
      maxWidthClassName="max-w-none"
      potAmount={pot != null ? Math.max(0, pot) : undefined}
      potLabel={pot != null ? solverPotLabel(pot, money) : undefined}
      center={
        board && board.length > 0
          ? ({ cardWidth }) => <SolverTableCenter board={board} cardWidth={cardWidth} />
          : undefined
      }
    />
  );
  const stats = (
    <SeatStatsPanel
      stats={nodeStats ?? null}
      actorSeat={actorSeat}
      names={seatNames}
      money={money}
    />
  );
  const actions = (vertical: boolean) => (
    <ActionSummary
      sizeRef={sizeRef}
      data={activeGrid}
      loading={!activeDataLoaded}
      vertical={vertical}
      onActionClick={(action) => activeFile && onActionClick(action, activeFile)}
      playedAction={playedAction}
    />
  );

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
              onHandSelect={onHandSelect}
              onHandHover={onHandHover}
            />
          </div>
        </div>

        {/* Table + seat stats + action summary + hand breakdown. Narrow
            columns stack all four; wide ones (see WIDE_RIGHT) seat the stats
            and the vertical action panels beside the table, and the hands
            grid gets the whole width below. */}
        <div
          data-testid="study-right-column"
          data-arrangement={wide ? "wide" : "stacked"}
          className="flex min-w-0 flex-shrink-0 flex-col gap-3"
          style={{ width: rightW, height: matrixSize + HDR_H }}
        >
          {wide ? (
            <div className="flex flex-shrink-0 items-stretch gap-3" style={{ height: tableH }}>
              <div className="relative flex-shrink-0" style={{ width: tableW }}>
                {table}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                {stats}
                <div className="min-h-0 flex-1">{actions(true)}</div>
              </div>
            </div>
          ) : (
            <>
              <div className="relative mx-auto flex-shrink-0" style={{ width: tableW }}>
                {table}
              </div>
              {stats}
              {actions(false)}
            </>
          )}

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
