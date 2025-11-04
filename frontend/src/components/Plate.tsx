/* eslint-disable react-hooks/exhaustive-deps */
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

/* ── helpers (keep your existing HAND_ORDER / EMPTY_GRID / AutoFitText) ── */
const HAND_ORDER = [ "AA","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s", "AKo","KK","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","K3s","K2s", "AQo","KQo","QQ","QJs","QTs","Q9s","Q8s","Q7s","Q6s","Q5s","Q4s","Q3s","Q2s", "AJo","KJo","QJo","JJ","JTs","J9s","J8s","J7s","J6s","J5s","J4s","J3s","J2s", "ATo","KTo","QTo","JTo","TT","T9s","T8s","T7s","T6s","T5s","T4s","T3s","T2s", "A9o","K9o","Q9o","J9o","T9o","99","98s","97s","96s","95s","94s","93s","92s", "A8o","K8o","Q8o","J8o","T8o","98o","88","87s","86s","85s","84s","83s","82s", "A7o","K7o","Q7o","J7o","T7o","97o","87o","77","76s","75s","74s","73s","72s", "A6o","K6o","Q6o","J6o","T6o","96o","86o","76o","66","65s","64s","63s","62s", "A5o","K5o","Q5o","J5o","T5o","95o","85o","75o","65o","55","54s","53s","52s", "A4o","K4o","Q4o","J4o","T4o","94o","84o","74o","64o","54o","44","43s","42s", "A3o","K3o","Q3o","J3o","T3o","93o","83o","73o","63o","53o","43o","33","32s", "A2o","K2o","Q2o","J2o","T2o","92o","82o","72o","62o","52o","42o","32o","22" ];
const EMPTY_GRID: HandCellData[] = HAND_ORDER.map((hand) => ({
  hand,
  actions: {} as Record<string, number>,
  evs: {} as Record<string, number>
}));

/** Smart numeric formatter: show decimals only when needed */
const fmt = (n: number, decimals = 1) =>
  Math.abs(n % 1) > 1e-9 ? n.toFixed(decimals) : n.toFixed(0);

const AutoFitText: React.FC<{
  children: ReactNode;
  minPx?: number;
  maxPx?: number;
  className?: string;
  title?: string;
}> = ({ children, minPx = 6, maxPx = 14, className = "", title }) => {
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
    let lo = minPx, hi = maxPx, best = minPx;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      inner.style.fontSize = `${mid}px`;
      const tooWide = inner.scrollWidth > maxW;
      if (!tooWide) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    setSize(best);
    inner.style.fontSize = `${best}px`;
    const widthAtBest = inner.scrollWidth;
    setScale(widthAtBest > maxW ? Math.max(0.75, maxW / widthAtBest) : 1);
  };
  useEffect(() => { fit(); const wrap = wrapRef.current; if (!wrap) return; const ro = new ResizeObserver(() => fit()); ro.observe(wrap); return () => ro.disconnect(); }, []);
  useEffect(() => { fit(); }, [children]);
  return (
    <div ref={wrapRef} className={`w-full overflow-hidden ${className}`} title={title} style={{ lineHeight: 1.05 }}>
      <span ref={innerRef} style={{ fontSize: size, display: "inline-block", whiteSpace: "nowrap", transform: `scale(${scale})`, transformOrigin: "center", willChange: "transform" }}>
        {children}
      </span>
    </div>
  );
};

/* ───────────────────── types ───────────────────── */
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

