// views/SingleRangeDesktopView.tsx
//
// Desktop single-range layout: the GTO Wizard style study view - the active
// player's matrix beside a stacked table / action summary / hand breakdown
// column (rendered by SingleRangeStudy).
import useElementSize from "@/hooks/useElementSize";
import SingleRangeStudy from "../SingleRangeStudy";
import useActiveRange from "./useActiveRange";
import useTopOffset from "./useTopOffset";
import type { SingleRangeDesktopViewProps } from "./types";

const SingleRangeDesktopView = ({
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
  playedAction,
}: SingleRangeDesktopViewProps) => {
  const container = useElementSize<HTMLDivElement>({ hysteresis: 6 });
  const { ref: wrapRef, top: topOffset, bottomInset } = useTopOffset();
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

  const vh = windowHeight || 640;
  // Until the ResizeObserver delivers the real container width, fall back
  // to the viewport minus this wrapper's px-4 + the page's p-1 padding so
  // the first paint never overflows horizontally.
  const studyW = container.width || Math.max(320, windowWidth - 40);

  return (
    <div ref={wrapRef} className="relative w-full px-2 sm:px-4">
      {/* Same max width as the study top strip so the columns align with it. */}
      <div
        ref={container.ref}
        className="relative z-10 mx-auto w-full max-w-[1800px]"
      >
        <SingleRangeStudy
          tableSeats={tableSeatsOverride ?? tableSeats}
          seatCount={tableSeatsOverride?.length ?? positions.length}
          pot={actualPot}
          board={board}
          activeGrid={activeGrid}
          activeFile={activeFile}
          activeDataLoaded={!!activeData}
          loading={loading}
          isICMSim={isICMSim}
          randomFillEnabled={randomFillEnabled}
          heightMode={heightMode}
          onHeightModeChange={onHeightModeChange}
          displayMode={displayMode}
          onDisplayModeChange={onDisplayModeChange}
          reachByHand={activeFile ? reachByFile?.[activeFile] ?? null : null}
          onActionClick={onActionClick}
          baseW={studyW}
          viewH={vh}
          topOffset={topOffset}
          bottomInset={bottomInset}
          comboDetail={comboDetail}
          nodeStats={nodeStats}
          chipScale={chipScale}
          actorSeat={actorSeat}
          seatNames={seatNames}
          money={money}
          activePlayer={activePlayer}
          autoPinBySeat={autoPinBySeat}
          playedAction={playedAction}
        />
      </div>
    </div>
  );
};

export default SingleRangeDesktopView;
