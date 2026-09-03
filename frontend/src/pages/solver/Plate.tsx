// src/pages/solver/Plate.tsx
//
// One seat's range: a seat-style header (position, button, bet, odds, stack),
// an optional caller slot under it, the 13x13 decision matrix, and the colour
// key whose bars walk the tree. Two layouts share the parts: the wide card the
// desktop multi-range view stacks in rows, and the compact card the mobile
// view fits two abreast, with the matrix beside a narrow sidebar.
import React, {
  CSSProperties,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { combineDataByHand, HandCellData, JsonData } from "@/lib/solver/utils";
import type { MatrixHeightMode } from "@/lib/solver/matrixHeight";
import ColorKey from "./ColorKey";
import DecisionMatrix from "./DecisionMatrix";
import PlateHeader from "./PlateHeader";
import { motion } from "framer-motion";
import { HAND_ORDER } from "@/lib/solver/handOrder";
import { fmtMoney, type MoneyOpts } from "./boardDisplay";

/* ── helpers ── */
const EMPTY_GRID: HandCellData[] = HAND_ORDER.map((hand) => ({
  hand,
  actions: {} as Record<string, number>,
  evs: {} as Record<string, number>,
}));

const fmt = (n: number, decimals = 1) =>
  Math.abs(n % 1) > 1e-9 ? n.toFixed(decimals) : n.toFixed(0);

/* ── zoom only the DecisionMatrix inside each Plate ── */
const ZoomableGrid: React.FC<{ children: ReactNode; isActive: boolean }> = ({
  children,
  isActive,
}) => (
  <motion.div
    initial={false}
    animate={{ scale: isActive ? 1.0 : 1 }}
    transition={{ duration: 0.23 }}
    className="w-full h-full origin-center will-change-transform"
  >
    {children}
  </motion.div>
);

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
  /** Reach map for the zoom overlay's matrix, so heights carry over. */
  reachByHand: Map<string, number> | null;
};

