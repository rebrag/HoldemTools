// views/MultiRangeDesktopView.tsx
//
// Desktop / landscape multi-range layout: every seat's plate in two centered
// rows, laid out in spiral order so the grid reads clockwise around the
// table.
import { useMemo, useState } from "react";
import Plate, { type PlateZoomPayload } from "../Plate";
import useElementSize from "@/hooks/useElementSize";
import { orderPlatesSpiral } from "@/lib/solver/gridUtils";
import MultiRangeFrame from "./MultiRangeFrame";
import type { MultiRangeViewProps } from "./types";

const GAP_PX = 15;

const MultiRangeDesktopView = ({
  files,
  positions,
  plateData,
  loading,
  alivePlayers,
  playerBets,
  potCommitted,
  activePlayer,
  pot,
  actualPot,
  money,
  isICMSim,
  randomFillEnabled,
  heightMode,
  reachByFile,
  onActionClick,
  windowWidth,
  onPlateContentRef,
}: MultiRangeViewProps) => {
  const [zoom, setZoom] = useState<PlateZoomPayload | null>(null);
  const container = useElementSize<HTMLDivElement>({ hysteresis: 6 });
  const baseW = container.width || windowWidth;

  const gridRows = 2;
  const gridCols = Math.ceil(files.length / 2);
  const maxBet = Math.max(...Object.values(playerBets));

  const orderedEntries = useMemo(
    () => orderPlatesSpiral(positions, files, gridRows, gridCols),
    [positions, files, gridCols]
  );

  const rows: (readonly [string, string])[][] = Array.from(
    { length: Math.ceil(orderedEntries.length / gridCols) },
    (_, r) => orderedEntries.slice(r * gridCols, (r + 1) * gridCols)
  );

  const canonicalPlateWidth = (() => {
    const wAvail = Math.max(0, baseW - (gridCols - 1) * GAP_PX);
    const fitByW = wAvail / gridCols;
    return Math.max(170, fitByW);
  })();

  const zoomWidth = Math.min(
    Math.round(canonicalPlateWidth * 1.8),
    Math.floor(baseW * 0.92),
    900
  );

  return (
    <MultiRangeFrame
      money={money}
      compact={false}
      containerRef={container.ref}
      zoom={zoom}
      zoomWidth={zoomWidth}
      onClearZoom={() => setZoom(null)}
      loading={loading}
      actualPot={actualPot}
      heightMode={heightMode}
    >
      <div className="flex flex-col gap-4">
        {rows.map((row, rowIdx) => {
          const plates = row.filter(([posKey]) => posKey) as (readonly [
            string,
            string
          ])[];
          if (!plates.length) return null;
          return (
            <div key={`row-${rowIdx}`} className="flex justify-center">
              <div
                ref={rowIdx === 0 ? onPlateContentRef : undefined}
                className="flex gap-2 flex-nowrap"
              >
                {plates.map(([posKey, file]) => (
                  <Plate
                    money={money}
                    key={posKey}
                    plateId={file}
                    file={file}
                    data={plateData[file]}
                    onActionClick={onActionClick}
                    randomFillEnabled={randomFillEnabled}
                    heightMode={heightMode}
                    reachByHand={reachByFile?.[file] ?? null}
                    alive={alivePlayers[posKey] ?? true}
                    playerBet={playerBets[posKey] ?? 0}
                    potCommitted={potCommitted?.[posKey] ?? 0}
                    isICMSim={isICMSim}
                    plateWidth={canonicalPlateWidth}
                    isActive={posKey === activePlayer}
                    pot={pot}
                    maxBet={maxBet}
                    onPlateZoom={setZoom}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </MultiRangeFrame>
  );
};

export default MultiRangeDesktopView;
