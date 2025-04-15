import React from "react";
import { HandCellData, getColorForAction } from "../utils/utils";
import { motion } from "framer-motion";

interface ColorKeyProps {
  data: HandCellData[];
  onActionClick: (action: string) => void;
}

const ColorKey: React.FC<ColorKeyProps> = ({ data, onActionClick }) => {
  const uniqueActions = Array.from(
    data.reduce((set, cell) => {
      Object.keys(cell.actions)
        .filter((action) => action !== "Position")
        .forEach((action) => set.add(action));
      return set;
    }, new Set<string>())
  );

  // If there are more than 3 actions, filter out "Fold"
  const displayedActions =
    uniqueActions.length > 3 ? uniqueActions.filter((action) => action !== "Fold") : uniqueActions;

  // makes the color of the buttons prettier, like sunset shading
  function shadeColor(color: string, percent: number) {
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
    <div className="flex gap-0.5 mb-0.5 w-full">
      {displayedActions
        .slice()
        .reverse()
        .sort((a, b) => {
          if (a === "ALLIN" && b === "Min") return -1;
          if (a === "Min" && b === "ALLIN") return 1;
          return 0;
        })
        .map((action) => {
        const isFold = action === "Fold";
        return (
          <div
            key={action}
            className={`flex-1 min-w-0 ${isFold ? "cursor-default" : "cursor-pointer"}`}
            onClick={isFold ? undefined : () => onActionClick(action)}
            title={isFold ? undefined : `Click to see reactions to ${action}`}
          >
            <motion.div
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: isFold ? 1 : 1.00 }}
              transition={{ type: "spring", stiffness: 900, damping: 50 }}
              className={`flex items-center justify-center rounded-sm shadow-sm ${isFold ? "" : "active:ring-2 ring-white"}`}
              style={{
                width: "100%",
                height: "calc(20px + 0.5vw)",
                background: `radial-gradient(circle at top left, ${getColorForAction(
                  action
                )} 0%, ${shadeColor(getColorForAction(action), -15)} 50%, ${shadeColor(
                  getColorForAction(action),
                  -35
                )} 100%)`,
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
