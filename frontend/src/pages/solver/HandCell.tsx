// src/components/HandCell.tsx
import React, { useEffect, useState, useMemo } from "react";
import { HandCellData, getColorForAction, orderActionKeys } from "@/lib/solver/utils";
import "./App.css";

interface HandCellProps {
  data: HandCellData & { evs: Record<string, number> };
  randomFill?: boolean;
  matrixWidth?: number;
  onHover?: (evs: Record<string, number>) => void;
  onLeave?: () => void;
}

const HandCell: React.FC<HandCellProps> = ({
  data,
  randomFill: isRandomFill,
  matrixWidth,
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
   * One segment per actual action, ordered and colored by the SAME shared
   * helpers the ColorKey legend uses, so cells and legend always match. */
  const segments = useMemo(() => {
    const ordered = orderActionKeys(Object.keys(data.actions));

    // randomFill: show only the sampled action, full width.
    if (isRandomFill && randomizedAction) {
      return ordered.map((action) => ({
        action,
        style: {
          width: action === randomizedAction ? "100%" : "0%",
          backgroundColor: getColorForAction(action),
        },
      }));
    }

    return ordered.map((action) => ({
      action,
      style: {
        width: `${(data.actions[action] || 0) * 100}%`,
        backgroundColor: getColorForAction(action),
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
      className="relative group w-full h-full bg-slate-50 aspect-square select-none"
      onMouseEnter={() => onHover?.(data.evs)}
      onMouseLeave={() => onLeave?.()}
    >
      {/* coloured action segments */}
      <div className="flex h-full w-full">
        {segments.map(({ action, style }) => (
          <div key={action} className="segment" style={style} />
        ))}
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
 * upstream (Plate/PlateGrid `useMemo`), so `actions`/`evs` keep stable
 * references across re-renders that don't actually change the data. Comparing
 * by reference avoids serializing every cell (2× JSON.stringify × 169 cells ×
 * every plate) on unrelated parent re-renders such as opening the zoom overlay. */
function areEqual(prev: HandCellProps, next: HandCellProps) {
  return (
    prev.data.hand === next.data.hand &&
    prev.randomFill === next.randomFill &&
    prev.matrixWidth === next.matrixWidth &&
    prev.data.actions === next.data.actions &&
    prev.data.evs === next.data.evs
  );
}

export default React.memo(HandCell, areEqual);
