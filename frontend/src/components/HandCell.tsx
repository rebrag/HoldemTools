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
      style={{
        border: "1px solid #999",
        height: "22px", //determines
        position: "relative",
        width: "100%",
        userSelect: "none",
        backgroundColor: randomFillColor || "transparent",
        transition: "background-color 0.8s ease", // <-- This line adds the transition
      }}
    >
      {/* Only render the layered colored segments if not in random fill mode */}
      {!randomFillColor && (
        <div style={{ display: "flex", height: "100%", width: "100%" }}>
          {Object.entries(data.actions)
            .reverse()
            .map(([action, strategy]) => {
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
      )}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          color: "white",
          pointerEvents: "none",
          fontFamily: "Arial-Narrow, sans-serif",
          fontSize: "0.7rem",
          textShadow: "3px 3px 6px rgba(0, 0, 0, 0.7)",
        }}
      >
        {data.hand}
      </div>
    </div>
  );
};

export default HandCell;
