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
import MoneyToggle from "../MoneyToggle";
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
  potCommitted,
  activePlayer,
  actualPot,
  isICMSim,
  randomFillEnabled,
  heightMode,
  reachByFile,
  onActionClick,
  windowWidth,
  windowHeight,
  board,
  onPlateContentRef,
  seatNames,
  tableSeatsOverride,
  money,
}: SingleRangeViewProps) => {
  const container = useElementSize<HTMLDivElement>({ hysteresis: 6 });
  const { ref: wrapRef, top, bottomInset } = useTopOffset();
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

  /* Bet labels carry the solve's money; the colour ramp is calibrated in
   * big blinds, so tell it how much money makes one. */
  const sizeRef = money?.bbSize && money.bbSize > 0 ? money.bbSize : 1;
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
  /* Everything in the range box other than the square matrix: the mt-1 above
   * the ColorKey (4px) plus the ColorKey itself (a fixed 23px row plus
   * mb-0.5 - it never wraps, its boxes shrink instead). The matrix is exactly
   * rangeW tall now that the box carries no padding of its own. */
  const BOX_EXTRA = 29;
  /* Chrome the budget would otherwise ignore and then overrun: this view's own
   * py-2 root padding, and whatever the page reserves beneath it. Both were
   * missing here, which is why the grid pushed the page into a short scroll
   * even though it is meant to fit exactly. */
  const ROOT_PY = 16;
  const belowTableH =
    vh - effTop - ROOT_PY - bottomInset - tableH - GAP_BELOW_TABLE;
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
        <div className="relative flex-shrink-0" style={{ width: tableW }}>
          <MoneyToggle money={money} className="absolute -top-1 right-0 z-20" />
          <PokerTable
            size={tableSeatsOverride?.length ?? positions.length}
            seats={tableSeatsOverride ?? tableSeats}
            className="w-full"
            maxWidthClassName="max-w-none"
            aspectClassName="aspect-[7/5]"
            potAmount={actualPot != null ? Math.max(0, actualPot) : undefined}
            potLabel={
              actualPot != null ? solverPotLabel(actualPot, board, money) : undefined
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
          className="relative flex-shrink-0"
          style={{ width: rangeW }}
        >
          <div className="relative w-full" style={{ aspectRatio: "1 / 1" }}>
            <DecisionMatrix
              money={money}
              gridData={activeGrid}
              randomFillEnabled={randomFillEnabled && !!activeData}
              isICMSim={isICMSim}
              heightMode={heightMode}
              reachByHand={
                activeFile ? reachByFile?.[activeFile] ?? null : null
              }
            />
          </div>

          <div className="mt-1 w-full">
            <ColorKey
              sizeRef={sizeRef}
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
