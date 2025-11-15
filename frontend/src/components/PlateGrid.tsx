/* eslint-disable react-hooks/rules-of-hooks */
import React, { useMemo, useState } from "react";
import Plate, { PlateZoomPayload } from "./Plate";
import LoadingIndicator from "./LoadingIndicator";
import { generateSpiralOrder } from "../utils/gridUtils";
import { JsonData } from "../utils/utils";
import { LayoutGroup } from "framer-motion";
import useElementSize from "../hooks/useElementSize";
import DecisionMatrix from "./DecisionMatrix";

type PlateGridProps = {
  files: string[];
  positions: string[];
  selectedFolder: string;
  randomFillEnabled: boolean;
  onActionClick: (action: string, file: string) => void;

  windowWidth: number;
  windowHeight: number;

  plateData: Record<string, JsonData>;
  loading?: boolean;
  alivePlayers: Record<string, boolean>;
  playerBets: Record<string, number>;
  isICMSim?: boolean;
  ante?: number;
  pot?: number;
  activePlayer?: string;

  /** NEW: show ranges only for active player */
  singleRangeView?: boolean;
};

/** ─── Narrow-only sizing constants ─── */
const TOP_RESERVED_FRACTION = 0.20;
const GRID_PAD_Y_PX = 0;
const ROW_GAP_Y_PX = 4;
const COL_GAP_X_PX = 12;
const SIDE_PAD_X_PX = 8;

const DM_ASPECT_H_OVER_W = 1.0;
const LR_GAP_PX = 4;

const EXTRA_PLATE_V_PX = 2;
const MIN_DM_W = 80;
const MIN_SIDEBAR_W = 40;
const MAX_PLATE_W = 640;