interface PlateProps {
  plateId?: string;
  file: string;
  data: JsonData | undefined;
  onActionClick: (action: string, file: string) => void;
  randomFillEnabled?: boolean;
  alive: boolean;
  playerBet?: number;
  /** Chips this seat has already pushed into the pot (preflop money and
   *  matched postflop streets); comes off the stack like the live bet does. */
  potCommitted?: number;
  isICMSim?: boolean;
  plateWidth?: number;
  dmWidthPx?: number;
  sidebarWidthPx?: number;
  isActive?: boolean;
  /** Amber header, the table's hero colour: a hand-sharing team's seat on
   *  /multiway. Never set by the sim views. */
  isHero?: boolean;
  /** Dealer badge on the header. Defaults to "this seat is the BTN", which
   *  is what the sim views mean; /multiway passes the artifact's button. */
  isButton?: boolean;
  pot?: number;
  maxBet?: number;
  onPlateZoom?: (payload: PlateZoomPayload) => void;
  compact?: boolean;
  heightMode?: MatrixHeightMode;
  reachByHand?: Map<string, number> | null;
  /** Chips/bb display; absent for sims, which always read as big blinds. */
  money?: MoneyOpts | null;
  /** Caller content between the seat header and the matrix - /multiway's
   *  partner-hand select for a team seat. Keep it referentially stable: the
   *  plate is memoized and a fresh node every render defeats that. */
  header?: ReactNode;
  /** Stands in for the matrix when the seat has no decision here (it folded
   *  to the big blind): no colour key, no zoom. Keep it stable too. */
  placeholder?: ReactNode;
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
  potCommitted = 0,
  isICMSim = false,
  plateWidth,
  dmWidthPx,
  sidebarWidthPx,
  isActive = false,
  isHero = false,
  isButton,
  pot,
  maxBet,
  onPlateZoom,
  compact = false,
  heightMode,
  reachByHand = null,
  money,
  header,
  placeholder,
}) => {
  /* Bet labels carry the solve's money; the colour ramp is calibrated in
   * big blinds, so tell it how much money makes one. */
  const sizeRef = money?.bbSize && money.bbSize > 0 ? money.bbSize : 1;
  const [displayData, setDisplayData] = useState<JsonData | undefined>(data);
  useEffect(() => {
    if (data) setDisplayData(data);
  }, [data]);

  const keyLoading = !displayData;

  const gridData: HandCellData[] = useMemo(() => {
    if (!displayData) return EMPTY_GRID;
    return combineDataByHand(displayData);
  }, [displayData]);

  const hasCallAction = useMemo(() => {
    return gridData.some((cell) => {
      const v = (cell.actions as Record<string, number | undefined>)["Call"];
      return typeof v === "number" ? v > 0 : "Call" in cell.actions;
    });
  }, [gridData]);

  const potOdds =
    pot != null && maxBet != null && maxBet > playerBet
      ? ((maxBet - playerBet) / (pot + maxBet - playerBet)) * 100
      : 0;

  const outerCls =
    `relative ${compact ? "mb-0" : "mb-2"} justify-self-center ` +
    `${compact ? "max-w-none" : "max-w-[400px]"} w-full text-base`;

  const sizeStyle: CSSProperties | undefined =
    !compact && plateWidth != null
      ? {
          width: plateWidth,
          maxWidth: plateWidth,
        }
      : undefined;

  const dmWidth = compact && dmWidthPx ? dmWidthPx : undefined;
  const sidebarWidth = compact && sidebarWidthPx ? sidebarWidthPx : undefined;

  const stackBB = (displayData?.bb ?? 0) - potCommitted - playerBet;
  const betBB = playerBet;

  const position = displayData?.Position ?? "";
  const showButton = isButton ?? position === "BTN";
  const seatHeader = (
    <PlateHeader
      compact={compact}
      position={position}
      stackText={displayData ? fmtMoney(stackBB, money) : ""}
      betText={betBB !== 0 ? fmtMoney(betBB, money) : undefined}
      potOddsText={isActive && hasCallAction ? `${fmt(Math.max(0, potOdds), 1)}% odds` : undefined}
      isActive={isActive}
      isHero={isHero}
      isButton={showButton}
    />
  );

  const zoom = () => {
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
      file,
      reachByHand,
    });
  };

  /* The square: the matrix, or the caller's stand-in for a seat with no
     decision. Only the matrix zooms. */
  const square = placeholder ? (
    <div className="flex aspect-square w-full items-center justify-center rounded-md bg-black/25">
      {placeholder}
    </div>
  ) : (
    <div className="cursor-pointer" onClick={zoom}>
      <div className="relative w-full" style={{ aspectRatio: "1 / 1" }}>
        <ZoomableGrid isActive={isActive}>
          <DecisionMatrix
            money={money}
            gridData={gridData}
            randomFillEnabled={randomFillEnabled && !!displayData}
            isICMSim={isICMSim}
            heightMode={heightMode}
            reachByHand={reachByHand}
          />
        </ZoomableGrid>
      </div>
    </div>
  );

  const colorKey = !placeholder && (
    <ColorKey
      sizeRef={sizeRef}
      data={gridData}
      loading={keyLoading}
      onActionClick={(action) => onActionClick(action, file)}
    />
  );

  return (
    <div className={outerCls} style={sizeStyle}>
      <style>{`
        .ck-vertical {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
        }
        /* The header keeps its content height; the colour key takes what is
           left and hugs the bottom. A 50/50 split let a four-bar key overflow
           its half upward, over the header's lower lines. */
        .ck-vertical .ck-top {
          flex: 0 0 auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ck-vertical .ck-bottom {
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          overflow: visible;
        }
        /* The key's bars stack, fill the column from the bottom, and SHRINK
           evenly when the sidebar is shorter than four full bars - they used
           to keep their height and climb over the header instead. */
        .ck-vertical .ck-bottom .flex {
          flex-direction: column !important;
          flex-wrap: nowrap !important;
          justify-content: flex-end;
          height: 100%;
        }
        .ck-vertical .ck-bottom .flex > div {
          flex: 0 1 auto !important;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .ck-vertical .ck-bottom .flex > div > div {
          flex: 1 1 auto;
          height: auto !important;
          max-height: 23px;
          min-height: 0;
        }
        .ck-vertical .ck-bottom button {
          width: 100% !important;
        }
      `}</style>

      <motion.div
        className="relative overflow-visible will-change-transform"
        initial={false}
        animate={{ opacity: alive ? 1 : 0.1 }}
        transition={{ duration: 0.25 }}
      >
        <div
          className={`relative z-10 rounded-xl border shadow-lg ${
            isActive
              ? "border-emerald-400/80 bg-slate-950/70"
              : "border-slate-700/70 bg-slate-950/60"
          }`}
        >
          {compact ? (
            /* COMPACT LAYOUT: matrix left, seat header + colour key right.
               No padding: the mobile view budgets dmWidthPx + gap +
               sidebarWidthPx to the plate's full width. */
            <div className="flex items-stretch gap-1">
              <div className="relative" style={{ width: dmWidth }}>
                <div className="relative w-full" style={{ aspectRatio: "1 / 1" }}>
                  <div className="absolute inset-0">{square}</div>
                </div>
              </div>

              <div
                className="shrink-0 pt-1"
                style={{
                  width: sidebarWidth,
                  height: dmWidth,
                  minHeight: 0,
                }}
              >
                <div className="ck-vertical">
                  <div className="ck-top">
                    {seatHeader}
                    {header}
                  </div>
                  <div className="ck-bottom">{colorKey}</div>
                </div>
              </div>
            </div>
          ) : (
            /* WIDE LAYOUT: header, slot, matrix, colour key. */
            <>
              {seatHeader}
              {header && <div className="px-1.5 pt-1">{header}</div>}
              <div className="p-1">
                {square}
                {colorKey && (
                  <div className="mt-1 flex w-full select-none items-center justify-end">
                    {colorKey}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {isActive && (
          <>
            <div className="pointer-events-none absolute -inset-1 rounded-[14px] ring-2 ring-emerald-400/80 shadow-[0_0_0_6px_rgba(16,185,129,0.18)] animate-pulse z-20" />
            {/* Centred over the header's empty middle: the corners now hold
                the position and the stack. */}
            <div className="absolute -top-3 left-1/2 z-20 -translate-x-1/2">
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

/* Memoized: the multi-range views re-render on every zoom open/close (their `zoom` state),
 * but a plate's own inputs rarely change on that tap. Without this, each of the
 * on-screen plates re-rendered its full 13×13 DecisionMatrix on every zoom
 * toggle. All callback props reaching Plate are stable (`handleActionClick` is
 * useCallback'd; `setZoom` is a state setter passed directly), so the default
 * shallow comparison is safe. */
export default React.memo(Plate);
