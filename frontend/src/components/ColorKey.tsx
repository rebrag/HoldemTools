import React from "react";
import { HandCellData, getColorForAction } from "../utils/utils";
import { motion } from "framer-motion";

interface ColorKeyProps {
  data: HandCellData[];
  onActionClick: (action: string) => void;
}

const ColorKey: React.FC<ColorKeyProps> = ({ data, onActionClick }) => {
  /* Gather every distinct action in the matrix */
  const uniqueActions = Array.from(
    data.reduce((set, cell) => {
      Object.keys(cell.actions)
        .filter((action) => action !== "Position")
        .forEach((action) => set.add(action));
      return set;
    }, new Set<string>())
  );

  /* Show them all (no more “hide Fold” rule) */
  const displayedActions = [...uniqueActions];

  /* Helper: darker-or-lighter shade */
  function shadeColor(color: string, percent: number) {
    const num = parseInt(color.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = ((num >> 8) & 0x00ff) + amt;
    const B = (num & 0x0000ff) + amt;
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
        .sort((a, b) => {
          const getPriority = (action: string) => {
            if (action === "ALLIN") return 0;
            if (action.startsWith("Raise ")) return 1;
            if (action === "Min") return 2;
            if (action === "Call") return 3;
            if (action === "Fold") return 4;
            return 5;
          };
          return getPriority(a) - getPriority(b);
        })
        .map((action) => (
          <div
            key={action}
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => onActionClick(action)}
            title={`Click to see reactions to ${action}`}
          >
            <motion.div
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: 1.0 }}
              transition={{ type: "spring", stiffness: 900, damping: 50 }}
              className="flex items-center justify-center rounded-sm shadow-sm active:ring-2 ring-white"
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
        ))}
    </div>
  );
};

export default ColorKey;