const PlateGrid: React.FC<PlateGridProps> = ({
  files,
  positions,
  // selectedFolder, // currently unused but kept for API stability
  randomFillEnabled,
  onActionClick,

  windowWidth,
  windowHeight,

  plateData,
  loading = false,
  alivePlayers,
  playerBets,
  isICMSim,
  ante,
  pot,
  activePlayer = "UTG",

  singleRangeView = false,
}) => {
  const [zoom, setZoom] = useState<PlateZoomPayload | null>(null);

  const container = useElementSize<HTMLDivElement>({ hysteresis: 6 });

  const baseW = container.width || windowWidth;
  const baseHForFit =
    windowHeight > 0 ? windowHeight : container.height || windowHeight;

  const viewW = windowWidth;
  const viewH = windowHeight;

  const baseNarrow =
    files.length === 2 ? !(viewW * 1.3 < viewH) : viewW * 1.3 < viewH;
  const isNarrow = baseNarrow && files.length > 4;

  const gridRows = isNarrow ? Math.ceil(files.length / 2) : 2;
  const gridCols = isNarrow ? 2 : Math.ceil(files.length / 2);
  const totalCells = gridRows * gridCols;
  const maxBet = Math.max(...Object.values(playerBets));

  const orderedEntries = useMemo(() => {
    const base = positions.map((p, i) => [p, files[i]] as const);
    const padded = [...base];
    while (padded.length < totalCells) padded.push(["", ""]);
    const grid: (readonly [string, string])[] = new Array(totalCells).fill([
      "",
      "",
    ]);
    generateSpiralOrder(gridRows, gridCols).forEach(([r, c], i) => {
      grid[r * gridCols + c] = padded[i];
    });
    return grid;
  }, [files, positions, gridRows, gridCols, totalCells]);

  const [col0, col1] = useMemo(() => {
    const c0: (readonly [string, string])[] = [];
    const c1: (readonly [string, string])[] = [];
    orderedEntries.forEach(([posKey, file], idx) => {
      if (!posKey) return;
      (idx % 2 === 0 ? c0 : c1).push([posKey, file]);
    });
    return [c0, c1];
  }, [orderedEntries]);

  const rows: (readonly [string, string])[][] = [];
  for (let i = 0; i < orderedEntries.length; i += gridCols)
    rows.push(orderedEntries.slice(i, i + gridCols));

  const gapPx = 15;

  const fmt = (n: number, decimals = 1) =>
    Math.abs(n % 1) > 1e-9 ? n.toFixed(decimals) : n.toFixed(0);

  const canonicalPlateWidth = !isNarrow
    ? (() => {
        const wAvail = Math.max(0, baseW - (gridCols - 1) * gapPx);
        const hAvail = Math.max(0, baseHForFit - (gridRows - 1) * gapPx);
        const fitByW = wAvail / gridCols;
        const fitByH = hAvail / (gridRows + 2);
        return Math.max(170, Math.min(fitByW, fitByH));
      })()
    : undefined;

  const halfPlateWidth = useMemo(() => {
    if (!isNarrow) return undefined;
    const containerW = Math.max(200, baseW - SIDE_PAD_X_PX * 2);
    return Math.round((containerW - COL_GAP_X_PX) / 2);
  }, [isNarrow, baseW]);

  const remainingViewportH = Math.floor(viewH * (1 - TOP_RESERVED_FRACTION));

  const gridContainerHeight = useMemo(() => {
    if (!isNarrow || !halfPlateWidth) return undefined;
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
  }, [isNarrow, halfPlateWidth, gridRows, remainingViewportH]);

  const narrowDims = useMemo(() => {
    if (!isNarrow || !halfPlateWidth)
      return {
        plateW: undefined as number | undefined,
        dmW: undefined as number | undefined,
        sbW: undefined as number | undefined,
      };

    const availableH =
      (gridContainerHeight ?? remainingViewportH) -
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
    const plateW = Math.min(MAX_PLATE_W, halfPlateWidth);
    return { plateW, dmW: Math.round(dmW), sbW: Math.round(sbW) };
  }, [isNarrow, halfPlateWidth, gridRows, gridContainerHeight, remainingViewportH]);

  const getZoomWidth = () => {
    const base = isNarrow
      ? narrowDims.plateW ?? 220
      : canonicalPlateWidth ?? 220;
    const scaled = Math.round(base * 1.8);
    const maxByContainer = Math.floor(baseW * 0.92);
    return Math.min(scaled, maxByContainer, 900);
  };

  const badgeClass =
    "backdrop-blur-sm rounded-md shadow text-center " +
    (isNarrow
      ? "bg-white/60 px-0.5 py-0.5 text-[8px]"
      : "bg-white/60 px-2 py-0 text-xs");

  return (
    <div
      className={`border-0 relative flex justify-center ${
        isNarrow ? "items-start py-0 px-0.5" : "items-center py-2"
      } overflow-visible`}
    >
      <div className="poker-table-bg pointer-events-none absolute inset-0 flex justify-center items-center z-10">
        <div
          className={`poker-rail ${
            gridRows > gridCols ? "portrait" : ""
          } overflow-visible relative`}
        >
          <div className="poker-felt overflow-hidden" />
        </div>
      </div>

      <LayoutGroup id="plate-zoom">
        <div
          ref={container.ref}
          className={`relative z-10 w-full select-none ${
            isNarrow ? "" : "min-h-[300px]"
          }`}
          style={
            isNarrow
              ? {
                  height: gridContainerHeight,
                  paddingTop: GRID_PAD_Y_PX,
                  paddingBottom: GRID_PAD_Y_PX,
                }
              : undefined
          }
        >
          {/* Zoom overlay backdrop */}
          {zoom && (
            <div
              className="fixed inset-0 bg-black/40 z-[55]"
              onClick={() => setZoom(null)}
            />
          )}

          {/* Zoom overlay: ONLY DecisionMatrix */}
          {zoom && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center"
              onClick={() => setZoom(null)}
            >
              <div
                className="relative"
                style={{ width: getZoomWidth(), maxWidth: "95vw" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-black/60 rounded-xl shadow-xl p-2 sm:p-3">
                  <div
                    className="relative w-full"
                    style={{ aspectRatio: "1 / 1" }}
                  >
                    <DecisionMatrix
                      gridData={zoom.grid}
                      randomFillEnabled={false}
                      isICMSim={zoom.isICMSim}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Loading */}
          <div
            className={`absolute inset-0 flex items-center justify-center z-50 transition-opacity duration-100 ${
              loading ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            <LoadingIndicator />
          </div>

          {/* Pot/ante badge (center of table) */}
          {ante !== undefined && pot !== undefined && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
              <div className={badgeClass}>
                <strong>Total:</strong> {fmt(Math.max(0, pot), 1)} bb
                {ante !== 0 && (
                  <>
                    <br />
                    <strong>Pot:</strong> {ante} bb
                  </>
                )}
              </div>
            </div>
          )}

          {/* Narrow layout */}
          {isNarrow ? (
            <div
              className="flex justify-center w-full overflow-visible"
              style={{
                height: "100%",
                paddingLeft: SIDE_PAD_X_PX,
                paddingRight: SIDE_PAD_X_PX,
              }}
            >
              <div
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
                          onPlateZoom={(payload) => setZoom(payload)}
                          singleRangeView={singleRangeView}
                        />
                      ))}
                    </div>
                  ) : null
                )}
              </div>
            </div>
          ) : (
            /* Landscape layout */
            <div className="flex flex-col gap-4">
              {rows.map((row, rowIdx) => {
                const plates = row.filter(
                  ([posKey]) => posKey
                ) as (readonly [string, string])[];
                if (!plates.length) return null;
                return (
                  <div
                    key={`row-${rowIdx}`}
                    className="flex justify-center gap-2 flex-nowrap"
                  >
                    {plates.map(([posKey, file]) => (
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
                        plateWidth={canonicalPlateWidth}
                        isActive={posKey === activePlayer}
                        pot={pot}
                        maxBet={maxBet}
                        onPlateZoom={(payload) => setZoom(payload)}
                        singleRangeView={singleRangeView}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </LayoutGroup>
    </div>
  );
};

export default PlateGrid;
