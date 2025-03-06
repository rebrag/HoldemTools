// src/components/ColorKey.tsx
import React from "react";
import { HandCellData, getColorForAction } from "../utils/utils";

interface ColorKeyProps {
  data: HandCellData[];
  onSelectAction: (action: string) => void;
}

const ColorKey: React.FC<ColorKeyProps> = ({ data, onSelectAction }) => {
  // Get a unique set of actions from the grid data (ignoring "Position")
  const uniqueActions = Array.from(
    data.reduce((set, cell) => {
      Object.keys(cell.actions)
        .filter((action) => action !== "Position")
        .forEach((action) => set.add(action));
      return set;
    }, new Set<string>())
  );

  const actionMapping: Record<string, string> = {
    "Raise 2bb": "15",
    "Raise 1.5bb": "14",
    "Raise 54%": "40054",
    "Raise 75%": "40075",
    "Raise 50%": "40050",
    // add other mappings as needed
  };

  return (
    <div className="flex gap-0.5 mb-1 items-center">
      {uniqueActions.slice().reverse().map((action) => (
        <div
          key={action}
          className="flex cursor-pointer"
          onClick={() => onSelectAction(actionMapping[action] || action)}
          title={`Click to see reactions to ${action}`}
        >
          <div
            className="w-[50px] h-[30px] flex items-center justify-center rounded-md hover:border-3 hover:border-black
                       max-[440px]:w-[32px] max-[440px]:h-[24px]"
            style={{ backgroundColor: getColorForAction(action) }}
          >
            <span className="text-white text-[10px] max-[420px]:text-[8px] whitespace-nowrap">
              {action}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ColorKey;
