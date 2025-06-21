// src/components/Line.tsx
import React from "react";
import { getColorForAction } from "../utils/utils";

/* ---------- props ---------- */
interface LineProps {
  line: string[];
  onLineClick: (index: number) => void;
}

/* ---------- component ---------- */
const Line: React.FC<LineProps> = ({ line, onLineClick }) => (
  <div className="flex flex-wrap gap-1 items-center p-1">
    <span
      className="mr-2 select-none text-[11px] font-semibold tracking-widest uppercase text-gray-400">
      Line:
    </span>


    {line.map((action: string, idx: number) => {
      const label = action === "Root" ? "Reset" : action;
      const base =
        action === "Root" ? "#6b7280" /* gray-500 */ : getColorForAction(action);

      return (
        <button
          key={idx}
          onClick={() => onLineClick(idx)}
          style={{ backgroundColor: base }}
          className="px-2 py-0.5 rounded-full text-white text-xs
                     hover:brightness-110 active:scale-95 transition"
        >
          {label}
        </button>
      );
    })}
  </div>
);

export default Line;
