// HandCell.tsx
import React from "react";
import { HandCellData, getColorForAction } from "./utils";

interface HandCellProps {
  data: HandCellData;
}

const HandCell: React.FC<HandCellProps> = ({ data }) => {
  return (
    <div
      tabIndex={-1}
      style={{
        border: "1px solid #ccc",
        height: "20px",
        position: "relative",
        width: "100%",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", height: "100%", width: "100%" }}>
        {Object.entries(data.actions).map(([action, strategy]) => {
          const width = strategy * 100;
          return (
            <div
              key={action}
              style={{
                width: `${width}%`,
                backgroundColor: getColorForAction(action),
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          color: "white",
          pointerEvents: "none",
          fontFamily: "Arial",
        }}
      >
        {data.hand}
      </div>
    </div>
  );
};

export default HandCell;
