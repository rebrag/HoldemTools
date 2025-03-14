// src/components/PlateGrid.tsx
import { useMemo } from "react";
import Plate from "./Plate";
import { generateSpiralOrder } from "../utils/gridUtils";

type PlateGridProps = {
  files: string[];
  selectedFolder: string;
  isSpiralView: boolean;
  randomFillEnabled: boolean;
  onSelectAction: (parentPrefix: string, action: string) => void;
  windowWidth: number;
};

const PlateGrid = ({
  files,
  selectedFolder,
  isSpiralView,
  randomFillEnabled,
  onSelectAction,
  windowWidth,
}: PlateGridProps) => {
  // Determine grid layout based on viewport width.
  const isNarrow = windowWidth <= 450;
  const gridRows = isNarrow ? Math.ceil(files.length / 2) : 2;
  const gridCols = isNarrow ? 2 : Math.ceil(files.length / 2);

  // If spiral view is enabled, compute spiral ordering.
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
    <div
      className="grid gap-1 select-none"
      style={
        isNarrow
          ? {
              gridTemplateColumns: "repeat(2, minmax(170px, 280px))",
              gridTemplateRows: `repeat(${gridRows}, 1fr)`,
              justifyContent: "center",
            }
          : {
              gridTemplateRows: "repeat(2, 1fr)",
              gridTemplateColumns: `repeat(${gridCols}, minmax(210px, 280px))`,
              justifyContent: "center",
            }
      }
    >
      {orderedFiles.map((file, index) =>
        file ? (
          <Plate
            key={file}
            folder={selectedFolder}
            file={file}
            onSelectAction={onSelectAction}
            randomFillEnabled={randomFillEnabled}
          />
        ) : (
          <div key={`blank-${index}`} />
        )
      )}
    </div>
  );
};

export default PlateGrid;
