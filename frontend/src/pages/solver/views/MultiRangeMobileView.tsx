// views/MultiRangeMobileView.tsx
//
// Narrow (portrait) multi-range layout: two columns of compact plates sized
// so every seat fits the remaining viewport height without scrolling.
import { useMemo, useState } from "react";
import Plate, { type PlateZoomPayload } from "../Plate";
import useElementSize from "@/hooks/useElementSize";
import { orderPlatesSpiral } from "@/lib/solver/gridUtils";
import MultiRangeFrame from "./MultiRangeFrame";
import type { MultiRangeViewProps } from "./types";

/** ─── Narrow-only sizing constants ─── */
const TOP_RESERVED_FRACTION = 0.2;
const GRID_PAD_Y_PX = 0;
const ROW_GAP_Y_PX = 4;
const COL_GAP_X_PX = 12;
const SIDE_PAD_X_PX = 8;

const DM_ASPECT_H_OVER_W = 1.0;
const LR_GAP_PX = 4;

const EXTRA_PLATE_V_PX = 2;
const MIN_DM_W = 80;
const MIN_SIDEBAR_W = 40;

const MultiRangeMobileView = ({
  files,
  positions,
  plateData,
  loading,
  alivePlayers,
  playerBets,
  activePlayer,
  pot,
  actualPot,
  isICMSim,
  randomFillEnabled,
  onActionClick,
  windowWidth,
  windowHeight,
  onPlateContentRef,
}: MultiRangeViewProps) => {
  const [zoom, setZoom] = useState<PlateZoomPayload | null>(null);
  const container = useElementSize<HTMLDivElement>({ hysteresis: 6 });
  const baseW = container.width || windowWidth;

  const gridRows = Math.ceil(files.length / 2);
  const gridCols = 2;
  const maxBet = Math.max(...Object.values(playerBets));

  const orderedEntries = useMemo(
    () => orderPlatesSpiral(positions, files, gridRows, gridCols),
    [positions, files, gridRows]
  );

  const [col0, col1] = useMemo(() => {
    const c0: (readonly [string, string])[] = [];
    const c1: (readonly [string, string])[] = [];
    orderedEntries.forEach(([posKey, file], idx) => {
      if (!posKey) return;
      (idx % 2 === 0 ? c0 : c1).push([posKey, file]);
    });
    return [c0, c1];
  }, [orderedEntries]);

  const halfPlateWidth = useMemo(() => {
    const containerW = Math.max(200, baseW - SIDE_PAD_X_PX * 2);
    return Math.round((containerW - COL_GAP_X_PX) / 2);
  }, [baseW]);

  const remainingViewportH = Math.floor(
    windowHeight * (1 - TOP_RESERVED_FRACTION)
  );

  const gridContainerHeight = useMemo(() => {
    const dmW_byWidth = Math.max(
      MIN_DM_W,
      halfPlateWidth - LR_GAP_PX - MIN_SIDEBAR_W
    );
    const rowH_required = dmW_byWidth * DM_ASPECT_H_OVER_W + EXTRA_PLATE_V_PX;
    const requiredContainer =
      GRID_PAD_Y_PX * 2 +
      (gridRows - 1) * ROW_GAP_Y_PX +
      gridRows * rowH_required;
    return Math.max(240, Math.min(requiredContainer, remainingViewportH));
  }, [halfPlateWidth, gridRows, remainingViewportH]);

  const narrowDims = useMemo(() => {
    const availableH =
      gridContainerHeight -
      GRID_PAD_Y_PX * 2 -
      (gridRows - 1) * ROW_GAP_Y_PX -
      gridRows * EXTRA_PLATE_V_PX;

    const perRowH = availableH / gridRows;
    const dmLimitByHeight = perRowH / DM_ASPECT_H_OVER_W;
    const dmLimitByHalfWidth = halfPlateWidth - LR_GAP_PX - MIN_SIDEBAR_W;
    const dmW = Math.max(
      MIN_DM_W,
      Math.min(dmLimitByHeight, dmLimitByHalfWidth)
    );
    const sbW = Math.max(MIN_SIDEBAR_W, halfPlateWidth - LR_GAP_PX - dmW);
    const plateW = halfPlateWidth;
    return { plateW, dmW: Math.round(dmW), sbW: Math.round(sbW) };
  }, [halfPlateWidth, gridRows, gridContainerHeight]);

  const zoomWidth = Math.min(
    Math.round((narrowDims.plateW ?? 220) * 1.8),
    Math.floor(baseW * 0.92),
    900
  );

  return (
    <MultiRangeFrame
      compact
      containerRef={container.ref}
      containerStyle={{
        height: gridContainerHeight,
        paddingTop: GRID_PAD_Y_PX,
        paddingBottom: GRID_PAD_Y_PX,
      }}
      zoom={zoom}
      zoomWidth={zoomWidth}
      onClearZoom={() => setZoom(null)}
      loading={loading}
      actualPot={actualPot}
    >
      <div
        className="flex justify-center w-full overflow-visible"
        style={{
          height: "100%",
          paddingLeft: SIDE_PAD_X_PX,
          paddingRight: SIDE_PAD_X_PX,
        }}
      >
        <div
          ref={onPlateContentRef}
          className="flex justify-center gap-3 w-full"
          style={{ height: "100%" }}
        >
          {[col0, col1].map((col, idx) =>
            col.length ? (
              <div
                key={`col-${idx}`}
                className="flex flex-col gap-y-1 justify-center items-center grow-0 shrink-0 basis-1/2"
                style={{ height: "100%", width: "50%" }}
              >
                {col.map(([posKey, file]) => (
                  <Plate
                    key={posKey}
                    plateId={file}
                    file={file}
                    data={plateData[file]}
                    onActionClick={onActionClick}
                    randomFillEnabled={randomFillEnabled}
                    alive={alivePlayers[posKey] ?? true}
                    playerBet={playerBets[posKey] ?? 0}
                    isICMSim={isICMSim}
                    isActive={posKey === activePlayer}
                    pot={pot}
                    maxBet={maxBet}
                    plateWidth={narrowDims.plateW}
                    dmWidthPx={narrowDims.dmW}
                    sidebarWidthPx={narrowDims.sbW}
                    compact
                    onPlateZoom={setZoom}
                  />
                ))}
              </div>
            ) : null
          )}
        </div>
      </div>
    </MultiRangeFrame>
  );
};

export default MultiRangeMobileView;
