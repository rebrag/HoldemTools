import React from "react";
import ColorKey from "./ColorKey"; // Action buttons
import HandCell from "./HandCell"; // Individual cell component
import { HandCellData } from "../utils/utils";

interface PlateProps {
  position: string;
  bb: string;
  gridData: HandCellData[];
  width?: number;  // Allowing custom width
  height?: number; // Allowing custom height
  onSelectAction: (action: string) => void;
}

const Plate: React.FC<PlateProps> = ({
  position,
  bb,
  gridData,
  width = 400,  // Default width
  height = 450, // Default height
  onSelectAction,
}) => {
  return (
    <div
      className="plate-container border rounded-xl shadow-md p-2"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        alignItems: "center",
        background: "white",
        boxSizing: "border-box",
      }}
    >
      {/* Position & BB Info */}
      <h2 className="font-bold" style={{ textShadow: "1px 1px 1px rgba(0, 0, 0, 0.7)" }}>
        {position} {bb}bb
      </h2>

      {/* Action Buttons */}
      <ColorKey
        data={gridData}
        onSelectAction={(action) => onSelectAction(action)}
      />

      {/* 13x13 Grid */}
      <div
        className="grid-container"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(13, 1fr)",
          gridTemplateRows: "repeat(13, 1fr)",
          gap: "0px",
          width: `${width * 0.9}px`, // Slightly smaller than plate
        }}
      >
        {gridData.map((handData, index) =>
          handData ? (
            <HandCell key={index} data={handData} />
          ) : (
            <div key={index} />
          )
        )}
      </div>
    </div>
  );
};

export default Plate;
