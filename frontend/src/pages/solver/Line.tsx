// src/components/Line.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  getColorForAction,
  passiveAction,
  plateActions,
  stringToColor,
} from "@/lib/solver/utils";
import type { JsonData } from "@/lib/solver/utils";

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
  matchWidth,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  /* Replaying the line over the acting order (folds drop the seat; other
   * actions pass to the next seat) gives two things per seat: its most recent
   * action, which highlights the taken option GTO Wizard style, and how many
   * actions came before its FIRST decision, which is what a click on the seat
   * rewinds to. Earliest rather than latest so a seat that acted twice unwinds
   * everything it did - and so the first card always reaches the root, which
   * is what stands in for a reset control. */
  const { takenBySeat, actionsBeforeSeat } = useMemo(() => {
    const taken: Record<string, string> = {};
    const before: Record<string, number> = {};
    const alive = [...positions];
    let idx = 0;
    line.slice(1).forEach((action, i) => {
      const seat = alive[idx];
      if (!seat) return;
      taken[seat] = action;
      if (before[seat] == null) before[seat] = i;
      if (action === "Fold") {
        alive.splice(idx, 1);
        if (idx >= alive.length) idx = 0;
      } else if (alive.length > 0) {
        idx = (idx + 1) % alive.length;
      }
    });
    return { takenBySeat: taken, actionsBeforeSeat: before };
  }, [line, positions]);

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

  /* Clicking a seat's empty area puts that seat back on the spot, in whichever
   * direction it lies: seats still to act are reached by getting the ones in
   * front of them out of the way (only possible while the seat to act can -
   * a node with nothing but bets to choose from cannot), and seats that have
   * already acted, folded ones included, by rewinding the line to just before
   * their decision. */
  const activeIdx = positions.indexOf(activePlayer);
  const activeFile = plateMapping[activePlayer];
  const activeCanPass = !!passiveAction(seatActions(plateData[activeFile]));

  const seatCardClick = (
    pos: string,
    idx: number,
    alive: boolean,
    isActive: boolean
  ): { onClick?: () => void; title?: string } => {
    if (isActive) return {};
    if (onSkipToSeat && alive && activeIdx >= 0 && idx > activeIdx && activeCanPass) {
      return { onClick: () => onSkipToSeat(pos), title: `Skip ahead to ${pos}` };
    }
    const before = actionsBeforeSeat[pos];
    if (onRewindTo && before != null) {
      return { onClick: () => onRewindTo(before), title: `Back to ${pos}'s decision` };
    }
    return {};
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
        {/* Seat cards. No separate reset control: the first seat's card is the
            root of the tree, so clicking it unwinds the whole line. */}
        {positions.map((pos, idx) => {
          const file = plateMapping[pos];
          const data = file ? plateData[file] : undefined;
          const isActive = pos === activePlayer;
          const alive = alivePlayers[pos] ?? true;
          const bet = playerBets[pos] ?? 0;
          const stack = data ? (data.bb ?? 0) - bet : null;
          const options = seatActions(data);
          const card = seatCardClick(pos, idx, alive, isActive);

          return (
            <div
              key={pos}
              data-testid="line-card"
              data-seat={pos}
              data-active={isActive ? "true" : undefined}
              onClick={card.onClick}
              title={card.title}
              className={`flex-1 flex flex-col rounded-md border px-1.5 py-1 min-w-[3.6rem] transition-colors ${
                card.onClick ? "cursor-pointer hover:bg-white/[0.07]" : ""
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
