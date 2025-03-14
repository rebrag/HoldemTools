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
    "Raise 78%": "40078",
    // add other mappings as needed
  };

  function shadeColor(color: string, percent: number) {
    // Assume color is in hex format "#RRGGBB"
    const num = parseInt(color.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = ((num >> 8) & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return (
      "#" +
      (
        0x1000000 +
        (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
        (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
        (B < 255 ? (B < 1 ? 0 : B) : 255)
      )
        .toString(16)
        .slice(1)
    );
  }
  

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
          className="flex items-center justify-center rounded-md hover:border-3 hover:border-black"
          style={{
            width: "calc(26px + 1.3vw)",
            height: "calc(20px + 0.5vw)",
            background: `radial-gradient(circle at top left, ${getColorForAction(action)} 0%, ${shadeColor(getColorForAction(action), -15)} 50%, ${shadeColor(getColorForAction(action), -35)} 100%)`
          }}
        >
          <span style={{ color: "#fff", fontSize: "calc(0.4rem + 0.2vw)" }} className="whitespace-nowrap">
            {action}
          </span>
        </div>
      </div>
      
      ))}
    </div>
  );
};

export default ColorKey;
