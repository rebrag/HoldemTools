// ColorKey.tsx
import React from "react";
import { HandCellData, getColorForAction } from "./utils";

interface ColorKeyProps {
  data: HandCellData[];
}

const ColorKey: React.FC<ColorKeyProps> = ({ data }) => {
  // Extract unique actions from the grid data.
  const uniqueActions = Array.from(
    data.reduce((set, cell) => {
      Object.keys(cell.actions).forEach((action) => set.add(action));
      return set;
    }, new Set<string>())
  );

  return (
    <div
      style={{
        display: "flex",
        gap: "10px",
        marginBottom: "10px",
        alignItems: "center",
      }}
    >
      {uniqueActions.map((action) => (
        <div key={action} style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: "20px",
              height: "20px",
              backgroundColor: getColorForAction(action),
              marginRight: "5px",
              border: "1px solid #ccc",
            }}
          />
          <span>{action}</span>
        </div>
      ))}
    </div>
  );
};

export default ColorKey;
