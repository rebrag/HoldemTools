import React, { useEffect, useState, useMemo } from "react";
import { HandCellData, getColorForAction } from "../utils/utils";

interface HandCellProps {
  data: HandCellData;
  randomFill?: boolean;
  matrixWidth?: number; // DecisionMatrix width (in pixels)
}

const getRoundedCornerClass = (hand: string): string => {
  switch (hand) {
    case "AA":
      return "rounded-tl-sm";
    case "A2s":
      return "rounded-tr-sm";
    case "A2o":
      return "rounded-bl-sm";
    case "22":
      return "rounded-br-sm";
    default:
      return "";
  }
};

const HandCell: React.FC<HandCellProps> = ({ data, randomFill, matrixWidth }) => {
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  // Convert actions to an array without reversing the order.
  const actionsArray = useMemo(() => Object.entries(data.actions), [data.actions]);

  useEffect(() => {
    if (randomFill) {
      const actionsEntries = Object.entries(data.actions);
      const totalWeight = actionsEntries.reduce((sum, [, weight]) => sum + weight, 0);
      const rand = Math.random() * totalWeight;
      let cumulative = 0;
      let chosen: string | null = null;
  
      for (const [action, weight] of actionsEntries) {
        cumulative += weight;
        if (rand <= cumulative) {
          chosen = action;
          break;
        }
      }
  
      if (!chosen && actionsEntries.length > 0) {
        chosen = actionsEntries[0][0];
      }
      setSelectedAction(chosen);
    } else {
      setSelectedAction(null);
    }
  }, [randomFill, data.actions]);
  
  // Compute the style for each action segment.
  // In randomFill mode, the selected action's segment gets 100% width and the others 0%.
  const segments = useMemo(
    () =>
      [...actionsArray].reverse().map(([action, weight]) => {
        const targetWidth =
          randomFill && selectedAction !== null
            ? action === selectedAction
              ? 100
              : 0
            : (weight as number) * 100;
        return {
          action,
          style: {
            width: `${targetWidth}%`,
            transition: "width 500ms ease-out",
            backgroundColor: getColorForAction(action),
          },
        };
      }),
    [actionsArray, randomFill, selectedAction]
  );

  // Instead of using viewport width (vw), calculate font size based on matrixWidth.
  // For example, using a base of 4px plus 2% of the matrixWidth.
  const computedFontSize = matrixWidth ? `${2 + matrixWidth * 0.02}px` : "calc(4px + .28vw)";

  return (
    <div
      tabIndex={-1}
      className={`w-full h-full aspect-square relative select-none overflow-x-hidden ${getRoundedCornerClass(
        data.hand
      )}`}
    >
      <div className="flex h-full w-full">
        {segments.map(({ action, style }) => (
          <div key={action} style={style} />
        ))}
      </div>

      {/* Shadow overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          boxShadow: "inset 0 0 0 0.2px rgba(203, 213, 224, 0.5)",
        }}
      />

      {/* Hand label using matrixWidth for font scaling */}
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

export default React.memo(HandCell);
