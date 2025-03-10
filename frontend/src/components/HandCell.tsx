// HandCell.tsx
import React from "react";
import { HandCellData, getColorForAction } from "../utils/utils";

interface HandCellProps {
  data: HandCellData;
  randomFillColor?: string;
}

const HandCell: React.FC<HandCellProps> = ({ data, randomFillColor }) => {
  return (
    <div
      tabIndex={-1}
      className="w-full h-full aspect-square border border-gray-400 relative select-none transition-colors duration-700"
      style={{ backgroundColor: randomFillColor || "transparent" }}
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
      <div
        className="absolute inset-0 flex items-center justify-center text-white text-[5px] md:text-[8px] font-semibold"
        style={{ textShadow: "3px 3px 6px rgba(0, 0, 0, 0.7)" }}
      >
        {data.hand}
      </div>
    </div>
  );
};

export default HandCell;
