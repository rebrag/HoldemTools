// src/components/Plate.tsx
import React, { useEffect, useState, CSSProperties } from "react";
import { combineDataByHand, HandCellData, JsonData } from "../utils/utils";
import ColorKey from "./ColorKey";
import DecisionMatrix from "./DecisionMatrix";
import DealerButton from "./DealerButton";
import { AnimatePresence, motion } from "framer-motion";

/* ───────────────────── props ───────────────────── */
interface PlateProps {
  file: string;
  data: JsonData | undefined;            // may be undefined while loading
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

/* ───────────────────── skeleton ───────────────────── */
const Skeleton: React.FC = () => (
  <div className="w-full">
    {/* 13×13 grey grid */}
    <div className="grid grid-cols-13 gap-[1px] w-full aspect-square">
      {Array.from({ length: 169 }).map((_, i) => (
        <div
          key={i}
          className="bg-gray-200 w-full h-full rounded-sm"
        />
      ))}
    </div>

    {/* three grey colour-key buttons */}
     <div className="flex gap-0.5 mt-1 w-full">
   {Array.from({ length: 3 }).map((_, i) => (
     <div
      key={i}
      className="flex-1 min-w-0 rounded bg-gray-200/70 animate-pulse"
      style={{ height: "calc(20px + 1vw)" }}
     />
   ))}
 </div>
  </div>
);

/* ──────────────────── component ──────────────────── */
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
  /* keep previous data until new JSON arrives */
  const [displayData, setDisplayData] = useState<JsonData | undefined>(
    data && Object.keys(data).length ? data : undefined
  );

  useEffect(() => {
    if (data && Object.keys(data).length) setDisplayData(data);
  }, [data]);

  /* grid conversion */
  const [combinedData, setCombinedData] = useState<HandCellData[]>([]);
  useEffect(() => {
    if (displayData) setCombinedData(combineDataByHand(displayData));
  }, [displayData]);

  /* helpers */
  const fmtBB = (v: number) =>
    Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1);

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

  /* ───────────────────── render ───────────────────── */
  return (
    <div className={outerCls} style={sizeStyle}>
      {/* dealer button */}
      {displayData?.Position === "BTN" && (
        <div
          className="absolute z-0"
          style={{ top: "-16%", right: "-8%", width: "33%", aspectRatio: "1" }}
        >
          <DealerButton />
        </div>
      )}

      {/* plate background – now a motion.div so it animates with the grid */}
      <motion.div
        /* share a layout context with the grid so they morph together */
        layout
        layoutId={`plate-${displayData?.Position ?? file}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: alive ? 1 : 0.4 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="border rounded-[7px] shadow-md p-0.5 bg-white relative z-10"
        style={{ opacity: alive ? 1 : 0.4 }}
      >
        {/* FULL PLATE or SKELETON */}
        <AnimatePresence mode="wait" initial={false}>
          {displayData ? (
            /* ───── full plate ───── */
            <motion.div
              key="full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative"
            >
              {/* decision-matrix grid */}
              <motion.div
                layoutId={`matrix-${displayData.Position}`}
                className="cursor-pointer"
              >
                <DecisionMatrix
                  gridData={combinedData}
                  randomFillEnabled={randomFillEnabled}
                  isICMSim={isICMSim}
                  onMatrixClick={() =>
                    onMatrixZoom?.(
                      combinedData,
                      displayData.Position,
                      isICMSim,
                      displayData.Position
                    )
                  }
                />
              </motion.div>

              {/* badges */}
              <div className="absolute left-1/2 -bottom-8 -translate-x-1/2 z-30 pointer-events-none">
                <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-1 text-xs shadow text-center whitespace-nowrap">
                  <strong>{displayData.Position}</strong>&nbsp;
                  {fmtBB(displayData.bb - playerBet)} bb
                </div>
              </div>

              {playerBet !== 0 && (
                <div className="absolute left-[85%] -bottom-6 -translate-x-1/2 z-30 pointer-events-none">
                  <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-0 text-xs shadow text-center whitespace-nowrap">
                    <strong>Bet:</strong>&nbsp;{fmtBB(playerBet)} bb
                  </div>
                </div>
              )}

              {isActive && potOdds > 0 && (
                <div className="absolute left-[15%] -bottom-8 -translate-x-1/2 z-30 pointer-events-none">
                  <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-0 text-xs shadow text-center whitespace-nowrap">
                    <strong>Pot&nbsp;Odds:</strong>
                    <br />
                    {potOdds.toFixed(0)}%
                  </div>
                </div>
              )}

              {/* colour-key */}
              <div
                data-intro-target={
                  displayData.Position === "BTN" ? "color-key-btn" : undefined
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
            </motion.div>
          ) : (
            /* ───── skeleton ───── */
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Skeleton />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* decorative cards */}
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
