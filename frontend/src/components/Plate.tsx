// src/components/Plate.tsx
import React, { useEffect, useState, CSSProperties } from "react";
import { combineDataByHand, HandCellData, JsonData } from "../utils/utils";
import ColorKey from "./ColorKey";
import DecisionMatrix from "./DecisionMatrix";
import DealerButton from "./DealerButton";
import { AnimatePresence, motion } from "framer-motion";

/* ─────────────  props  ───────────── */
interface PlateProps {
  file: string;
  data: JsonData | undefined;          // ← may be undefined while loading
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

/* ─────────────  skeleton  ───────────── */
const Skeleton: React.FC = () => (
  <div className="w-full" aria-label="loading">
    <div className="w-full aspect-square rounded-md bg-gray-200 animate-pulse" />
    <div className="mt-1 h-4 rounded bg-gray-200/70 animate-pulse" />
  </div>
);

/* ─────────────  component  ───────────── */
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
  /* ---------- keep “previous” data until next JSON arrives ---------- */
  const [displayData, setDisplayData] = useState<JsonData | undefined>(
    data && Object.keys(data).length ? data : undefined
  );

  /* real grid comes in → update displayData */
  useEffect(() => {
    if (data && Object.keys(data).length) setDisplayData(data);
  }, [data]);

  /* convert to hand-cell grid whenever displayData changes */
  const [combinedData, setCombinedData] = useState<HandCellData[]>([]);
  useEffect(() => {
    if (displayData) setCombinedData(combineDataByHand(displayData));
  }, [displayData]);

  /* ---------- helpers ---------- */
  const fmtBB = (v: number) => (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1));

  const potOdds =
    pot != null && maxBet != null && maxBet > playerBet
      ? ((maxBet - playerBet) / (pot + maxBet - playerBet)) * 100
      : 0;

  /* ---------- sizing ---------- */
  const outerCls =
    "relative mb-8 justify-self-center max-w-[400px] w-full text-base " +
    (isActive ? "ring-4 ring-white shadow-yellow-400/50 rounded-md" : "");

  const sizeStyle: CSSProperties | undefined =
    plateWidth != null
      ? { width: plateWidth, maxWidth: plateWidth, minWidth: plateWidth }
      : undefined;

  /* ==========================================================
     render
     ========================================================== */
  return (
    <div className={outerCls} style={sizeStyle}>
      {/* dealer button only if final JSON says this is BTN */}
      {displayData?.Position === "BTN" && (
        <div
          className="absolute z-0"
          style={{ top: "-16%", right: "-8%", width: "33%", aspectRatio: "1" }}
        >
          <DealerButton />
        </div>
      )}

      <div
        className="border rounded-[7px] shadow-md p-0.5 bg-white transition-opacity duration-500 relative z-10"
        style={{ opacity: alive ? 1 : 0.4 }}
      >
        <div className="relative">
          <AnimatePresence mode="wait" initial={false}>
            {displayData ? (
              /* -------- real grid -------- */
              <motion.div
                key="grid"
                layoutId={`matrix-${displayData.Position}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
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
            ) : (
              /* -------- skeleton -------- */
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

          {/* ­­­badges (show only when we have real data) */}
          {displayData && (
            <>
              <div className="absolute left-1/2 -bottom-16 -translate-x-1/2 z-30 pointer-events-none">
                <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-1 text-xs shadow text-center whitespace-nowrap">
                  <strong>{displayData.Position}</strong>&nbsp;
                  {fmtBB(displayData.bb - playerBet)} bb
                </div>
              </div>

              {playerBet !== 0 && (
                <div className="absolute left-[85%] -bottom-14 -translate-x-1/2 z-30 pointer-events-none">
                  <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-0 text-xs shadow text-center whitespace-nowrap">
                    <strong>Bet:</strong>&nbsp;{fmtBB(playerBet)} bb
                  </div>
                </div>
              )}

              {isActive && potOdds > 0 && (
                <div className="absolute left-[15%] -bottom-16 -translate-x-1/2 z-30 pointer-events-none">
                  <div className="bg-white/70 backdrop-blur-sm rounded-md px-2 py-0 text-xs shadow text-center whitespace-nowrap">
                    <strong>Pot&nbsp;Odds:</strong>
                    <br />
                    {potOdds.toFixed(0)}%
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* color-key bar (only with real data) */}
        {displayData && (
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
        )}
      </div>

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
