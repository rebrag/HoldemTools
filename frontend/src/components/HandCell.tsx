import React, { useEffect, useState, useMemo } from "react";
import { HandCellData } from "../utils/utils";
import { ALL_ACTIONS, ALL_COLORS } from "../utils/constants";

// Optionally, if you defined a type for actions in your constants:
export type Action = "ALLIN" | "UNKNOWN" | "Min" | "Call" | "Fold";

interface HandCellProps {
  data: HandCellData;
  randomFill?: boolean;
  matrixWidth?: number;
}

const HandCell: React.FC<HandCellProps> = ({ data, randomFill, matrixWidth }) => {
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  // Random fill: choose an action based on weights.
  useEffect(() => {
    if (!randomFill) {
      setSelectedAction(null);
      return;
    }
    const entries = Object.entries(data.actions);
    const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
    if (totalWeight === 0) {
      setSelectedAction(null);
      return;
    }
    const rand = Math.random() * totalWeight;
    let cumulative = 0;
    for (const [action, weight] of entries) {
      cumulative += weight;
      if (rand <= cumulative) {
        setSelectedAction(action);
        return;
      }
    }
    setSelectedAction(entries[0][0]);
  }, [randomFill, data.actions]);

  const segments = useMemo(() => {
    // Sum up unknown weight: actions not in ALL_ACTIONS.
    let unknownWeight = 0;
    Object.keys(data.actions).forEach((key) => {
      if (!ALL_ACTIONS.includes(key as Action)) {
        unknownWeight += data.actions[key] || 0;
      }
    });
    // Map over the fixed ALL_ACTIONS order.
    return ALL_ACTIONS.map((action: Action) => {
      // For "UNKNOWN", use aggregated unknown weight; for known actions, use their value.
      const weight = action === "UNKNOWN" ? unknownWeight : (data.actions[action as string] || 0);
      const targetWidth =
        randomFill && selectedAction
          ? (selectedAction === action ||
             (!ALL_ACTIONS.includes(selectedAction as Action) && action === "UNKNOWN")
              ? 100
              : 0)
          : weight * 100;
      const color = ALL_COLORS[ALL_ACTIONS.indexOf(action)];
      return {
        action,
        style: {
          width: `${targetWidth}%`,
          transition: "width 600ms ease-out",
          backgroundColor: color,
        },
      };
    });
  }, [data.actions, randomFill, selectedAction]);

  const computedFontSize = matrixWidth
    ? `${2 + matrixWidth * 0.02}px`
    : "calc(4px + .28vw)";

  return (
    <div
      tabIndex={-1}
      className="w-full h-full bg-slate-50 aspect-square relative select-none"
    >
      <div className="flex h-full w-full">
        {segments.map(({ action, style }) => (
          <div key={action} style={style} />
        ))}
      </div>
      <div
        className="absolute inset-0 pointer-events-none select-none"
        style={{
          boxShadow: "inset 0 0 0 1px rgba(203, 213, 224, 0.1)",
        }}
      />
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

function areEqual(prev: HandCellProps, next: HandCellProps) {
  return (
    prev.data.hand === next.data.hand &&
    prev.randomFill === next.randomFill &&
    prev.matrixWidth === next.matrixWidth &&
    JSON.stringify(prev.data.actions) === JSON.stringify(next.data.actions)
  );
}

export default React.memo(HandCell, areEqual);
