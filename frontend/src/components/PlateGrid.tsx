import React from "react";
import Plate from "./Plate";
import LoadingIndicator from "./LoadingIndicator";
import { generateSpiralOrder } from "../utils/gridUtils";
import { JsonData } from "../utils/utils";

type PlateGridProps = {
  files: string[];
  positions: string[];
  selectedFolder: string;
  isSpiralView: boolean;
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
  pot?: number
};

const PlateGrid: React.FC<PlateGridProps> = ({
  files,
  positions,
  isSpiralView,
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
}) => {
  /* ---------- layout maths ---------- */
  const isNarrow =
    files.length === 2
      ? !(windowWidth * 1.3 < windowHeight)
      : windowWidth * 1.3 < windowHeight;

  const gridRows = isNarrow ? Math.ceil(files.length / 2) : 2;
  const gridCols = isNarrow ? 2 : Math.ceil(files.length / 2);
  const totalCells = gridRows * gridCols;

  /* ---------- order entries ---------- */
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const orderedEntries = React.useMemo(() => {
    const base = positions.map((p, i) => [p, files[i]] as const);

    if (!isSpiralView) return base;

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
  }, [files, positions, isSpiralView, gridRows, gridCols, totalCells]);

  /* ---------- portrait-mode columns ---------- */
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [col0, col1] = React.useMemo(() => {
    const c0: (readonly [string, string])[] = [];
    const c1: (readonly [string, string])[] = [];

    orderedEntries.forEach(([posKey, file], idx) => {
      if (!file) return;
      (idx % 2 === 0 ? c0 : c1).push([posKey, file]);
    });

    return [c0, c1];
  }, [orderedEntries]);

  /* ---------- landscape rows (unchanged) ---------- */
  const rows: (readonly [string, string])[][] = [];
  for (let i = 0; i < orderedEntries.length; i += gridCols) {
    rows.push(orderedEntries.slice(i, i + gridCols));
  }

  /* ---------- render ---------- */
  return (
    <div className="relative min-h-[300px]">
      {/* loading overlay */}
      <div
        className={`absolute inset-0 flex items-center justify-center z-50 transition-opacity duration-100 ${
          loading ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <LoadingIndicator />
      </div>

      {/* overlay ─ Ante / Pot */}
      {ante !== undefined && pot !== undefined && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
          <div className="bg-white/50 backdrop-blur-sm rounded-md px-2 py-0 text-xs shadow text-center">
          <strong>Total:</strong>&nbsp;{pot.toFixed(2)} bb
            <br />
            <strong>Pot:</strong>&nbsp;{ante} bb
          </div>
        </div>
      )}



      {/* ================== PORTRAIT / NARROW ================== */}
      {isNarrow ? (
        <div className="flex justify-center gap-2 w-full select-none border-0 rounded-md">
          {[col0, col1].map((col, idx) =>
            col.length ? (
              <div
                key={`col-${idx}`}
                className="flex flex-1 flex-col gap-5 justify-center items-center"
                style={{
                  minWidth: 170,             /* ► keep ≥ 170 px … */
                  maxWidth: 400,             /* ► … cap at 400 px   */
                }}
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
                  />
                ))}
              </div>
            ) : null
          )}
        </div>
      ) : (
        /* ================== LANDSCAPE / WIDE ================== */
        <div className="flex flex-col gap-6 select-none border-0 rounded-md">
          {rows.map((row, rowIdx) => {
            const plates = row.filter(([, f]) => f) as (readonly [
              string,
              string
            ])[];
            if (plates.length === 0) return null;

            return (
              <div
                key={`row-${rowIdx}`}
                className="grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${plates.length}, minmax(100px, 300px))`,
                  justifyContent: "center",
                }}
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
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PlateGrid;
