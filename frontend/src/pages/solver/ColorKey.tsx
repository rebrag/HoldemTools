// src/components/ColorKey.tsx
import React from "react";
import { HandCellData, getColorForAction } from "../utils/utils";
import { motion } from "framer-motion";

interface ColorKeyProps {
  data?: HandCellData[];
  loading?: boolean;
  onActionClick?: (action: string) => void;
}

const BOX_HEIGHT = "calc(23px)";

const ColorKey: React.FC<ColorKeyProps> = ({
  data,
  loading,
  onActionClick = () => {},
}) => {
  /* ------------------------------------------------------------------ */
  /*  Is the solver / plate still loading?                              */
  /* ------------------------------------------------------------------ */
  const cells = data ?? [];

  const isLoadingExplicit = loading ?? false; // coercion for TS
  const isLoadingHeuristic =
    cells.length === 0 ||
    cells.every(
      (c) =>
        Object.keys(c.actions ?? {}).filter((a) => a !== "Position").length ===
        0
    );

  const isLoading = isLoadingExplicit || isLoadingHeuristic;

  if (isLoading) {
    /* same flex / height → no layout shift */
    return (
      <div className="flex gap-0.5 mb-0.5 w-full">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex-1 min-w-0">
            <div
              className="rounded-sm bg-slate-200/70 shadow-sm animate-pulse"
              style={{ width: "100%", height: BOX_HEIGHT }}
            />
          </div>
        ))}
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Real colour key (data present)                                    */
  /* ------------------------------------------------------------------ */
  const uniqueActions = Array.from(
    cells.reduce((set, cell) => {
      Object.keys(cell.actions)
        .filter((a) => a !== "Position")
        .forEach((a) => set.add(a));
      return set;
    }, new Set<string>())
  );

  const ordered = uniqueActions.sort((a, b) => {
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
  });

  const shadeColor = (hex: string, percent: number) => {
    const num = parseInt(hex.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const r = Math.min(255, Math.max(0, (num >> 16) + amt));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
    const b = Math.min(255, Math.max(0, (num & 0xff) + amt));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b)
      .toString(16)
      .slice(1)}`;
  };

  return (
    <div className="flex gap-0.5 mb-0.5 w-full">
      {ordered.map((action) => {
        const base = getColorForAction(action);
        const hover = shadeColor(base, -30);

        return (
          <div
            key={action}
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => onActionClick(action)}
            title={`Click to see reactions to ${action}`}
          >
            <motion.div
              className="flex items-center justify-center rounded-sm shadow-sm"
              style={{
                width: "100%",
                height: BOX_HEIGHT,
                backgroundColor: base,
                border: `2px solid ${base}`,
              }}
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: 1, backgroundColor: hover }}
              transition={{ type: "spring", stiffness: 900, damping: 50 }}
            >
              <span
                className="whitespace-nowrap select-none text-white"
                style={{ fontSize: "calc(0.45rem + 0.2vw)" }}
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
