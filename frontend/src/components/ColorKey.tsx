import React from "react";
import { HandCellData, getColorForAction } from "../utils/utils";
import { motion } from "framer-motion";

interface ColorKeyProps {
  data: HandCellData[];
  onActionClick: (action: string) => void;
}

const ColorKey: React.FC<ColorKeyProps> = ({ data, onActionClick }) => {
  // distinct actions
  const uniqueActions = Array.from(
    data.reduce((set, cell) => {
      Object.keys(cell.actions)
        .filter((a) => a !== "Position")
        .forEach((a) => set.add(a));
      return set;
    }, new Set<string>())
  );

  const displayedActions = [...uniqueActions];

  // return a slightly lighterde
  const shadeColor = (hex: string, percent: number) => {
    const num = parseInt(hex.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const r = Math.min(255, Math.max(0, (num >> 16) + amt));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
    const b = Math.min(255, Math.max(0, (num & 0xff) + amt));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  };

  return (
    <div className="flex gap-0.5 mb-0.5 w-full">
      {displayedActions
        .sort((a, b) => {
          const rank = (act: string) =>
            act === "ALLIN"
              ? 0
              : act.startsWith("Raise ")
              ? 1
              : act === "Min"
              ? 2
              : act === "Call"
              ? 3
              : act === "Fold"
              ? 4
              : 5;
          return rank(a) - rank(b);
        })
        .map((action) => {
          const base = getColorForAction(action);
          // eslint-disable-next-line no-irregular-whitespace
          const hover = shadeColor(base, -30); // 15 % darker
          return (
            <div
              key={action}
              className="flex-1 min-w-0 cursor-pointer"
              onClick={() => onActionClick(action)}
              title={`Click to see reactions to ${action}`}
            >
              <motion.div
                whileTap={{ scale: 0.92 }}
                whileHover={{ scale: 1.0, backgroundColor: hover }}
                transition={{ type: "spring", stiffness: 900, damping: 50 }}
                className="flex items-center justify-center rounded-sm shadow-sm"
                style={{
                  width: "100%",
                  height: "calc(20px + 1vw)",
                  // height: "100%",
                  backgroundColor: base,
                  border: `2px solid ${base}`,
                }}
              >
                <span
                  style={{ color: "#fff", fontSize: "calc(0.45rem + 0.2vw)" }}
                  className="whitespace-nowrap"
                >
                  {action}
                </span>
              </motion.div>
            </div>
          );
        })}
    </div>
  );
};

export default ColorKey;
