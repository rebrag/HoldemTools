import React, { useEffect, useState } from "react";
import { HandCellData, getColorForAction } from "../utils/utils";

interface HandCellProps {
  data: HandCellData;
  randomFillColor?: string;
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

const FALLBACK_COLOR = "#1111"; // your fallback background

const HandCell: React.FC<HandCellProps> = ({ data, randomFillColor }) => {
  // manage container background in state
  const [containerBg, setContainerBg] = useState<string>(FALLBACK_COLOR);

  useEffect(() => {
    if (randomFillColor) {
      setContainerBg(randomFillColor);
    } else {
      const timeoutId = setTimeout(() => {
        setContainerBg(FALLBACK_COLOR);
      }, 10000); 

      return () => clearTimeout(timeoutId);
    }
  }, [randomFillColor]);

  return (
    <div
      tabIndex={-1}
      className={`w-full h-full aspect-square relative select-none overflow-hidden ${getRoundedCornerClass(data.hand)}`}
      style={{
        backgroundColor: containerBg,
      }}
    >
      <div className="flex h-full w-full">
        {Object.entries(data.actions)
          .reverse()
          .map(([action, strategy]) => {
            // When randomFillColor is active, the segments shrink to 0%
            // Otherwise, they display at their full width.
            const width = randomFillColor ? 0 : strategy * 100;
            return (
              <div
                key={action}
                style={{
                  width: `${width}%`,
                  backgroundColor: getColorForAction(action),
                  transition: "width 0.5s ease-in-out",
                }}
              />
            );
          })}
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

export default HandCell;
