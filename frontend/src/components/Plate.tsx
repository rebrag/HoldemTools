import React, { useEffect, useState } from "react";
import { combineDataByHand, HandCellData, JsonData } from "../utils/utils";
import ColorKey from "./ColorKey";
import DecisionMatrix from "./DecisionMatrix";

interface PlateProps {
  file: string;
  data: JsonData;
  onActionClick: (action: string, file: string) => void;
  randomFillEnabled?: boolean;
  alive: boolean; 
}

const Plate: React.FC<PlateProps> = ({
  file,
  data,
  onActionClick,
  randomFillEnabled,
  alive,
}) => {
  const [combinedData, setCombinedData] = useState<HandCellData[]>([]);

  // Process the JSON data into grid data when it changes.
  useEffect(() => {
    if (data) {
      const processed = combineDataByHand(data);
      setCombinedData(processed);
    }
  }, [data]);

  useEffect(() => {
    //console.log("file is alive: ", file, alive)
  }, [alive, file]);

  return (
    <div
      className="mb-0 justify-self-center border rounded-[7px] shadow-md p-0.5 bg-white
                  transition-all duration-500 ease-in-out w-full text-base max-w-[400px]" // 
      style={{ opacity: alive ? 1 : 0.4 }} // Adjust opacity based on alive status
    >
      {!data && <p>Loading data...</p>}
      {data && (
        <>
          <div className="select-none flex w-full items-center justify-between">
            <h2
              className="whitespace-nowrap font-bold text-gray-800"
              style={{ fontSize: "calc(0.6rem + 0.3vw)" }}
            >
              {data.Position ? (
                <span
                  className={
                    data.Position === "BTN"
                      ? "border-2 border-black p-0.5 animate-none duration-1000 shadow-2xl px-0 rounded-lg"
                      : ""
                  }
                >
                  {data.Position} {data.bb}bb
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