interface PlateProps {
  plateId?: string;
  file: string;
  data: JsonData | undefined;
  onActionClick: (action: string, file: string) => void;
  randomFillEnabled?: boolean;
  alive: boolean;
  playerBet?: number;
  isICMSim?: boolean;
  /** Total plate width (from PlateGrid) */
  plateWidth?: number;
  /** Precise split passed from PlateGrid in narrow mode */
  dmWidthPx?: number;
  sidebarWidthPx?: number;
  isActive?: boolean;
  pot?: number;
  maxBet?: number;
  onPlateZoom?: (payload: PlateZoomPayload) => void;
  compact?: boolean;
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
  dmWidthPx,
  sidebarWidthPx,
  isActive = false,
  pot,
  maxBet,
  onPlateZoom,
  compact = false,
}) => {
  const [displayData, setDisplayData] = useState<JsonData | undefined>(data);
  useEffect(() => { if (data) setDisplayData(data); }, [data]);

  const keyLoading = !displayData;

  const gridData: HandCellData[] = useMemo(() => {
    if (!displayData) return EMPTY_GRID;
    return combineDataByHand(displayData);
  }, [displayData]);

  const hasCallAction = useMemo(() => {
    return gridData.some((cell) => {
      const v = (cell.actions as Record<string, number | undefined>)["Call"];
      return (typeof v === "number" ? v > 0 : "Call" in cell.actions);
    });
  }, [gridData]);

  const potOdds =
    pot != null && maxBet != null && maxBet > playerBet
      ? ((maxBet - playerBet) / (pot + maxBet - playerBet)) * 100
      : 0;

  const outerCls =
    `relative ${compact ? "mb-0" : "mb-7"} justify-self-center ${compact ? "max-w-none" : "max-w-[400px]"} w-full text-base`;

  const sizeStyle: CSSProperties | undefined =
    plateWidth != null
      ? { width: plateWidth, maxWidth: plateWidth, minWidth: plateWidth }
      : undefined;

  const dmWidth = compact && dmWidthPx ? dmWidthPx : undefined;
  const sidebarWidth = compact && sidebarWidthPx ? sidebarWidthPx : undefined;

  // convenience numbers used in UI
  const stackBB = ((displayData?.bb ?? 0) - playerBet);
  const betBB = playerBet;

  return (
    <div className={outerCls} style={sizeStyle}>
      <style>{`
        .ck-vertical {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
        }
        .ck-vertical .ck-top {
          flex: 1 1 50%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ck-vertical .ck-bottom {
          flex: 1 1 50%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-end; 
          overflow: visible;
        }
        .ck-vertical .ck-bottom .flex {
          flex-direction: column !important;
          flex-wrap: nowrap !important;
        }
        .ck-vertical .ck-bottom button {
          width: 100% !important;
        }
      `}</style>

      <motion.div
        className="relative overflow-visible will-change-transform"
        initial={false}
        animate={{ scale: isActive ? 1.0 : 1, opacity: alive ? 1 : 0.1 }}
        transition={{ duration: 0.25 }}
      >
        {displayData?.Position === "BTN" && (
          <div className="absolute z-0 pointer-events-none" style={{ top: "-16%", right: "-8%", width: "33%", aspectRatio: "1" }}>
            <DealerButton />
          </div>
        )}

        {/* {alive && !compact && (
          <div className="absolute inset-x-0 -bottom-8 flex justify-center z-0 pointer-events-none">
            <div className="relative w-32 h-32">
              <img src="/playing-cards.svg" alt="cards" className="absolute left-1/2 top-1/2 -translate-x-8/16 -translate-y-1/2 block w-full h-full origin-bottom rotate-[-0deg]" />
              <img src="/playing-cards.svg" alt="cards" className="absolute left-1/2 top-1/2 -translate-x-2/16 -translate-y-1/2 block w-full h-full origin-bottom rotate-[0deg]" />
            </div>
          </div>
        )} */}

        <div className={`relative z-10 border rounded-[7px] shadow-md p-0 bg-white/20 ${isActive ? "border-emerald-400" : "border-gray-200"}`}>
          <div className="relative">
            {compact ? (
              // ── COMPACT (mobile): LEFT DM (square), RIGHT sidebar fills the remainder
              <div className="flex gap-1 items-stretch">
                {/* LEFT: exact DM width; height = width (square) */}
                <div className="relative" style={{ width: dmWidth }}>
                  <div className="relative w-full" style={{ aspectRatio: "1 / 1" }}>
                    <div
                      className="absolute inset-0 cursor-pointer"
                      onClick={() => {
                        if (!displayData) return;
                        onPlateZoom?.({
                          id: plateId ?? file,
                          position: displayData.Position,
                          grid: gridData,
                          isICMSim,
                          stackBB,
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
                  </div>
                </div>

                {/* RIGHT: takes the rest so plate = (half) exactly */}
                <div className="shrink-0 pt-1.5" style={{ width: sidebarWidth, height: dmWidth, minHeight: 0 }}>
                  <div className="ck-vertical">
                    {/* top 50%: info */}
                    {/* top 50%: one shared badge for Position + Stack (+ Bet if present) */}
                    <div className="ck-top">
                      <div className="min-w-0 bg-white/80 backdrop-blur-sm rounded-sm px-0 pt-0 pb-0 shadow text-center overflow-hidden">
                        <AutoFitText title="Position and Stack">
                          <strong>{displayData?.Position ?? ""}</strong>&nbsp;{fmt(stackBB, 1)}bb
                        </AutoFitText>

                        {betBB !== 0 && (
                          <AutoFitText title="Bet">
                            <strong>Bet:</strong>&nbsp;{fmt(betBB, 1)}&nbsp;bb
                          </AutoFitText>
                        )}
                      </div>
                      {/* Pot Odds intentionally hidden in compact mode */}
                    </div>


                    {/* bottom 50%: ColorKey (vertical stack; scroll if overflow) */}
                    <div className="ck-bottom">
                      <ColorKey
                        data={gridData}
                        loading={keyLoading}
                        onActionClick={(action) => onActionClick(action, file)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // ── NON-COMPACT: original stack
              <>
                <div
                  className="cursor-pointer"
                  onClick={() => {
                    if (!displayData) return;
                    onPlateZoom?.({
                      id: plateId ?? file,
                      position: displayData.Position,
                      grid: gridData,
                      isICMSim,
                      stackBB,
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

                <div className="select-none flex w-full items-center justify-end mt-0.5">
                  <ColorKey
                    data={gridData}
                    loading={keyLoading}
                    onActionClick={(action) => onActionClick(action, file)}
                  />
                </div>

                {displayData && (
                  <div className="mt-1 w-full space-y-1">
                    <div className="grid gap-1 w-full" style={{ gridTemplateColumns: "30% 1fr" }}>
                      <div className="min-w-0 bg-white/80 backdrop-blur-sm rounded-md px-0 py-0 shadow text-center overflow-hidden">
                        <AutoFitText title="Position">
                          <strong>{displayData.Position}</strong> 
                        </AutoFitText>
                      </div>
                      <div className="min-w-0  bg-white/80 backdrop-blur-sm rounded-md px-0 py-0 shadow text-center overflow-hidden">
                        <AutoFitText title="Stack">
                          <strong>Stack:</strong>&nbsp;{fmt(stackBB, 1)}&nbsp;bb
                        </AutoFitText>
                      </div>
                    </div>

                    {(playerBet !== 0 || (isActive && hasCallAction)) && (
                      <div className={`grid gap-1 w-full ${playerBet !== 0 && (isActive && hasCallAction) ? "grid-cols-2" : "grid-cols-1"}`}>
                        {(isActive && hasCallAction) && (
                          <div className="min-w-0 bg-white/80 backdrop-blur-sm rounded-md px-0 py-0 shadow text-center overflow-hidden">
                            <AutoFitText title="Pot Odds">
                              <strong>Pot&nbsp;Odds:</strong>&nbsp;{fmt(Math.max(0, potOdds), 1)}%
                            </AutoFitText>
                          </div>
                        )}
                        {playerBet !== 0 && (
                          <div className="min-w-0 bg-white/80 backdrop-blur-sm rounded-md px-0 py-0 shadow text-center overflow-hidden">
                            <AutoFitText title="Bet">
                              <strong>Bet:</strong>&nbsp;{fmt(betBB, 1)}&nbsp;bb
                            </AutoFitText>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {isActive && (
          <>
            <div className="pointer-events-none absolute -inset-1 rounded-[9px] ring-2 ring-emerald-400/80 shadow-[0_0_0_6px_rgba(16,185,129,0.18)] animate-pulse z-20" />
            <div className="absolute -top-3 -right-1 z-20">
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
