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
}: PlateGridProps) => {

//   useEffect(() => {
//     console.log("PlateGrid mounted");
//     return () => {
//       console.log("PlateGrid unmounted");
//     };
//   }, []);

  // Narrow when viewport width is less than viewport height.
  const isNarrow =
    files.length === 2
      ? !(windowWidth * 1.2 < windowHeight)
      : windowWidth * 1.2 < windowHeight;

  const gridRows = isNarrow ? Math.ceil(files.length / 2) : 2;
  const gridCols = isNarrow ? 2 : Math.ceil(files.length / 2);

  // If using spiral order, arrange the files accordingly.
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
      <div
        className={`absolute inset-0 flex items-center justify-center z-10 transition-opacity duration-100 ${
          loading ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <LoadingIndicator />
      </div>
      <div
        className="grid gap-1 select-none border-0 rounded-md"
        style={
          isNarrow
            ? {
                gridTemplateColumns: "repeat(2, minmax(170px, 400px))",
                gridTemplateRows: `repeat(${gridRows}, 1fr)`,
                justifyContent: "center",
              }
            : {
                gridTemplateRows: "repeat(2, 0.9fr)",
                gridTemplateColumns: `repeat(${gridCols}, minmax(100px, 320px))`,
                justifyContent: "center",
              }
        }
      >
        {orderedFiles.map((file, index) => {
          // Use the fixed position as the key.
          const posKey = positions[index] ?? `blank-${index}`;
          //console.log("posKey: ",posKey, "file: ", file);
          return file ? (
            <Plate
              key={posKey}
              file={file}
              data={plateData[file]}
              onActionClick={onActionClick}
              randomFillEnabled={randomFillEnabled}
            />
          ) : (
            <div key={posKey} />
          );
        })}
      </div>
    </div>
  );
};

export default PlateGrid;
