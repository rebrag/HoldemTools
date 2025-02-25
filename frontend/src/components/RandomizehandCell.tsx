// src/components/RandomizedHandCell.tsx
import React from "react";
import { HandCellData, getColorForAction } from "../utils/utils";

interface RandomizedHandCellProps {
  data: HandCellData;
}

const RandomizedHandCell: React.FC<RandomizedHandCellProps> = ({ data }) => {
  // Create a weighted random selection from data.actions.
  const pickRandomAction = (): string => {
    const entries = Object.entries(data.actions);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    const rand = Math.random() * total;
    let cumulative = 0;
    for (const [action, weight] of entries) {
      cumulative += weight;
      if (rand < cumulative) {
        return action;
      }
    }
    return entries[entries.length - 1][0];
  };

  const chosenAction = pickRandomAction();
  const bgColor = getColorForAction(chosenAction);

  return (
    <div
      tabIndex={-1}
      style={{
        border: "1px solid #999",
        height: "22px",
        position: "relative",
        width: "100%",
        userSelect: "none",
        backgroundColor: bgColor,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          color: "white",
          pointerEvents: "none",
          fontFamily: "Arial-Narrow, sans-serif",
          fontSize: "0.8rem",
          textShadow: "3px 3px 6px rgba(0, 0, 0, 0.7)",
        }}
      >
        {data.hand} – {chosenAction}
      </div>
    </div>
  );
};

export default RandomizedHandCell;
