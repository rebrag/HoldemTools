// views/SingleRangeMobileView.tsx
//
// Mobile single-range layout: a full-width landscape (aspect-[7/5]) table
// stacked above a range sized to fill whatever viewport height is left, so
// the whole 13x13 grid + ColorKey stay on-screen without scrolling. Table and
// range widths need concrete pixel values - the PokerTable's aspect-ratio box
// collapses without a definite ancestor width.
import useElementSize from "@/hooks/useElementSize";
import LoadingIndicator from "@/components/LoadingIndicator";
import PokerTable from "@/components/PokerTable";
import DecisionMatrix from "../DecisionMatrix";
import ColorKey from "../ColorKey";
import SolverTableCenter from "../SolverTableCenter";
import { boardCardWidth, solverPotLabel } from "../boardDisplay";
import useActiveRange from "./useActiveRange";
import useTopOffset from "./useTopOffset";
import type { SingleRangeViewProps } from "./types";

const SingleRangeMobileView = ({
  files,
  positions,
  plateData,
  loading,
  alivePlayers,
  playerBets,
  activePlayer,
  actualPot,
  isICMSim,
  randomFillEnabled,
  onActionClick,
  windowWidth,
  windowHeight,
  board,
  onPlateContentRef,
}: SingleRangeViewProps) => {
  const container = useElementSize<HTMLDivElement>({ hysteresis: 6 });
  const { ref: wrapRef, top } = useTopOffset();
  const { activeFile, activeData, activeGrid, tableSeats } = useActiveRange({
    positions,
    files,
    plateData,
    alivePlayers,
    playerBets,
    activePlayer,
  });

  const vh = windowHeight || 640;
  const baseW = container.width || windowWidth;

  // Breathing room on the left/right so table and range don't run
  // edge-to-edge; also makes the table a touch smaller (freeing vertical room
  // for the range).
  const SIDE_PAD = 20;
  const availW = Math.max(200, baseW - SIDE_PAD * 2);
  const tableW = Math.round(availW);

  const tableH = (tableW * 5) / 7; // aspect-[7/5]
  const effTop = top > 0 ? top : vh * 0.3;
  const GAP_BELOW_TABLE = 12; // flex gap-3
  // Range box height ~ rangeW + 29 (p-2 16px y + mt-1 4px + ColorKey ~25px
  // over the square matrix); a little extra so the last row never clips.
  const BOX_EXTRA = 34;
  const belowTableH = vh - effTop - tableH - GAP_BELOW_TABLE;
  const rangeW = Math.round(
    Math.max(200, Math.min(availW, belowTableH - BOX_EXTRA, 560))
  );

  return (
    <div ref={wrapRef} className="relative flex justify-center py-2 w-full">
      <div
        ref={container.ref}
        className="relative z-10 w-full flex flex-col items-center gap-3 sm:gap-5"
      >
        {/* Loading */}
        <div
          className={`absolute inset-0 flex items-center justify-center z-50 transition-opacity duration-100 ${
            loading ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <LoadingIndicator />
        </div>

        {/* Poker table (definite width so it doesn't collapse) */}
        <div className="flex-shrink-0" style={{ width: tableW }}>
          <PokerTable
            size={positions.length}
            seats={tableSeats}
            className="w-full"
            maxWidthClassName="max-w-none"
            aspectClassName="aspect-[7/5]"
            potAmount={actualPot != null ? Math.max(0, actualPot) : undefined}
            potLabel={
              actualPot != null ? solverPotLabel(actualPot, board) : undefined
            }
            center={
              board && board.length > 0 ? (
                <SolverTableCenter board={board} cardWidth={boardCardWidth(tableW)} />
              ) : undefined
            }
          />
        </div>

        {/* Active player's range */}
        <div
          ref={onPlateContentRef}
          className="relative flex-shrink-0 border border-emerald-400 rounded-[9px] shadow-md p-2 bg-white/20"
          style={{ width: rangeW }}
        >
          <div className="relative w-full" style={{ aspectRatio: "1 / 1" }}>
            <DecisionMatrix
              gridData={activeGrid}
              randomFillEnabled={randomFillEnabled && !!activeData}
              isICMSim={isICMSim}
            />
          </div>

          <div className="mt-1 w-full">
            <ColorKey
              data={activeGrid}
              loading={!activeData}
              onActionClick={(action) =>
                activeFile && onActionClick(action, activeFile)
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SingleRangeMobileView;
