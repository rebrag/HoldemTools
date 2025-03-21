import React, { useEffect, useState, useMemo } from "react";
import { HandCellData, getColorForAction } from "../utils/utils";

interface HandCellProps {
  data: HandCellData;
  randomFill?: boolean;
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

const HandCell: React.FC<HandCellProps> = ({ data, randomFill }) => {
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  // Convert actions to an array without reversing the order.
  const actionsArray = useMemo(() => Object.entries(data.actions), [data.actions]);

  useEffect(() => {
    if (randomFill) {
      let cumulative = 0;
      const rand = Math.random(); // generate individual random number for this cell
      let chosen: string | null = null;
      for (const [action, weight] of Object.entries(data.actions)) {
        cumulative += weight;
        if (rand <= cumulative) {
          chosen = action;
          break;
        }
      }
      if (!chosen && actionsArray.length > 0) {
        chosen = actionsArray[0][0];
      }
      setSelectedAction(chosen);
    } else {
      setSelectedAction(null);
    }
  }, [randomFill, data.actions, actionsArray]);

  // Compute the style for each action segment.
  // In randomFill mode, the selected action's segment gets 100% width and the others 0%.
  const segments = useMemo(
    () =>
      actionsArray.map(([action, weight]) => {
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
            transition: "width 300ms ease-out",
            backgroundColor: getColorForAction(action),
          },
        };
      }),
    [actionsArray, randomFill, selectedAction]
  );

  return (
    <div
      tabIndex={-1}
      className={`w-full h-full aspect-square relative select-none overflow-hidden ${getRoundedCornerClass(
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

      {/* Hand label */}
      <div
        className="absolute inset-0 flex items-center justify-center text-white font-semibold"
        style={{
          fontSize: "calc(4px + .28vw)",
          textShadow: "2px 2px 3px rgba(0, 0, 0, .7)",
        }}
      >
        {data.hand}
      </div>
    </div>
  );
};

export default React.memo(HandCell);
