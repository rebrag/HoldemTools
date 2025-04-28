import React, { useEffect, useState, useMemo } from "react";
import { HandCellData } from "../utils/utils";
import { ALL_ACTIONS, ALL_COLORS } from "../utils/constants";
import "./App.css";

export type Action = "ALLIN" | "UNKNOWN" | "Min" | "Call" | "Fold";

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
    const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
    if (totalWeight === 0) {
      setRandomizedAction(null);
      return;
    }
    const rand = Math.random() * totalWeight;
    let cumulative = 0;
    for (const [action, weight] of entries) {
      cumulative += weight;
      if (rand <= cumulative) {
        setRandomizedAction(action);
        return;
      }
    }
    setRandomizedAction(entries[0][0]);
  }, [isRandomFill, data.actions]);

  /* ───────── segments for bar colouring ───────── */
  const segments = useMemo(() => {
    let unknownWeight = 0;
    Object.keys(data.actions).forEach((key) => {
      if (!ALL_ACTIONS.includes(key as Action))
        unknownWeight += data.actions[key] || 0;
    });
    return ALL_ACTIONS.map((action) => {
      const weight =
        action === "UNKNOWN"
          ? unknownWeight
          : data.actions[action] || 0;
      const targetWidth =
        isRandomFill && randomizedAction
          ? randomizedAction === action ||
            (!ALL_ACTIONS.includes(randomizedAction as Action) &&
              action === "UNKNOWN")
            ? 100
            : 0
          : weight * 100;
      const color = ALL_COLORS[ALL_ACTIONS.indexOf(action)];
      return { action, style: { width: `${targetWidth}%`, backgroundColor: color } };
    });
  }, [data.actions, isRandomFill, randomizedAction]);

  /* ───────── pocket-pair border style ───────── */
  const isPair = data.hand.length === 2 && data.hand[0] === data.hand[1];
  const borderStyle = isPair
    ? "inset 0 0 0 0.7px rgba(203, 213, 224, 0.5)" // darker + thicker
    : "inset 0 0 0 0.3px rgba(203, 213, 224, 0.8)";

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
          textShadow: "2px 2px 3px rgba(0, 0, 0, .7)",
        }}
      >
        {data.hand}
      </div>
    </div>
  );
};

/* ───────── memo: shallow compare relevant props ───────── */
function areEqual(prev: HandCellProps, next: HandCellProps) {
  return (
    prev.data.hand === next.data.hand &&
    prev.randomFill === next.randomFill &&
    prev.matrixWidth === next.matrixWidth &&
    JSON.stringify(prev.data.actions) === JSON.stringify(next.data.actions) &&
    JSON.stringify(prev.data.evs) === JSON.stringify(next.data.evs)
  );
}

export default React.memo(HandCell, areEqual);
