import React, { useEffect, useState } from "react";
import { combineDataByHand, HandCellData, JsonData } from "../utils/utils";
import ColorKey from "./ColorKey";
import DecisionMatrix from "./DecisionMatrix";
import DealerButton from "./DealerButton";

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

  useEffect(() => {
    if (data) {
      const processed = combineDataByHand(data);
      setCombinedData(processed);
    }
  }, [data]);

  return (
    <div className="relative mb-4 justify-self-center max-w-[400px] w-full text-base">
      {/* DealerButton floats over the top right, full opacity */}
      {data?.Position === "BTN" && (
        <div
          className="absolute z-0"
          style={{
            top: "-16%",         // move it upward relative to Plate height
            right: "-8%",       // move it outward beyond right edge
            width: "33%",       // scales relative to Plate width
            aspectRatio: "1",   // keep it a circle
          }}
        >
          <DealerButton />
        </div>
      )}


      {/* Fadable container */}
      <div
        className="border rounded-[7px] shadow-md p-0.5 bg-white transition-all duration-500 ease-in-out"
        style={{ opacity: alive ? 1 : 0.4 }}
      >
        {!data && <p>Loading data...</p>}
        {data && (
          <>
            

            <div className="relative">
              <DecisionMatrix
                gridData={combinedData}
                randomFillEnabled={randomFillEnabled}
              />

              {/* Position + BB display near bottom center */}
              <div className="absolute left-1/2 bottom-0 transform -translate-x-1/2 translate-y-7/4 z-10">
                <div className="bg-white/80 rounded-md p-1 border-2">
                  <h2
                    className="text-center font-bold text-gray-800"
                    style={{ fontSize: "calc(0.6rem + 0.3vw)" }}
                  >
                    {data.Position ? (
                      <span className="p-0.5 px-0 rounded-lg">
                        {data.Position} {data.bb}bb
                      </span>
                    ) : (
                      file
                    )}
                  </h2>
                </div>
              </div>
            </div>
            {/* ColorKey aligned top-right */}
            <div className="select-none flex w-full items-center justify-end mt-0.5">
              <ColorKey
                data={combinedData}
                onActionClick={(action) => onActionClick(action, file)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Plate;
