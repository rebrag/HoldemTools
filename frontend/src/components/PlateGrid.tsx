import { useMemo } from "react"; //useEffect
import Plate from "./Plate";
import { generateSpiralOrder } from "../utils/gridUtils";
import { JsonData } from "../utils/utils";
import LoadingIndicator from "./LoadingIndicator";

type PlateGridProps = {
  // Array of file names, in the same order as the positions array.
  files: string[];
  // Fixed positions array that stays constant.
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
};

const PlateGrid = ({
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
}: PlateGridProps) => {
  // Narrow when viewport width is less than viewport height.
  const isNarrow =
    files.length === 2
      ? !(windowWidth * 1.3 < windowHeight)
      : windowWidth * 1.3 < windowHeight;

  const gridRows = isNarrow ? Math.ceil(files.length / 2) : 2;
  const gridCols = isNarrow ? 2 : Math.ceil(files.length / 2);

  // If using spiral order, arrange the files accordingly.
  const orderedEntries = useMemo(() => {
    const entries = positions.map((pos, i) => [pos, files[i]] as const);
  
    if (!isSpiralView) return entries;
  
    const totalCells = gridRows * gridCols;
    const padded = [...entries];
    while (padded.length < totalCells) padded.push(["", ""]); // fill with empty pairs
  
    const spiralPositions = generateSpiralOrder(gridRows, gridCols);
    const grid: (readonly [string, string])[] = new Array(totalCells).fill(["", ""]);
  
    spiralPositions.forEach(([r, c], i) => {
      if (i < padded.length) {
        grid[r * gridCols + c] = padded[i];
      }
    });
  
    return grid;
  }, [positions, files, isSpiralView, gridRows, gridCols]);
  

  return (
    <div className="relative min-h-[300px]">
      <div
        className={`absolute inset-0 flex items-center justify-center z-50 transition-opacity duration-100 ${
          loading ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <LoadingIndicator />
      </div>
      <div
        className="grid gap-2 select-none border-0 rounded-md"
        style={
          isNarrow
            ? {
                gridTemplateColumns: "repeat(2, minmax(170px, 400px))",
                gridTemplateRows: `repeat(${gridRows}, 1fr)`,
                justifyContent: "center",
              }
            : {
                gridTemplateRows: "repeat(2, 0.9fr)",
                gridTemplateColumns: `repeat(${gridCols}, minmax(100px, 300px))`,
                justifyContent: "center",
              }
        }
      >
        {orderedEntries.map(([posKey, file], index) => {
          return file ? (
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
          ) : (
            <div key={`empty-${index}`} />
          );
        })}

      </div>
    </div>
  );
};

export default PlateGrid;
