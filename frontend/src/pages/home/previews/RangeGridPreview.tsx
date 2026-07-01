import { JSX, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  buildSolutionRanges,
  ACTION_COLORS,
  ACTION_LABELS,
  SEGMENT_ORDER,
  type CellMix,
} from "./solutionRanges";

const SWAP_MS = 4000;

/**
 * Live 13x13 preflop range grid — the interactive internals of the Solutions
 * tool. It alternates between two real solution states every 4s; each cell's
 * action segments morph with the same 500ms width transition as the live grid
 * (src/pages/solver/App.css). Hovering a cell surfaces its exact mix.
 */
export function RangeGridPreview({ className }: { className?: string }): JSX.Element {
  const ranges = useMemo(() => buildSolutionRanges(), []);
  const reduce = useReducedMotion();
  const [activeIdx, setActiveIdx] = useState(0);
  const [hoverHand, setHoverHand] = useState<string | null>(null);

  useEffect(() => {
    if (reduce) return;
    const t = window.setInterval(
      () => setActiveIdx((i) => (i + 1) % ranges.length),
      SWAP_MS,
    );
    return () => window.clearInterval(t);
  }, [reduce, ranges.length]);

  const state = ranges[activeIdx];
  const hoverCell = hoverHand
    ? state.cells.find((c) => c.hand === hoverHand) ?? null
    : null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-widest text-emerald-300/90">
            {state.caption}
          </span>
          <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-slate-400 ring-1 ring-white/10">
            {state.stack}
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-400">
          {hoverCell ? hoverCell.hand : "169 combos"}
        </span>
      </div>

      <motion.div
        className="grid aspect-square w-full grid-cols-[repeat(13,minmax(0,1fr))] gap-px rounded-xl bg-slate-900/60 p-1 ring-1 ring-white/10"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-40px" }}
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: reduce ? 0 : 0.004 } },
        }}
      >
        {state.cells.map((cell) => (
          <RangeCell
            key={cell.hand}
            cell={cell}
            reduce={!!reduce}
            onHover={setHoverHand}
          />
        ))}
      </motion.div>

      {/* Legend + live mix readout (reflects the active solution) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {state.legend.map((action) => (
          <div key={action} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ backgroundColor: ACTION_COLORS[action] }}
            />
            <span className="text-[11px] text-slate-300">{ACTION_LABELS[action]}</span>
            {hoverCell && (
              <span className="font-mono text-[11px] text-slate-500">
                {Math.round((hoverCell.mix[action] ?? 0) * 100)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RangeCell({
  cell,
  reduce,
  onHover,
}: {
  cell: CellMix;
  reduce: boolean;
  onHover: (hand: string | null) => void;
}): JSX.Element {
  return (
    <motion.button
      type="button"
      tabIndex={-1}
      onMouseEnter={() => onHover(cell.hand)}
      onMouseLeave={() => onHover(null)}
      variants={{
        hidden: { opacity: 0, scale: reduce ? 1 : 0.4 },
        show: { opacity: 1, scale: 1, transition: { duration: 0.25 } },
      }}
      className="group/cell relative aspect-square overflow-hidden rounded-[2px] transition-transform duration-150 hover:z-10 hover:scale-[1.35] hover:ring-1 hover:ring-white/70"
      style={{
        boxShadow: cell.isPair
          ? "inset 0 0 0 0.5px rgba(203,213,224,0.35)"
          : "inset 0 0 0 0.5px rgba(203,213,224,0.12)",
      }}
    >
      <div className="flex h-full w-full">
        {SEGMENT_ORDER.map((action) => (
          <div
            key={action}
            style={{
              width: `${(cell.mix[action] ?? 0) * 100}%`,
              backgroundColor: ACTION_COLORS[action],
              transition: reduce ? undefined : "width 500ms ease-in-out",
            }}
          />
        ))}
      </div>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[6px] font-bold text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.8)] sm:text-[7px]">
        {cell.hand}
      </span>
    </motion.button>
  );
}
