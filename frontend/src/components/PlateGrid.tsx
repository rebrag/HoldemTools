import { useMemo } from "react";
import Plate from "./Plate";
import { generateSpiralOrder } from "../utils/gridUtils";
import { JsonData } from "../utils/utils";
import LoadingIndicator from "./LoadingIndicator";

type PlateGridProps = {
  files: string[];
  selectedFolder: string;
  isSpiralView: boolean;
  randomFillEnabled: boolean;
  onActionClick: (action: string, file: string) => void;
  windowWidth: number;
  windowHeight: number; // New prop for viewport height
  plateData: Record<string, JsonData>;
  loading?: boolean;
};

const PlateGrid = ({
  files,
  isSpiralView,
  randomFillEnabled,
  onActionClick,
  windowWidth,
  windowHeight,
  plateData,
  loading = false,
}: PlateGridProps) => {
  // Narrow when viewport width is less than viewport height
  const isNarrow =
  files.length === 2
    ? !(windowWidth * 1.2 < windowHeight)
    : windowWidth * 1.2 < windowHeight;

  const gridRows = isNarrow ? Math.ceil(files.length / 2) : 2;
  const gridCols = isNarrow ? 2 : Math.ceil(files.length / 2);

  const orderedFiles = useMemo(() => {
    if (!isSpiralView) return files;
    const totalCells = gridRows * gridCols;
    const gridArray: (string | null)[] = new Array(totalCells).fill(null);
    const spiralPositions = generateSpiralOrder(gridRows, gridCols);
    files.forEach((file, idx) => {
      if (idx < spiralPositions.length) {
        const [r, c] = spiralPositions[idx];
        gridArray[r * gridCols + c] = file;
      }
    });
    return gridArray;
  }, [files, isSpiralView, gridRows, gridCols]);

  return (
    <div className="relative min-h-[300px]">
      {/* Loading overlay always rendered, with transition */}
      <div
        className={`absolute inset-0 flex items-center justify-center z-10 transition-opacity duration-100 ${
          loading ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <LoadingIndicator />
      </div>
      <div
        className="grid gap-1 select-none border-0 rounded-[20px]"
        style={
          isNarrow
            ? {
                gridTemplateColumns: "repeat(2, minmax(170px, 400px))",
                gridTemplateRows: `repeat(${gridRows}, 1fr)`,
                justifyContent: "center",
              }
            : {
                gridTemplateRows: "repeat(2, 0.9fr)",
                gridTemplateColumns: `repeat(${gridCols}, minmax(210px, 400px))`,
                justifyContent: "center",
              }
        }
      >
        {orderedFiles.map((file, index) =>
          file ? (
            <Plate
              key={file}
              file={file}
              data={plateData[file]}
              onActionClick={onActionClick}
              randomFillEnabled={randomFillEnabled}
            />
          ) : (
            <div key={`blank-${index}`} />
          )
        )}
      </div>
    </div>
  );
};

export default PlateGrid;
