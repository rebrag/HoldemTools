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
  isICMSim,
}) => {
  const [combinedData, setCombinedData] = useState<HandCellData[]>([]);

  useEffect(() => {
    if (data) setCombinedData(combineDataByHand(data));
  }, [data]);

  const formatBB = (v: number) =>
    Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1);

  return (
    <div className="relative mb-8 justify-self-center max-w-[400px] w-full text-base">
      {/* Dealer button */}
      {data?.Position === "BTN" && (
        <div
          className="absolute z-0"
          style={{ top: "-16%", right: "-8%", width: "33%", aspectRatio: "1" }}
        >
          <DealerButton />
        </div>
      )}

      {/* Plate background (z-10) */}
      <div
        className="border rounded-[7px] shadow-md p-0.5 bg-white transition-opacity duration-500 ease-in-out relative z-10"
        style={{ opacity: alive ? 1 : 0.4 }}
      >
        {data && (
          <>
            <div className="relative">
              <DecisionMatrix
                gridData={combinedData}
                randomFillEnabled={randomFillEnabled}
                isICMSim={isICMSim}
              />

              {/* Position + BB badge */}
              <div className="absolute left-1/2 -bottom-16 -translate-x-1/2 z-30 pointer-events-none">
                <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-1 text-xs shadow text-center">
                  <strong>{data.Position} </strong>
                  {formatBB(data.bb - playerBet)} bb
                </div>
              </div>

              {/* Player-bet badge */}
              {playerBet !== 0 && (
                <div className="absolute left-5/6 -bottom-14 -translate-x-1/2 z-30 pointer-events-none">
                  <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-0 text-xs shadow text-center whitespace-nowrap">
                    <strong>Bet:</strong>&nbsp;{formatBB(playerBet)} bb
                  </div>
                </div>
              )}

            </div>

            {/* Color key */}
            <div
              data-intro-target={data.Position === "BTN" ? "color-key-btn" : undefined}
              className="select-none flex w-full items-center justify-end mt-0.5"
            >
              <ColorKey
                data={combinedData}
                onActionClick={(action) => onActionClick(action, file)}
              />
            </div>
          </>
        )}
      </div>

      {/* Playing-cards SVGs (alive only, z-0) */}
      {alive && (
        <div className="absolute left-1/2 -bottom-9 -translate-x-1/2 -z-0 flex">
          <img src="/playing-cards.svg" alt="cards" className="w-18 h-18" />
          <img src="/playing-cards.svg" alt="cards" className="w-18 h-18 -ml-8" />
        </div>
      )}
    </div>
  );
};

export default Plate;
