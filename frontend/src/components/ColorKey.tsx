// src/components/ColorKey.tsx
import React from "react";
import { HandCellData, getColorForAction } from "../utils/utils";

interface ColorKeyProps {
  data: HandCellData[];
  onSelectAction: (action: string) => void;
}

const ColorKey: React.FC<ColorKeyProps> = ({ data, onSelectAction }) => {
  // Extract a unique set of actions from the grid data.
  const uniqueActions = Array.from(
    data.reduce((set, cell) => {
      Object.keys(cell.actions)
        .filter(action => action !== "Position")
        .forEach(action => set.add(action));
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
    <div
      style={{
        display: "flex",
        gap: "5px",
        marginBottom: "3px",
        alignItems: "center",
        //border: "1px solid #ccc"
      }}
    >
      {uniqueActions.slice().reverse().map((action) => (
        <div
        key={action}
        style={{
          display: "flex",
          cursor: "pointer",
        }}
        onClick={() => {
          onSelectAction(actionMapping[action] || action)
        }}
        title={`Click to see reactions to ${action}`}
      >
        <div
          style={{
            width: "70px",
            height: "30px",
            backgroundColor: getColorForAction(action),
            //border: "1px solid #ccc",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "7px",
          }}
        >

          <span style={{ color: "#fff", fontSize: "13px" }}>{action}</span>
        </div>
      </div>
      
      ))}
    </div>
  );
};

export default ColorKey;
