// Desktop (>=1024px) single-range "study" layout: the active player's big
// range matrix on the left; poker table, action summary, and per-combo hand
// breakdown stacked in a right column. Mobile uses SingleRangeMobileView's
// stacked layout instead; this component is desktop-only (rendered by
// views/SingleRangeDesktopView).
import React, { useState } from "react";
import LoadingIndicator from "@/components/LoadingIndicator";
import PokerTable, { type PokerTableSeat } from "@/components/PokerTable";
import { HandCellData } from "@/lib/solver/utils";
import DecisionMatrix from "./DecisionMatrix";
import ActionSummary from "./ActionSummary";
import HandBreakdown from "./HandBreakdown";
import SolverTableCenter from "./SolverTableCenter";
import { boardCardWidth, solverPotLabel } from "./boardDisplay";

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
  onActionClick: (action: string, file: string) => void;

  /** Measured content width (px) and viewport height / chrome offset. */
  baseW: number;
  viewH: number;
  topOffset: number;
}

const GAP = 16;

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
  onActionClick,
  baseW,
  viewH,
  topOffset,
}) => {
  /* The hand class whose combos the breakdown shows: follows the pointer
   * across matrix cells and sticks to the last one hovered. */
  const [selectedHand, setSelectedHand] = useState<string | null>(null);

  /* Concrete pixel sizes: the matrix wants to be as large as the viewport
   * height allows, the right column takes what's left (clamped legible). */
  const effTop = topOffset > 0 ? topOffset : viewH * 0.2;
  const availH = Math.max(320, viewH - effTop - 16);
  let matrixSize = Math.round(Math.max(360, Math.min(baseW * 0.56, availH, 860)));
  let rightW = baseW - matrixSize - GAP;
  if (rightW < 300) {
    rightW = 300;
    matrixSize = Math.max(360, baseW - 300 - GAP);
  }
  rightW = Math.min(rightW, 620);

  const tableW = Math.min(rightW, 440);

  return (
    <div className="relative flex w-full justify-center py-2">
      {/* Loading overlay across both columns */}
      <div
        className={`absolute inset-0 z-50 flex items-center justify-center transition-opacity duration-100 ${
          loading ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <LoadingIndicator />
      </div>

      <div className="flex items-stretch justify-center" style={{ gap: GAP }}>
        {/* Active player's range matrix */}
        <div
          className="flex-shrink-0 self-start rounded-[9px] border border-emerald-400 bg-white/20 p-2 shadow-md"
          style={{ width: matrixSize }}
        >
          <div className="relative w-full" style={{ aspectRatio: "1 / 1" }}>
            <DecisionMatrix
              gridData={activeGrid}
              randomFillEnabled={randomFillEnabled && activeDataLoaded}
              isICMSim={isICMSim}
              onHandHover={setSelectedHand}
            />
          </div>
        </div>

        {/* Table + action summary + hand breakdown */}
        <div
          className="flex min-w-0 flex-shrink-0 flex-col gap-3"
          style={{ width: rightW, height: matrixSize }}
        >
          <div className="mx-auto w-full flex-shrink-0" style={{ width: tableW }}>
            <PokerTable
              size={seatCount}
              seats={tableSeats}
              className="w-full"
              maxWidthClassName="max-w-none"
              aspectClassName="aspect-[7/5]"
              potAmount={pot != null ? Math.max(0, pot) : undefined}
              potLabel={pot != null ? solverPotLabel(pot, board) : undefined}
              center={
                board && board.length > 0 ? (
                  <SolverTableCenter board={board} cardWidth={boardCardWidth(tableW)} />
                ) : undefined
              }
            />
          </div>

          <ActionSummary
            data={activeGrid}
            loading={!activeDataLoaded}
            onActionClick={(action) => activeFile && onActionClick(action, activeFile)}
          />

          <HandBreakdown
            data={activeGrid}
            hand={selectedHand}
            board={board}
            loading={!activeDataLoaded}
            className="min-h-0 flex-1"
          />
        </div>
      </div>
    </div>
  );
};

export default SingleRangeStudy;
