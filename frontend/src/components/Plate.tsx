/* ─────────────────────  Plate.tsx  (full file) ───────────────────── */
import React, { CSSProperties, useEffect, useMemo, useState } from "react";
import { combineDataByHand, HandCellData, JsonData } from "../utils/utils";
import ColorKey from "./ColorKey";
import DecisionMatrix from "./DecisionMatrix";
import DealerButton from "./DealerButton";
import { motion } from "framer-motion";

/* ───────────────────── helpers ───────────────────── */

const HAND_ORDER = [
  "AA","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s",
  "AKo","KK","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","K3s","K2s",
  "AQo","KQo","QQ","QJs","QTs","Q9s","Q8s","Q7s","Q6s","Q5s","Q4s","Q3s","Q2s",
  "AJo","KJo","QJo","JJ","JTs","J9s","J8s","J7s","J6s","J5s","J4s","J3s","J2s",
  "ATo","KTo","QTo","JTo","TT","T9s","T8s","T7s","T6s","T5s","T4s","T3s","T2s",
  "A9o","K9o","Q9o","J9o","T9o","99","98s","97s","96s","95s","94s","93s","92s",
  "A8o","K8o","Q8o","J8o","T8o","98o","88","87s","86s","85s","84s","83s","82s",
  "A7o","K7o","Q7o","J7o","T7o","97o","87o","77","76s","75s","74s","73s","72s",
  "A6o","K6o","Q6o","J6o","T6o","96o","86o","76o","66","65s","64s","63s","62s",
  "A5o","K5o","Q5o","J5o","T5o","95o","85o","75o","65o","55","54s","53s","52s",
  "A4o","K4o","Q4o","J4o","T4o","94o","84o","74o","64o","54o","44","43s","42s",
  "A3o","K3o","Q3o","J3o","T3o","93o","83o","73o","63o","53o","43o","33","32s",
  "A2o","K2o","Q2o","J2o","T2o","92o","82o","72o","62o","52o","42o","32o","22"
];

const EMPTY_GRID: HandCellData[] = HAND_ORDER.map((hand) => ({
  hand,
  actions: {} as Record<string, number>,
  evs: {} as Record<string, number>
}));

/* ───────────────────── props ───────────────────── */
interface PlateProps {
  file: string;
  data: JsonData | undefined;
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
  onMatrixZoom
}) => {
  /* keep the last **valid** JSON so we don't flash back to zeros */
  const [displayData, setDisplayData] = useState<JsonData | undefined>(data);
  useEffect(() => {
    if (data) setDisplayData(data);
  }, [data]);

  /* is this plate still waiting for its first ever JSON? */
  const keyLoading = !displayData;

  /* grid for DecisionMatrix & ColorKey */
  const gridData: HandCellData[] = useMemo(() => {
    if (!displayData) return EMPTY_GRID;
    return combineDataByHand(displayData);
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
    "relative mb-10 justify-self-center max-w-[400px] w-full text-base " +
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

      {/* plate background */}
      <motion.div
        layout
        className="border rounded-[7px] shadow-md p-0.5 bg-white relative z-10"
        style={{ opacity: alive ? 1 : 0.3 }}
        initial={false}
        animate={{ opacity: alive ? 1 : 0.3, scale: 1 }}
        transition={{ duration: 0.25 }}
      >
        {/* decision-matrix grid */}
        <div className="relative">
          <div
            className="cursor-pointer"
            onClick={() =>
              displayData &&
              onMatrixZoom?.(
                gridData,
                displayData.Position,
                isICMSim,
                displayData.Position
              )
            }
          >
            <DecisionMatrix
              gridData={gridData}
              randomFillEnabled={randomFillEnabled && !!displayData}
              isICMSim={isICMSim}
            />
          </div>

          {/* ─────  BADGES  (equal thirds)  ───── */}
          {displayData && (
            <div className="absolute -bottom-7 left-0 w-full flex text-xs pointer-events-none z-30">
              {/* left 1/3 – Pot Odds (only when active & available) */}
              <div className="w-1/3 flex justify-center">
                {isActive && potOdds > 0 && (
                  <div className="bg-white/70 backdrop-blur-sm rounded-md px-1 py-0 shadow text-center whitespace-nowrap">
                    <strong>Pot&nbsp;Odds:</strong>
                    <br />
                    {potOdds.toFixed(0)}%
                  </div>
                )}
              </div>

              {/* middle 1/3 – Position + stack */}
              <div className="w-1/3 flex justify-center">
                <div className="bg-white/70 backdrop-blur-sm rounded-md px-0.5 py-1 shadow text-center whitespace-nowrap">
                  <strong>{displayData.Position}</strong>&nbsp;
                  {fmtBB(displayData.bb - playerBet)} bb
                </div>
              </div>

              {/* right 1/3 – Bet size (if any) */}
              <div className="w-1/3 flex justify-center">
                {playerBet !== 0 && (
                  <div className="bg-white/70 backdrop-blur-sm rounded-md px-1 py-1 shadow text-center whitespace-nowrap">
                    <strong>Bet:</strong>&nbsp;{fmtBB(playerBet)} bb
                  </div>
                )}
              </div>
            </div>
          )}

          {/* colour-key – always rendered; shows skeleton while loading */}
          <div className="select-none flex w-full items-center justify-end mt-0.5">
            <ColorKey
              data={gridData}
              loading={keyLoading}
              onActionClick={(action) => onActionClick(action, file)}
            />
          </div>
        </div>
      </motion.div>

      {/* decorative cards */}
      {/* ───────── decorative cards (always perfectly centred) ───────── */}
      {alive && (
        <div className="absolute inset-x-0 -bottom-9 flex justify-center -z-0">
          <div className="relative w-18 h-18">
            {/* left-tilted card */}
            <img
              src="/playing-cards.svg"
              alt="cards"
              className="absolute inset-0 w-full h-full transform rotate-[0deg] translate-x-[-8%]"
            />
            {/* right-tilted card */}
            <img
              src="/playing-cards.svg"
              alt="cards"
              className="absolute inset-0 w-full h-full transform -rotate-[0deg] translate-x-[8%]"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Plate;
