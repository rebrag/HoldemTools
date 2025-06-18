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
  plateWidth?: number;
  isActive?: boolean;
  pot?: number;     // NEW: Total pot
  maxBet?: number;  // NEW: The highest current bet to call
  onMatrixZoom?: (grid: HandCellData[], title: string, isICM: boolean) => void; /* ⭐ NEW prop */
}

const Plate: React.FC<PlateProps> = ({
  file,
  data,
  onActionClick,
  randomFillEnabled,
  alive,
  playerBet = 0,
  isICMSim,
  plateWidth,
  isActive = false,
  pot,
  maxBet,
  onMatrixZoom,                                        /* ⭐ receive it */
}) => {
  const [combinedData, setCombinedData] = useState<HandCellData[]>([]);

  useEffect(() => {
    if (data) setCombinedData(combineDataByHand(data));
  }, [data]);

  const formatBB = (v: number) =>
    Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1);

  // --- Pot odds calculation ---
  const potOdds =
    pot != null && maxBet != null && maxBet > 0
      ? ((maxBet - playerBet)/ (pot + maxBet-playerBet)) * 100
      : 0;

  /* ---------- outer wrapper ---------- */
  const outerClasses =
    "relative mb-8 justify-self-center max-w-[400px] w-full text-base " +
    (isActive
      ? "ring-4 ring-white shadow-yellow-400/50 rounded-md"
      : "");

  const fixedSizeStyle =
    plateWidth != null
      ? { width: plateWidth, maxWidth: plateWidth, minWidth: plateWidth }
      : undefined;

  return (
    <div className={outerClasses} style={fixedSizeStyle}>
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
                onMatrixClick={() =>
                  onMatrixZoom?.(combinedData, data.Position, !!isICMSim)
                }
              />

              {/* Position + BB badge */}
              <div className="absolute left-1/2 -bottom-16 -translate-x-1/2 z-30 pointer-events-none">
                <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-1 text-xs shadow text-center whitespace-nowrap">
                  <strong>{data.Position}</strong>&nbsp;
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

              {/* Pot-odds badge (NEW) */}
              {isActive && potOdds > 0 && (
                <div className="absolute left-1/8 -bottom-16 -translate-x-1/2 z-30 pointer-events-none">
                  <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-0 text-xs shadow text-center whitespace-nowrap">
                    <strong>Pot Odds:</strong>&nbsp;
                    <br></br>
                    {potOdds.toFixed(0)}%
                  </div>
                </div>
              )}
            </div>

            {/* Color key */}
            <div
              data-intro-target={data.Position === "BTN" ? "color-key-btn" : undefined}
              className={
                "select-none flex w-full items-center justify-end mt-0.5 " +
                (isActive ? "animate-pulse" : "")
              }
            >
              <ColorKey
                data={combinedData}
                onActionClick={(action) => onActionClick(action, file)}
              />
            </div>
          </>
        )}
      </div>

      {/* Playing-cards SVGs */}
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