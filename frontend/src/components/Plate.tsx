// src/components/Plate.tsx
import React, { useEffect, useState, CSSProperties } from "react";
import { combineDataByHand, HandCellData, JsonData } from "../utils/utils";
import ColorKey from "./ColorKey";
import DecisionMatrix from "./DecisionMatrix";
import DealerButton from "./DealerButton";
import { motion } from "framer-motion";

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
  pot?: number;
  maxBet?: number;
  onMatrixZoom?: (
    grid: HandCellData[],
    title: string,
    isICM: boolean,
    id: string
  ) => void;
}

const Plate: React.FC<PlateProps> = ({
  file,
  data,
  onActionClick,
  randomFillEnabled = false,
  alive,
  playerBet = 0,
  isICMSim = false,
  plateWidth,
  isActive = false,
  pot,
  maxBet,
  onMatrixZoom,
}) => {
  /* ---------- data prep ---------- */
  const [combinedData, setCombinedData] = useState<HandCellData[]>([]);
  useEffect(() => {
    if (data) setCombinedData(combineDataByHand(data));
  }, [data]);

  const fmtBB = (v: number) =>
    Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1);

  /* pot-odds for active player */
  const potOdds =
    pot != null && maxBet != null && maxBet > playerBet
      ? ((maxBet - playerBet) / (pot + maxBet - playerBet)) * 100
      : 0;

  /* sizing */
  const outerCls =
    "relative mb-8 justify-self-center max-w-[400px] w-full text-base " +
    (isActive ? "ring-4 ring-white shadow-yellow-400/50 rounded-md" : "");

  const sizeStyle: CSSProperties | undefined =
    plateWidth != null
      ? { width: plateWidth, maxWidth: plateWidth, minWidth: plateWidth }
      : undefined;

  /* ---------- render ---------- */
  return (
    <div className={outerCls} style={sizeStyle}>
      {/* dealer button */}
      {data?.Position === "BTN" && (
        <div
          className="absolute z-0"
          style={{ top: "-16%", right: "-8%", width: "33%", aspectRatio: "1" }}
        >
          <DealerButton />
        </div>
      )}

      {/* plate background */}
      <div
        className="border rounded-[7px] shadow-md p-0.5 bg-white transition-opacity duration-500 ease-in-out relative z-10"
        style={{ opacity: alive ? 1 : 0.4 }}
      >
        {data && (
          <>
            {/* ----- grid + badges ----- */}
            <div className="relative">
              {/* clickable DecisionMatrix — shares layoutId with overlay */}
              <motion.div layoutId={`matrix-${data.Position}`} className="cursor-pointer">
                <DecisionMatrix
                  gridData={combinedData}
                  randomFillEnabled={randomFillEnabled}
                  isICMSim={isICMSim}
                  onMatrixClick={() =>
                    onMatrixZoom?.(combinedData, data.Position, isICMSim, data.Position)
                  }
                />
              </motion.div>

              {/* stack-size badge */}
              <div className="absolute left-1/2 -bottom-16 -translate-x-1/2 z-30 pointer-events-none">
                <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-1 text-xs shadow text-center whitespace-nowrap">
                  <strong>{data.Position}</strong>&nbsp;
                  {fmtBB(data.bb - playerBet)} bb
                </div>
              </div>

              {/* bet badge */}
              {playerBet !== 0 && (
                <div className="absolute left-[85%] -bottom-14 -translate-x-1/2 z-30 pointer-events-none">
                  <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-0 text-xs shadow text-center whitespace-nowrap">
                    <strong>Bet:</strong>&nbsp;{fmtBB(playerBet)} bb
                  </div>
                </div>
              )}

              {/* pot-odds badge */}
              {isActive && potOdds > 0 && (
                <div className="absolute left-[15%] -bottom-16 -translate-x-1/2 z-30 pointer-events-none">
                  <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-0 text-xs shadow text-center whitespace-nowrap">
                    <strong>Pot&nbsp;Odds:</strong>
                    <br />
                    {potOdds.toFixed(0)}%
                  </div>
                </div>
              )}
            </div>

            {/* color key */}
            <div
              data-intro-target={
                data.Position === "BTN" ? "color-key-btn" : undefined
              }
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

      {/* decorative cards */}
      {alive && (
        <div className="absolute left-1/2 -bottom-9 -translate-x-1/2 -z-0 flex">
          <img src="/playing-cards.svg" alt="cards" className="w-18 h-18" />
          <img
            src="/playing-cards.svg"
            alt="cards"
            className="w-18 h-18 -ml-8"
          />
        </div>
      )}
    </div>
  );
};

export default Plate;
