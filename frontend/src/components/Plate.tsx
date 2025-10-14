/* ─────────────────────  Plate.tsx  (full file) ───────────────────── */
import React, {
  CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
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

/* ───────────────────── AutoFitText (single-line, auto-scaling) ───────────────────── */
const AutoFitText: React.FC<{
  children: ReactNode;
  minPx?: number;
  maxPx?: number;
  className?: string;
  title?: string;
}> = ({ children, minPx = 8, maxPx = 14, className = "", title }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<number>(maxPx);
  const [scale, setScale] = useState<number>(1);

  const fit = () => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;

    const maxW = wrap.clientWidth;
    if (maxW <= 0) return;

    inner.style.fontSize = `${maxPx}px`;
    inner.style.whiteSpace = "nowrap";
    inner.style.transform = "scale(1)";
    inner.style.transformOrigin = "center";

    let lo = minPx;
    let hi = maxPx;
    let best = minPx;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      inner.style.fontSize = `${mid}px`;
      const tooWide = inner.scrollWidth > maxW;
      if (!tooWide) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }

    setSize(best);
    inner.style.fontSize = `${best}px`;
    const widthAtBest = inner.scrollWidth;
    if (widthAtBest > maxW) {
      const s = Math.max(0.75, maxW / widthAtBest);
      setScale(s);
    } else {
      setScale(1);
    }
  };

  useEffect(() => {
    fit();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  return (
    <div
      ref={wrapRef}
      className={`w-full overflow-hidden ${className}`}
      title={title}
      style={{ lineHeight: 1.05 }}
    >
      <span
        ref={innerRef}
        style={{
          fontSize: size,
          display: "inline-block",
          whiteSpace: "nowrap",
          transform: `scale(${scale})`,
          transformOrigin: "center",
          willChange: "transform",
        }}
      >
        {children}
      </span>
    </div>
  );
};

/* ───────────────────── PlateZoom payload ───────────────────── */
export type PlateZoomPayload = {
  id: string;
  position: string;
  grid: HandCellData[];
  isICMSim: boolean;
  stackBB: number;
  playerBet: number;
  pot?: number;
  maxBet?: number;
  potOddsPct: number;
  isActive: boolean;
  alive: boolean;
  file: string;
};

/* ───────────────────── props ───────────────────── */
interface PlateProps {
  plateId?: string;  // stable id for shared layout (pass file)
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
  onPlateZoom?: (payload: PlateZoomPayload) => void;
}

/* ──────────────────── component ──────────────────── */
const Plate: React.FC<PlateProps> = ({
  plateId,
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
  onPlateZoom
}) => {
  const [displayData, setDisplayData] = useState<JsonData | undefined>(data);
  useEffect(() => { if (data) setDisplayData(data); }, [data]);

  const keyLoading = !displayData;

  const gridData: HandCellData[] = useMemo(() => {
    if (!displayData) return EMPTY_GRID;
    return combineDataByHand(displayData);
  }, [displayData]);

  const fmtBB = (v: number) => (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1));

  const potOdds =
    pot != null && maxBet != null && maxBet > playerBet
      ? ((maxBet - playerBet) / (pot + maxBet - playerBet)) * 100
      : 0;

  const outerCls =
    "relative mb-10 justify-self-center max-w-[400px] w-full text-base";

  const sizeStyle: CSSProperties | undefined =
    plateWidth != null
      ? { width: plateWidth, maxWidth: plateWidth, minWidth: plateWidth }
      : undefined;

  const showBet = playerBet !== 0;
  const showPotOdds = isActive && showBet;
  const baseCols = 2;
  const infoCols = baseCols + (showBet ? 1 : 0) + (showPotOdds ? 1 : 0);
  const colsClass =
    infoCols === 4 ? "grid-cols-4" : infoCols === 3 ? "grid-cols-3" : "grid-cols-2";

  const stableId = plateId ?? file;

  return (
    <div className={outerCls} style={sizeStyle}>
      {/* Entire plate wrapper animates; overflow visible so background adornments can extend out */}
      <motion.div
        layout
        layoutId={`plate-${stableId}`}
        className="relative overflow-visible"
        initial={false}
        animate={{ scale: isActive ? 1.02 : 1, opacity: alive ? 1 : 0.3 }}
        transition={{ duration: 0.25 }}
      >
        {/* ===== Background adornments (BEHIND panel) ===== */}
        {/* Dealer button: top-right, behind panel, can extend outside */}
        {displayData?.Position === "BTN" && (
          <div
            className="absolute z-0"
            style={{ top: "-16%", right: "-8%", width: "33%", aspectRatio: "1" }}
          >
            <DealerButton />
          </div>
        )}

        {/* Decorative cards: bottom center, behind panel, extend outside */}
        {alive && (
          <div className="absolute inset-x-0 -bottom-9 flex justify-center z-0 pointer-events-none">
            <div className="relative w-18 h-18">
              <img
                src="/playing-cards.svg"
                alt="cards"
                className="absolute inset-0 w-full h-full transform rotate-[0deg] translate-x-[-8%]"
              />
              <img
                src="/playing-cards.svg"
                alt="cards"
                className="absolute inset-0 w-full h-full transform -rotate-[0deg] translate-x-[8%]"
              />
            </div>
          </div>
        )}

        {/* ===== Foreground panel (white card) ===== */}
        <div
          className={`relative z-10 border rounded-[7px] shadow-md p-0.5 bg-white ${
            isActive ? "border-emerald-400" : "border-gray-200"
          }`}
        >
          {/* decision-matrix grid */}
          <div className="relative">
            <div
              className="cursor-pointer"
              onClick={() => {
                if (!displayData) return;
                onPlateZoom?.({
                  id: stableId,
                  position: displayData.Position,
                  grid: gridData,
                  isICMSim,
                  stackBB: displayData.bb - playerBet,
                  playerBet,
                  pot,
                  maxBet,
                  potOddsPct: Math.max(0, potOdds),
                  isActive,
                  alive,
                  file
                });
              }}
            >
              <DecisionMatrix
                gridData={gridData}
                randomFillEnabled={randomFillEnabled && !!displayData}
                isICMSim={isICMSim}
              />
            </div>

            {/* colour-key */}
            <div className="select-none flex w-full items-center justify-end mt-0.5">
              <ColorKey
                data={gridData}
                loading={keyLoading}
                onActionClick={(action) => onActionClick(action, file)}
              />
            </div>

            {/* info row */}
            {displayData && (
              <div className="mt-1 w-full">
                <div className={`grid gap-1 w-full ${colsClass}`}>
                  <div className="min-w-0 bg-white/80 backdrop-blur-sm rounded-md px-0 py-1 shadow text-center overflow-hidden">
                    <AutoFitText title="Position">
                      <strong>{displayData.Position}</strong>
                    </AutoFitText>
                  </div>

                  <div className="min-w-0 bg-white/80 backdrop-blur-sm rounded-md px-0 py-1 shadow text-center overflow-hidden">
                    <AutoFitText title="Stack">
                      <strong>Stack:</strong>&nbsp;{fmtBB(displayData.bb - playerBet)}&nbsp;bb
                    </AutoFitText>
                  </div>

                  {showBet && (
                    <div className="min-w-0 bg-white/80 backdrop-blur-sm rounded-md px-0 py-1 shadow text-center overflow-hidden">
                      <AutoFitText title="Bet">
                        <strong>Bet:</strong>&nbsp;{fmtBB(playerBet)}&nbsp;bb
                      </AutoFitText>
                    </div>
                  )}

                  {showPotOdds && (
                    <div className="min-w-0 bg-white/80 backdrop-blur-sm rounded-md px-0 py-1 shadow text-center overflow-hidden">
                      <AutoFitText title="Pot Odds">
                        <strong>Pot&nbsp;Odds:</strong>&nbsp;{Math.max(0, potOdds).toFixed(0)}%
                      </AutoFitText>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===== Top overlays (above panel) ===== */}
        {isActive && (
          <>
            <div className="pointer-events-none absolute -inset-1 rounded-[9px] ring-2 ring-emerald-400/80 shadow-[0_0_0_6px_rgba(16,185,129,0.18)] animate-pulse z-20" />
            <div className="absolute -top-3 -right-3 z-20">
              <span className="text-[10px] bg-emerald-600 text-white rounded px-1.5 py-0.5 shadow">
                ACTION
              </span>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
};

export default Plate;
