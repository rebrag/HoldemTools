// src/components/RangeEditorGrid.tsx
//
// Editable 13x13 preflop range grid. Weights are 0..1 per 169 hand class
// (keys from HAND_ORDER). Pick a brush weight, then tap or drag-paint cells;
// tapping a cell that already has the brush weight erases it, and dragging
// keeps painting with that same value so a swipe feels like one stroke.
import { useMemo, useRef, useState } from "react";
import { HAND_ORDER } from "@/lib/solver/handOrder";

const BRUSHES = [1, 0.75, 0.5, 0.25] as const;

/** 6 combos per pair, 4 per suited, 12 per offsuit. */
const combosOf = (hand: string): number =>
  hand.length === 2 ? 6 : hand.endsWith("s") ? 4 : 12;

const TOTAL_COMBOS = 1326;

export const weightedComboCount = (weights: Record<string, number>): number =>
  HAND_ORDER.reduce((sum, hand) => sum + (weights[hand] ?? 0) * combosOf(hand), 0);

const isPair = (hand: string) => hand.length === 2;

interface RangeEditorGridProps {
  weights: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  disabled?: boolean;
}

const RangeEditorGrid = ({ weights, onChange, disabled }: RangeEditorGridProps) => {
  const [brush, setBrush] = useState<number>(1);
  /** Weight applied by the stroke in progress (brush, or 0 when erasing). */
  const strokeValue = useRef<number | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const combos = useMemo(() => weightedComboCount(weights), [weights]);

  const paint = (hand: string, value: number) => {
    if ((weights[hand] ?? 0) === value) return;
    const next = { ...weights };
    if (value <= 0) delete next[hand];
    else next[hand] = value;
    onChange(next);
  };

  const beginStroke = (hand: string) => {
    if (disabled) return;
    const current = weights[hand] ?? 0;
    strokeValue.current = current === brush ? 0 : brush;
    paint(hand, strokeValue.current);
  };

  /** Drag-paint: find the cell under the pointer (works for touch, where
   *  enter events don't fire on the elements being swiped over). */
  const strokeMove = (clientX: number, clientY: number) => {
    if (disabled || strokeValue.current === null) return;
    const el = document.elementFromPoint(clientX, clientY);
    const hand = el instanceof Element ? el.closest("[data-hand]")?.getAttribute("data-hand") : null;
    if (hand) paint(hand, strokeValue.current);
  };

  const endStroke = () => {
    strokeValue.current = null;
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Brush palette */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {BRUSHES.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBrush(b)}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums border transition-colors
                ${
                  brush === b
                    ? "bg-emerald-600 border-emerald-400 text-white shadow"
                    : "bg-slate-800 border-white/10 text-gray-300 hover:bg-slate-700"
                }`}
              title={`Paint hands at ${b * 100}% weight`}
            >
              {b * 100}%
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              onChange(Object.fromEntries(HAND_ORDER.map((h) => [h, 1])))
            }
            className="rounded-md px-2 py-1 text-[11px] font-medium bg-slate-800 border border-white/10 text-gray-300 hover:bg-slate-700"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onChange({})}
            className="rounded-md px-2 py-1 text-[11px] font-medium bg-slate-800 border border-white/10 text-gray-300 hover:bg-slate-700"
          >
            Clear
          </button>
        </div>
      </div>

      {/* The grid */}
      <div
        ref={gridRef}
        className="grid aspect-square w-full grid-cols-[repeat(13,minmax(0,1fr))] gap-px rounded-xl bg-slate-900/70 p-1 ring-1 ring-white/10 select-none"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          // Capture on the grid so drag strokes keep flowing to us.
          gridRef.current?.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => strokeMove(e.clientX, e.clientY)}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={endStroke}
      >
        {HAND_ORDER.map((hand) => {
          const w = weights[hand] ?? 0;
          return (
            <button
              key={hand}
              type="button"
              tabIndex={-1}
              data-hand={hand}
              disabled={disabled}
              onPointerDown={() => beginStroke(hand)}
              className="relative aspect-square overflow-hidden rounded-[2px] bg-slate-800 transition-transform duration-150 hover:z-10 hover:scale-[1.3] hover:ring-1 hover:ring-white/70"
              style={{
                boxShadow: isPair(hand)
                  ? "inset 0 0 0 0.5px rgba(203,213,224,0.35)"
                  : "inset 0 0 0 0.5px rgba(203,213,224,0.12)",
              }}
            >
              <div
                className="absolute inset-y-0 left-0 bg-emerald-500"
                style={{
                  width: `${w * 100}%`,
                  opacity: 0.55 + 0.45 * w,
                  transition: "width 150ms ease-in-out",
                }}
              />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[6px] font-bold text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.8)] sm:text-[8px]">
                {hand}
              </span>
            </button>
          );
        })}
      </div>

      {/* Readout */}
      <div className="flex items-center justify-between text-[11px] text-gray-400 tabular-nums">
        <span>{combos.toFixed(0)} / {TOTAL_COMBOS} combos</span>
        <span>{((combos / TOTAL_COMBOS) * 100).toFixed(1)}% of hands</span>
      </div>
    </div>
  );
};

/** Small read-only thumbnail of a range, used as the "click to edit" button
 *  face in the tree-building panel. */
export const RangeMiniGrid = ({ weights }: { weights: Record<string, number> }) => (
  <div className="grid aspect-square w-full grid-cols-[repeat(13,minmax(0,1fr))] gap-[0.5px] rounded-md bg-slate-900/80 p-0.5 ring-1 ring-white/10">
    {HAND_ORDER.map((hand) => {
      const w = weights[hand] ?? 0;
      return (
        <div key={hand} className="relative aspect-square overflow-hidden rounded-[1px] bg-slate-800">
          <div
            className="absolute inset-y-0 left-0 bg-emerald-500"
            style={{ width: `${w * 100}%`, opacity: 0.55 + 0.45 * w }}
          />
        </div>
      );
    })}
  </div>
);

export default RangeEditorGrid;
