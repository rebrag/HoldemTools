// src/components/Plate.tsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import { JsonData, combineDataByHand, HandCellData } from "../utils/utils";
import ColorKey from "./ColorKey";
import DecisionMatrix from "./DecisionMatrix";

interface PlateProps {
  folder: string;
  file: string;
  onActionClick: (action: string, file: string) => void;
  randomFillEnabled?: boolean;
}

const Plate: React.FC<PlateProps> = ({
  folder,
  file,
  onActionClick,
  randomFillEnabled,
}) => {
  const [rawData, setRawData] = useState<JsonData | null>(null);
  const [combinedData, setCombinedData] = useState<HandCellData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  

  // Load file data when folder/file changes
  useEffect(() => {
    setLoading(true);
    axios
      .get<JsonData>(`${import.meta.env.VITE_API_BASE_URL}/api/Files/${folder}/${file}`)
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

  return (
    <div
      className="mb-0 justify-self-center border rounded-[7px] shadow-md p-1 bg-white
                 w-full transition-all duration-200 text-base max-w-[300px]"
    >
      {loading && <p>Loading data...</p>}
      {error && <p className="text-red-500">{error}</p>}
      {!loading && !error && rawData && (
        <>
          <div className="select-none flex w-full items-center justify-between">
            <h2
              className="whitespace-nowrap font-bold text-gray-800"
              style={{ fontSize: "calc(0.6rem + 0.3vw)" }}
            >
              {rawData.Position ? (
                <span
                  className={
                    rawData.Position === "BTN"
                      ? "border-2 border-black p-0.5 animate-none duration-1000 shadow-2xl px-0 rounded-sm"
                      : ""
                  }
                >
                  {rawData.Position} {rawData.bb}bb
                </span>
              ) : (
                file
              )}
            </h2>
            <ColorKey
              data={combinedData}
              onActionClick={(action) => onActionClick(action, file)}
            />
          </div>
          <DecisionMatrix gridData={combinedData} randomFillEnabled={randomFillEnabled} />
        </>
      )}
    </div>
  );
  
  
  
};

export default Plate;
