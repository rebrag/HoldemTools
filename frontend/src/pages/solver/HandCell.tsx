// src/components/HandCell.tsx
import React, { useEffect, useState, useMemo } from "react";
import { HandCellData, getColorForAction, UNKNOWN_MULTI_COLOR } from "../utils/utils";
import { ALL_ACTIONS, Action as BucketAction } from "../utils/constants";
import "./App.css";

interface HandCellProps {
  data: HandCellData & { evs: Record<string, number> };
  randomFill?: boolean;
  matrixWidth?: number;
  onHover?: (evs: Record<string, number>) => void;
  onLeave?: () => void;
}

// Map raw action keys from the JSON (e.g. "c", "check", "ALLIN", etc.)
// into your 5 display buckets: ALLIN, UNKNOWN, Min, Call, Fold.
const mapRawToBucket = (raw: string): BucketAction => {
  switch (raw) {
    case "ALLIN":
      return "ALLIN";
    case "Min":
      return "Min";
    case "Fold":
      return "Fold";
    case "Call":
    case "c":
    case "check":
      return "Call";
    default:
      return "UNKNOWN";
  }
};

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

  /* ───────── segments for bar colouring ───────── */
  const segments = useMemo(() => {
    // Bucket weights in your canonical order
    const bucketWeights: Record<BucketAction, number> = {
      ALLIN: 0,
      UNKNOWN: 0,
      Min: 0,
      Call: 0,
      Fold: 0,
    };

    let unknownActionsCount = 0;

    // Aggregate raw actions into buckets
    Object.entries(data.actions).forEach(([rawAction, weight]) => {
      const w = weight || 0;
      const bucket = mapRawToBucket(rawAction);
      bucketWeights[bucket] += w;
      if (bucket === "UNKNOWN") {
        unknownActionsCount += 1;
      }
    });

    // For randomFill: map the chosen raw action into its bucket
    const randomBucket: BucketAction | null =
      isRandomFill && randomizedAction
        ? mapRawToBucket(randomizedAction)
        : null;

    // Build segments in the exact order from ALL_ACTIONS:
    // ["ALLIN", "UNKNOWN", "Min", "Call", "Fold"]
    return ALL_ACTIONS.map((bucket) => {
      const weight = bucketWeights[bucket] || 0;

      const targetWidth =
        randomBucket !== null
          ? bucket === randomBucket
            ? 100
            : 0
          : weight * 100;

      // Base color from utils…
      let color = getColorForAction(bucket);

      // …but if there are multiple unknown raw actions, use the multi-unknown color.
      if (bucket === "UNKNOWN" && unknownActionsCount > 1) {
        color = UNKNOWN_MULTI_COLOR;
      }

      return {
        action: bucket,
        style: {
          width: `${targetWidth}%`,
          backgroundColor: color,
        },
      };
    });
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
