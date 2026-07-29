// src/components/HandCell.tsx
import React, { useEffect, useState, useMemo } from "react";
import {
  HandCellData,
  actionCategory,
  getColorForAction,
  orderActionKeys,
} from "@/lib/solver/utils";
import "./App.css";

/* Stable segment slots, always mounted (width 0% when unused) and keyed by
 * slot name. Keeping the SAME divs across node changes is what lets the
 * `.segment { transition: width 500ms }` CSS animate range morphs — and since
 * every slot transitions with identical timing, the widths sum to 100%
 * throughout, so the cell background never flashes through. Order mirrors
 * orderActionKeys: all-in, bets (largest first), Min, check/call, fold. */
const SEGMENT_SLOTS = [
  "allin",
  "bet0",
  "bet1",
  "bet2",
  "bet3",
  "bet4",
  "bet5",
  "min",
  "passive",
  "fold",
  "other0",
  "other1",
] as const;
type SlotName = (typeof SEGMENT_SLOTS)[number];

interface HandCellProps {
  data: HandCellData & { evs: Record<string, number> };
  randomFill?: boolean;
  matrixWidth?: number;
  /** Height of the colored bar, 0..100, bottom-anchored. 100 = old look. */
  heightPct?: number;
  onHover?: (evs: Record<string, number>) => void;
  onLeave?: () => void;
  /** Units of the bet labels per big blind; see getColorForAction. */
  sizeRef?: number;
}

const HandCell: React.FC<HandCellProps> = ({
  data,
  randomFill: isRandomFill,
  matrixWidth,
  heightPct = 100,
  sizeRef = 1,
  onHover,
  onLeave,
}) => {
  /* ───────── state: randomised action ───────── */
  const [randomizedAction, setRandomizedAction] = useState<string | null>(null);

  useEffect(() => {
    if (!isRandomFill) {
      setRandomizedAction(null);
      return;
    }

    const entries = Object.entries(data.actions);
    const totalWeight = entries.reduce((sum, [, w]) => sum + (w || 0), 0);

    if (totalWeight === 0) {
      setRandomizedAction(null);
      return;
    }

    const rand = Math.random() * totalWeight;
    let cumulative = 0;

    for (const [action, weight] of entries) {
      const w = weight || 0;
      cumulative += w;
      if (rand <= cumulative) {
        setRandomizedAction(action);
        return;
      }
    }

    // Fallback (shouldn’t usually happen)
    setRandomizedAction(entries[0][0]);
  }, [isRandomFill, data.actions]);

  /* ───────── segments for bar colouring ─────────
   * Actions are colored/ordered by the SAME shared helpers the ColorKey legend
   * uses (so cells and legend always match), then assigned to the fixed
   * always-mounted slots above (so CSS width transitions stay seamless). */
  const segments = useMemo(() => {
    const ordered = orderActionKeys(Object.keys(data.actions));

    // Assign each present action to its stable slot.
    const bySlot: Partial<Record<SlotName, { width: number; color: string }>> = {};
    let betIdx = 0;
    let otherIdx = 0;
    for (const action of ordered) {
      const cat = actionCategory(action);
      let slot: SlotName;
      if (cat === "bet") slot = `bet${Math.min(betIdx++, 5)}` as SlotName;
      else if (cat === "other") slot = `other${Math.min(otherIdx++, 1)}` as SlotName;
      else slot = cat;

      const width =
        isRandomFill && randomizedAction
          ? action === randomizedAction
            ? 100
            : 0
          : (data.actions[action] || 0) * 100;

      const prev = bySlot[slot]; // overflow bets/others merge into the last slot
      bySlot[slot] = {
        width: (prev?.width ?? 0) + width,
        color: prev?.color ?? getColorForAction(action, sizeRef),
      };
    }

    return SEGMENT_SLOTS.map((slot) => ({
      action: slot,
      style: {
        width: `${bySlot[slot]?.width ?? 0}%`,
        backgroundColor: bySlot[slot]?.color ?? "transparent",
      },
    }));
  }, [data.actions, isRandomFill, randomizedAction]);

  /* ───────── pocket-pair border style ───────── */
  const isPair = data.hand.length === 2 && data.hand[0] === data.hand[1];
  const borderStyle = isPair
    ? "inset 0 0 0 0.7px rgba(203, 213, 224, 0.3)" // darker + thicker
    : "inset 0 0 0 0.3px rgba(203, 213, 224, 0.6)";

  /* ───────── label font size ───────── */
  const computedFontSize = matrixWidth
    ? `${2 + matrixWidth * 0.02}px`
    : "calc(4px + .28vw)";

  /* ───────── render ───────── */
  return (
    <div
      tabIndex={-1}
      data-testid="hand-cell"
      data-hand={data.hand}
      data-height={Math.round(heightPct)}
      className="relative group w-full h-full bg-slate-50 aspect-square select-none overflow-hidden"
      onMouseEnter={() => onHover?.(data.evs)}
      onMouseLeave={() => onLeave?.()}
    >
      {/* coloured action segments, bottom-anchored and scaled to the hand's
          reach at this node (100% outside postflop) - the cell background
          shows through above the bar, like GTO Wizard / PioSolver */}
      <div
        className="segment-bar absolute inset-x-0 bottom-0"
        style={{ height: `${heightPct}%` }}
      >
        <div className="flex h-full w-full">
          {segments.map(({ action, style }) => (
            <div key={action} className="segment" style={style} />
          ))}
        </div>
      </div>

      {/* inset border */}
      <div
        className="absolute inset-0 pointer-events-none select-none"
        style={{ boxShadow: borderStyle }}
      />

      {/* hand label */}
      <div
        className="absolute inset-0 flex items-center justify-center text-white font-semibold"
        style={{
          fontSize: computedFontSize,
          textShadow: "2px 2px 3px rgba(0, 0, 0, 0.7)",
        }}
      >
        {data.hand}
      </div>
    </div>
  );
};

/* ───────── memo: shallow compare relevant props ─────────
 * The cell `data` objects come from `combineDataByHand`, which is memoized
 * upstream (Plate / useActiveRange `useMemo`), so `actions`/`evs` keep stable
 * references across re-renders that don't actually change the data. Comparing
 * by reference avoids serializing every cell (2× JSON.stringify × 169 cells ×
 * every plate) on unrelated parent re-renders such as opening the zoom overlay. */
function areEqual(prev: HandCellProps, next: HandCellProps) {
  return (
    prev.data.hand === next.data.hand &&
    prev.randomFill === next.randomFill &&
    prev.matrixWidth === next.matrixWidth &&
    prev.heightPct === next.heightPct &&
    prev.sizeRef === next.sizeRef &&
    prev.data.actions === next.data.actions &&
    prev.data.evs === next.data.evs
  );
}

export default React.memo(HandCell, areEqual);
