// src/components/Plate.tsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import { FileData, combineDataByHand, HandCellData } from "../utils/utils";
import ColorKey from "./ColorKey";
import DecisionMatrix from "./DecisionMatrix";

interface PlateProps {
  folder: string;
  file: string;
  onSelectAction: (parentPrefix: string, action: string) => void;
  onColorKeyClick?: (newValue: string, file: string) => void;
  randomFillEnabled?: boolean;
}

const Plate: React.FC<PlateProps> = ({
  folder,
  file,
  onSelectAction,
  onColorKeyClick,
  randomFillEnabled,
}) => {
  const [rawData, setRawData] = useState<FileData | null>(null);
  const [combinedData, setCombinedData] = useState<HandCellData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load file data when folder/file changes
  useEffect(() => {
    setLoading(true);
    axios
      .get<FileData>(`${import.meta.env.VITE_API_BASE_URL}/api/Files/${folder}/${file}`)
      .then((response) => {
        setRawData(response.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError("Error fetching file data");
        setLoading(false);
      });
  }, [folder, file]);

  // Process file data into grid data
  useEffect(() => {
    if (!rawData) return;
    const data = combineDataByHand(rawData);
    setCombinedData(data);
  }, [rawData]);

  // Get parent prefix from file name (remove .json extension)
  const parentPrefix = file.replace(".json", "");

  return (
    <div
      className="mb-0 justify-self-center border rounded-[7px] shadow-md p-1 bg-white
                 w-full transition-all duration-200 text-base max-w-[300px]"
    >
      {loading && <p>Loading data...</p>}
      {error && <p className="text-red-500">{error}</p>}
      {!loading && !error && rawData && (
        <>
          {/* Header: Position, BB Info and ColorKey */}
          <div className="select-none flex w-full items-center justify-between">
            <h2
              className="whitespace-nowrap font-bold text-gray-800"
              style={{ fontSize: "calc(0.6rem + 0.3vw)" }}
            >
              {rawData.Position || file} {rawData.bb}bb
            </h2>
            <ColorKey
              data={combinedData}
              onSelectAction={(action) => {
                // Call the existing onSelectAction with parentPrefix and action.
                onSelectAction(parentPrefix, action);
                // Also, if provided, call onColorKeyClick with the new value and file.
                if (onColorKeyClick) {
                  onColorKeyClick(action, file);
                }
              }}
            />
          </div>
          {/* DecisionMatrix (grid of hand cells) */}
          <DecisionMatrix gridData={combinedData} randomFillEnabled={randomFillEnabled} />
        </>
      )}
    </div>
  );
};

export default Plate;
