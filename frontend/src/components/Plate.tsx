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
  playerBet?: number;
  isICMSim?: boolean;
}

const Plate: React.FC<PlateProps> = ({
  file,
  data,
  onActionClick,
  randomFillEnabled,
  alive,
  playerBet = 0, 
  isICMSim // ✅ Add this here too
}) => {
  const [combinedData, setCombinedData] = useState<HandCellData[]>([]);

  useEffect(() => {
    if (data) {
      const processed = combineDataByHand(data);
      setCombinedData(processed);
    }
  }, [data]);

  // useEffect(() => {
  //   console.log("Plate render:", {
  //     position: data.Position,
  //     file,
  //     playerBet,
  //     alive,
  //   });
  // }, [file, data, playerBet, alive]);
  

  const formatBB = (value: number) => {
    return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  };

  return (
    <div className="relative mb-6 justify-self-center max-w-[400px] w-full text-base">
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
        className="border rounded-[7px] shadow-md p-0.5 bg-white transition-all duration-500 ease-in-out relative z-10"
        style={{ opacity: alive ? 1 : 0.4 }}
      >
        {!data && <p>Loading data...</p>}
        {data && (
          <>
            <div className="relative">
              <DecisionMatrix
                gridData={combinedData}
                randomFillEnabled={randomFillEnabled}
                isICMSim={isICMSim}
              />
              {/* Position + BB display near bottom center */}
              <>
                <div className="absolute left-1/2 -bottom-14 transform -translate-x-1/2 z-10">
                  <div className="bg-white/90 rounded-md p-1 border-2">
                    <h2
                      className="text-center font-bold text-gray-800"
                      style={{ fontSize: "calc(0.6rem + 0.3vw)" }}
                    >
                      {data.Position ? (
                        <span className="p-0.5 px-0 rounded-lg z-50">
                          {data.Position} {formatBB(data.bb - playerBet)}bb 
                        </span> //
                      ) : (
                        file
                      )}
                    </h2>
                  </div>
                </div>
                {/* Player Bet floating slightly to the right of the first box */}
                {playerBet !== 0 && (
                  <div className="absolute left-5/6 -bottom-14 transform -translate-x-1/2 z-10">
                    <div className="bg-white/90 rounded-md p-0.5 border-2 ">
                      <span // 
                        className="text-center font-medium text-gray-800"
                        style={{ fontSize: "calc(0.6rem + 0.3vw)" }}
                      >
                        <span className="p-0.5 px-1 py-0 rounded-lg z-50">{formatBB(playerBet)}bb</span>
                      </span>
                    </div>
                  </div>
                )}
              </>

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
