// src/components/HandCell.tsx
import React from "react";
import { HandCellData, getColorForAction } from "../utils/utils";

interface HandCellProps {
  data: HandCellData;
  randomFillColor?: string;
}

// Helper function to get rounded corner class based on hand
const getRoundedCornerClass = (hand: string): string => {
  switch (hand) {
    case "AA":
      return "rounded-tl-md"; // Round top-left for AA
    case "A2s":
      return "rounded-tr-md"; // Round top-right for A2s
    case "A2o":
      return "rounded-bl-md"; // Round bottom-left for A2o
    case "22":
      return "rounded-br-md"; // Round bottom-right for 22
    default:
      return "";
  }
};

const HandCell: React.FC<HandCellProps> = ({ data, randomFillColor }) => {
  return (
    <div
      tabIndex={-1}
      className={`w-full h-full aspect-square relative select-none transition-colors duration-700 overflow-hidden ${getRoundedCornerClass(data.hand)}`}
      style={{
        backgroundColor: randomFillColor || "transparent",
      }}
    >
      {!randomFillColor && (
        <div className="flex h-full w-full">
          {Object.entries(data.actions)
            .reverse()
            .map(([action, strategy]) => {
              const width = strategy * 100;
              return (
                <div
                  key={action}
                  style={{ width: `${width}%`, backgroundColor: getColorForAction(action) }}
                />
              );
            })}
        </div>
      )}
      {/* Shadow overlay div */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          boxShadow: "inset 0 0 0 0.3px rgba(203, 213, 224, 0.5)",
        }}
      />
      <div
        className="absolute inset-0 flex items-center justify-center text-white font-semibold"
        style={{
          fontSize: "calc(4px + .28vw)",
          textShadow: "calc(2px) calc(2px) calc(3px) rgba(0, 0, 0, .7)",
        }}
      >
        {data.hand}
      </div>
    </div>
  );
};

export default HandCell;
