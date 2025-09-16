import React, { useMemo, useState } from "react";
import Plate from "./Plate";
import LoadingIndicator from "./LoadingIndicator";
import { generateSpiralOrder } from "../utils/gridUtils";
import { JsonData, HandCellData } from "../utils/utils";
import DecisionMatrix from "./DecisionMatrix";

type PlateGridProps = {
  files: string[];
  positions: string[];
  selectedFolder: string;
  // isSpiralView: boolean;
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
};

const PlateGrid: React.FC<PlateGridProps> = ({
  files,
  positions,
  // isSpiralView,
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
  activePlayer = "UTG"
}) => {
  /* =================== ZOOM OVERLAY STATE =================== */
  const [zoom, setZoom] = useState<{
    grid: HandCellData[];
    title: string;
    isICM: boolean;
    id: string;
  } | null>(null);

  /* =================== LAYOUT MATHS ========================= */
  const isNarrow =
    files.length === 2
      ? !(windowWidth * 1.3 < windowHeight)
      : windowWidth * 1.3 < windowHeight;

  const gridRows = isNarrow ? Math.ceil(files.length / 2) : 2;
  const gridCols = isNarrow ? 2 : Math.ceil(files.length / 2);
  const totalCells = gridRows * gridCols;
  const railPortrait = gridRows > gridCols;

  /* highest bet on the table (for pot-odds badge) */
  const maxBet = Math.max(...Object.values(playerBets));

  /* ---------- order entries (spiral or linear) --------------- */
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const orderedEntries = useMemo(() => {
    const base = positions.map((p, i) => [p, files[i]] as const);

    // if (!isSpiralView) return base;

    const padded = [...base];
    while (padded.length < totalCells) padded.push(["", ""]);

    const grid: (readonly [string, string])[] = new Array(totalCells).fill([
      "",
      ""
    ]);
    generateSpiralOrder(gridRows, gridCols).forEach(([r, c], i) => {
      grid[r * gridCols + c] = padded[i];
    });

    return grid;
  }, [files, positions,  gridRows, gridCols, totalCells]); //isSpiralView,

  /* ---------- portrait-mode columns -------------------------- */
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [col0, col1] = useMemo(() => {
    const c0: (readonly [string, string])[] = [];
    const c1: (readonly [string, string])[] = [];

    orderedEntries.forEach(([posKey, file], idx) => {
      if (!posKey) return;
      (idx % 2 === 0 ? c0 : c1).push([posKey, file]);
    });

    return [c0, c1];
  }, [orderedEntries]);

  /* ---------- rows for landscape ----------------------------- */
  const rows: (readonly [string, string])[][] = [];
  for (let i = 0; i < orderedEntries.length; i += gridCols) {
    rows.push(orderedEntries.slice(i, i + gridCols));
  }

  /* ---------- canonical plate width (landscape only) --------- */
  const gapPx = 15;
  const canonicalPlateWidth = isNarrow
    ? undefined
    : (() => {
        const wAvail = windowWidth - gridCols * gapPx;
        const hAvail = windowHeight - gridRows * gapPx;
        const fitByW = wAvail / gridCols;
        const fitByH = hAvail / (gridRows + 1);
        return Math.max(170, Math.min(fitByW, fitByH));
      })();

  /* =================== RENDER ================================ */
  return (
    <div className="relative flex justify-center items-center py-2 overflow-visible border-0">
      {/* ---------- decorative poker-table background ---------- */}
      <div className="poker-table-bg pointer-events-none absolute inset-0 flex justify-center items-center z-10">
        <div className={`poker-rail ${railPortrait ? "portrait" : ""} overflow-hidden relative`}>
          <div className="poker-felt" />
        </div>
      </div>


      {/* ---------- zoom overlay (simple, no AnimatePresence) ---------- */}
      {zoom && (
        <div
          className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center"
          onClick={() => setZoom(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl p-3 w-[90vw] max-w-[600px] relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setZoom(null)}
              className="absolute top-2 right-2 text-lg font-bold"
            >
              ×
            </button>

            <h2 className="text-center font-semibold mb-2">{zoom.title}</h2>

            <DecisionMatrix
              gridData={zoom.grid}
              randomFillEnabled={false}
              isICMSim={zoom.isICM}
            />
          </div>
        </div>
      )}

      {/* ---------- loading overlay ---------------------------- */}
      <div
        className={`absolute inset-0 flex items-center justify-center z-50 transition-opacity duration-100 ${
          loading ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <LoadingIndicator />
      </div>

      {/* ---------- Ante / Pot badge --------------------------- */}
      {ante !== undefined && pot !== undefined && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-15">
          <div className="bg-white/60 backdrop-blur-sm rounded-md px-2 py-0 text-xs shadow text-center">
            <strong>Total:</strong>&nbsp;{pot.toFixed(2)} bb
            {ante !== 0 && (
              <>
                <br />
                <strong>Pot:</strong>&nbsp;{ante} bb
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------- plates layout ------------------------------ */}
      <div className="relative z-10 w-5/6 min-h-[300px] select-none">
        {/* ----- PORTRAIT / NARROW ----- */}
        {isNarrow ? (
          <div className="flex justify-center gap-6 w-full">
            {[col0, col1].map((col, idx) =>
              col.length ? (
                <div
                  key={`col-${idx}`}
                  className="flex flex-1 flex-col gap-1 justify-center items-center"
                  style={{ minWidth: 170, maxWidth: 400 }}
                >
                  {col.map(([posKey, file]) => (
                    <Plate
                      key={posKey}
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
                      onMatrixZoom={(grid, title, isICM, id) =>
                        setZoom({ grid, title, isICM, id })
                      }
                    />
                  ))}
                </div>
              ) : null
            )}
          </div>
        ) : (
          /* ----- LANDSCAPE / WIDE ----- */
          <div className="flex flex-col gap-8">
            {rows.map((row, rowIdx) => {
              const plates = row.filter(([posKey]) => posKey) as (readonly [
                string,
                string
              ])[];
              if (!plates.length) return null;

              return (
                <div
                  key={`row-${rowIdx}`}
                  className="flex justify-center gap-2 flex-nowrap"
                >
                  {plates.map(([posKey, file]) => (
                    <Plate
                      key={posKey}
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
                      onMatrixZoom={(grid, title, isICM, id) =>
                        setZoom({ grid, title, isICM, id })
                      }
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PlateGrid;
