// src/components/Line.tsx
import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { getColorForAction, stringToColor } from "@/lib/solver/utils";
import type { JsonData } from "@/lib/solver/utils";

export interface LineProps {
  /** Chronological line of actions (index 0 is "Root"); used for the Reset control. */
  line: string[];
  onLineClick: (idx: number) => void;

  /** Seats in pre-flop acting order (UTG … BTN, SB, BB). */
  positions: string[];
  activePlayer: string;
  plateData: Record<string, JsonData>;
  plateMapping: Record<string, string>;
  playerBets: Record<string, number>;
  alivePlayers: Record<string, boolean>;
  /** Same handler the plates use — clicking a seat's option navigates the tree. */
  onActionClick: (action: string, file: string) => void;
  /** Constrain the bar's total width to match the plate grid below (px). */
  matchWidth?: number;
}

const fmt = (n: number, decimals = 1) =>
  Math.abs(n % 1) > 1e-9 ? n.toFixed(decimals) : n.toFixed(0);

/* Order options top→bottom like the reference: Fold, Call, (Min), Raise…, Allin. */
const seatRank = (act: string) =>
  act === "Fold"
    ? 0
    : act === "Call"
    ? 1
    : act === "Min"
    ? 2
    : act.startsWith("Raise ")
    ? 3
    : act === "ALLIN"
    ? 5
    : 4;

/** The betting options available at a seat's node, derived from its plate JSON. */
const seatActions = (data?: JsonData): string[] => {
  if (!data) return [];
  const acts = Object.keys(data)
    .filter((k) => k !== "Position" && k !== "bb")
    .map((k) => (k === "c" ? "Call" : k));
  return Array.from(new Set(acts)).sort((a, b) => seatRank(a) - seatRank(b));
};

const Line: React.FC<LineProps> = ({
  line,
  onLineClick,
  positions,
  activePlayer,
  plateData,
  plateMapping,
  playerBets,
  alivePlayers,
  onActionClick,
  matchWidth,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  /* ───── helper to update arrow visibility ───── */
  const refresh = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 0);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  /* run refresh on scroll / resize */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    refresh();
    el.addEventListener("scroll", refresh);
    window.addEventListener("resize", refresh);
    return () => {
      el.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, []);

  /* run refresh whenever the seats / mapping change */
  useEffect(() => {
    requestAnimationFrame(refresh);
  }, [positions, plateMapping, activePlayer]);

  /* smooth-scroll helper */
  const move = (delta: number) => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  /* ───── render ───── */
  return (
    <div
      className="relative w-full select-none mx-auto"
      style={{ maxWidth: matchWidth || undefined }}
    >
      {/* ← chevron */}
      {canLeft && (
        <button
          onClick={() => move(-220)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-full bg-black/40 text-white"
        >
          <ChevronLeft size={18} strokeWidth={2.4} />
        </button>
      )}

      {/* → chevron */}
      {canRight && (
        <button
          onClick={() => move(220)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-full bg-black/40 text-white"
        >
          <ChevronRight size={18} strokeWidth={2.4} />
        </button>
      )}

      {/* seat strip */}
      <div
        ref={scrollerRef}
        className="overflow-x-auto scroll-smooth no-scrollbar w-full"
      >
        <div className="flex flex-nowrap items-stretch gap-1 w-full">
        {/* Reset (back to root) */}
        {line.length > 1 && (
          <button
            onClick={() => onLineClick(0)}
            className="flex-shrink-0 flex flex-col items-center justify-center px-1.5 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 text-gray-300 transition-colors"
            title="Reset to start of hand"
          >
            <RotateCcw size={14} />
            <span className="text-[0.5rem] mt-0.5 leading-none">Reset</span>
          </button>
        )}

        {/* seat cards */}
        {positions.map((pos, idx) => {
          const file = plateMapping[pos];
          const data = file ? plateData[file] : undefined;
          const isActive = pos === activePlayer;
          const alive = alivePlayers[pos] ?? true;
          const bet = playerBets[pos] ?? 0;
          const stack = data ? (data.bb ?? 0) - bet : null;
          const options = seatActions(data);

          /* Clicking a card's empty area folds the seat that acts just
             before it — but only when that previous seat is the one to
             act, so the "fold to advance" transition is always valid. */
          const prevPos = idx > 0 ? positions[idx - 1] : undefined;
          const prevFile = prevPos ? plateMapping[prevPos] : undefined;
          const canFoldPrev =
            !!prevPos &&
            prevPos === activePlayer &&
            !!prevFile &&
            seatActions(plateData[prevFile]).includes("Fold");

          return (
            <div
              key={pos}
              onClick={
                canFoldPrev ? () => onActionClick("Fold", prevFile!) : undefined
              }
              className={`flex-1 flex flex-col rounded-md border px-1.5 py-1 min-w-[3.6rem] transition-colors ${
                canFoldPrev ? "cursor-pointer" : ""
              } ${
                isActive
                  ? "border-emerald-400 bg-emerald-400/10 shadow-[0_0_0_2px_rgba(16,185,129,0.35)]"
                  : alive
                  ? "border-white/15 bg-white/5"
                  : "border-white/10 bg-white/5 opacity-40"
              }`}
            >
              <div className="flex items-baseline justify-between gap-1 mb-0.5">
                <span
                  className={`text-[0.7rem] font-bold leading-none ${
                    isActive ? "text-emerald-300" : "text-gray-100"
                  }`}
                >
                  {pos}
                </span>
                {stack != null && (
                  <span className="text-[0.6rem] text-gray-300 tabular-nums leading-none">
                    {fmt(stack)}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-0.5">
                {options.length === 0 ? (
                  <span className="text-[0.55rem] text-gray-400 italic leading-tight">
                    {alive ? " " : "folded"}
                  </span>
                ) : (
                  options.map((action) => {
                    const color =
                      getColorForAction(action) || stringToColor(action);
                    return (
                      <button
                        key={action}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (file) onActionClick(action, file);
                        }}
                        disabled={!file}
                        className="group flex items-center gap-1 rounded-sm px-1 py-0.5 text-left hover:bg-white/10 disabled:hover:bg-transparent transition-colors"
                        title={`${pos}: ${action}`}
                      >
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-[2px] flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-[0.55rem] leading-tight text-gray-200 whitespace-nowrap">
                          {action}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
};

export default Line;

/* If you haven't already, make sure you have the scrollbar-hiding helpers
   somewhere in your global CSS (e.g., index.css):
   .no-scrollbar::-webkit-scrollbar { display: none; }
   .no-scrollbar { scrollbar-width: none; }
*/
