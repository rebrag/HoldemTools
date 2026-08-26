// src/components/Line.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  buildActionPalette,
  plateActions,
  stringToColor,
} from "@/lib/solver/utils";
import type { JsonData } from "@/lib/solver/utils";
import { canPassAction, indexLineBySeat, resolveSeatNav } from "./seatNavigation";

export interface LineProps {
  /** Chronological line of actions (index 0 is "Root"), replayed to find each
   *  seat's decision - what a click on that seat's card goes back to. */
  line: string[];

  /** Seats in pre-flop acting order (UTG … BTN, SB, BB). */
  positions: string[];
  activePlayer: string;
  plateData: Record<string, JsonData>;
  plateMapping: Record<string, string>;
  playerBets: Record<string, number>;
  alivePlayers: Record<string, boolean>;
  /** Same handler the plates use — clicking a seat's option navigates the tree. */
  onActionClick: (action: string, file: string) => void;
  /**
   * Skip ahead to `pos`: every seat still to act in front of it gets out of
   * the way (fold, else check, else call) until `pos` is the one to act.
   * Bound to a click on the empty part of a seat's card.
   */
  onSkipToSeat?: (pos: string) => void;
  /**
   * Rewind: walk the tree again from the root, stopping after the line's
   * first `actionCount` actions. Bound to a click on a seat that has already
   * acted, so its own decision comes back up - folded seats included.
   */
  onRewindTo?: (actionCount: number) => void;
  /** Stretch the seat cards to fill the parent's height - used by the study
   *  header so the strip matches the SimSelect panel beside it. */
  fillHeight?: boolean;
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
const seatActions = (data?: JsonData): string[] =>
  plateActions(data).sort((a, b) => seatRank(a) - seatRank(b));

const Line: React.FC<LineProps> = ({
  line,
  positions,
  activePlayer,
  plateData,
  plateMapping,
  playerBets,
  alivePlayers,
  onActionClick,
  onSkipToSeat,
  onRewindTo,
  fillHeight,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  /* Per seat: its most recent action, which highlights the taken option GTO
   * Wizard style, and the rewind target a click on the seat goes to. Shared
   * with the single-range table's seats - see seatNavigation.ts. */
  const { takenBySeat, actionsBeforeSeat } = useMemo(
    () => indexLineBySeat(line, positions),
    [line, positions]
  );

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

  /* Clicking a seat's empty area puts that seat back on the spot - see
   * seatNavigation.ts for which direction that resolves in. */
  const activeFile = plateMapping[activePlayer];
  const activeCanPass = canPassAction(plateData[activeFile]);

  const seatCardClick = (pos: string, alive: boolean) =>
    resolveSeatNav({
      pos,
      positions,
      activePlayer,
      alive,
      activeCanPass,
      actionsBeforeSeat,
      onSkipToSeat,
      onRewindTo,
    });

  /* ───── render ───── */
  return (
    <div
      className={`relative w-full select-none mx-auto${fillHeight ? " h-full" : ""}`}
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
        className={`overflow-x-auto scroll-smooth no-scrollbar w-full${
          fillHeight ? " h-full" : ""
        }`}
      >
        <div
          className={`flex flex-nowrap items-stretch gap-1 w-full${
            fillHeight ? " h-full" : ""
          }`}
        >
        {/* Seat cards. No separate reset control: the first seat's card is the
            root of the tree, so clicking it unwinds the whole line. */}
        {positions.map((pos) => {
          const file = plateMapping[pos];
          const data = file ? plateData[file] : undefined;
          const isActive = pos === activePlayer;
          const alive = alivePlayers[pos] ?? true;
          const bet = playerBets[pos] ?? 0;
          const stack = data ? (data.bb ?? 0) - bet : null;
          const options = seatActions(data);
          /* One palette per seat card, from that seat's whole option list, so
             the dots match the matrix segments for the same node instead of
             each colour resolving in isolation. Preflop labels are already in
             big blinds or percent of pot, so no sizeRef is needed. */
          const palette = buildActionPalette(options);
          const card = seatCardClick(pos, alive);

          return (
            <div
              key={pos}
              data-testid="line-card"
              data-seat={pos}
              data-active={isActive ? "true" : undefined}
              onClick={card?.run}
              title={card?.title}
              className={`flex-1 flex flex-col rounded-md border px-1.5 py-1 min-w-[3.6rem] transition-colors ${
                card ? "cursor-pointer hover:bg-white/[0.07]" : ""
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
                    const color = palette[action] || stringToColor(action);
                    /* Highlight the seat's taken action once the action has
                     * moved past them (their card no longer being active). */
                    const taken = !isActive && takenBySeat[pos] === action;
                    return (
                      <button
                        key={action}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (file) onActionClick(action, file);
                        }}
                        disabled={!file}
                        className={`group flex items-center gap-1 rounded-sm px-1 py-0.5 text-left hover:bg-white/10 disabled:hover:bg-transparent transition-colors ${
                          taken ? "bg-white/15" : ""
                        }`}
                        title={`${pos}: ${action}`}
                      >
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-[2px] flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span
                          className={`text-[0.55rem] leading-tight whitespace-nowrap ${
                            taken ? "text-gray-100 font-semibold" : "text-gray-200"
                          }`}
                        >
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
