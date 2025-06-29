// src/components/Line.tsx
import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getColorForAction, stringToColor } from "../utils/utils";

export interface LineProps {
  line: string[];
  onLineClick: (idx: number) => void;
}

/* Reserve space on the far-right for the RandomizeButton */
const RESERVED_RIGHT = 56;

/* Soft-gray colour for the special “Reset” chip */
const ROOT_COLOR = "#d1d5db"; // Tailwind gray-300-ish

const Line: React.FC<LineProps> = ({ line, onLineClick }) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft]   = useState(false);
  const [canRight, setCanRight] = useState(false);

  /* ───── helper to update arrow visibility ───── */
  const refresh = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 0);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  /* run refresh on scroll / resize */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    refresh();
    el.addEventListener("scroll", refresh);
    window.addEventListener("resize", refresh);
    return () => {
      el.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, []);

  /* run refresh whenever the line content changes */
  useEffect(() => {
    // wait one tick for the DOM to paint before measuring
    requestAnimationFrame(refresh);
  }, [line]);

  /* smooth-scroll helper */
  const move = (delta: number) => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  /* ───── render ───── */
  return (
    <div className="relative w-full select-none">

      {/* ← chevron */}
      {canLeft && (
        <button
          onClick={() => move(-220)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-full bg-black/40 text-white"
        >
          <ChevronLeft size={18} strokeWidth={2.4} />
        </button>
      )}

      {/* → chevron (just before dice gap) */}
      {canRight && (
        <button
          onClick={() => move(220)}
          style={{ right: RESERVED_RIGHT }}
          className="absolute top-1/2 -translate-y-1/2 z-10 p-1 rounded-full bg-black/40 text-white"
        >
          <ChevronRight size={18} strokeWidth={2.4} />
        </button>
      )}

      {/* scroll strip */}
      <div
        ref={scrollerRef}
        style={{ width: `calc(100% - ${RESERVED_RIGHT}px)` }}
        className="flex flex-nowrap overflow-x-auto scroll-smooth space-x-1 no-scrollbar"
      >
        {/* “LINE:” label */}
        <div
          className="
            flex items-center justify-center flex-shrink-0
            px-2 py-1 font-semibold text-gray-200 whitespace-nowrap
            text-[0.65rem]
          "
        >
          LINE:
        </div>

        {/* chips */}
        {line.map((action, idx) => {
          const display  = action === "Root" ? "Reset" : action;
          const bgColor  =
            action === "Root"
              ? ROOT_COLOR
              : getColorForAction(action) || stringToColor(action);

          return (
            <div
              key={idx}
              onClick={() => onLineClick(idx)}
              style={{ backgroundColor: bgColor }}
              className={`
                flex items-center justify-center flex-shrink-0
                px-2 py-1 rounded text-xs whitespace-nowrap cursor-pointer
                ${action === "Root" ? "text-gray-800" : "text-white"}
              `}
            >
              {display}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Line;

/* If you haven't already, make sure you have the scrollbar-hiding helpers
   somewhere in your global CSS (e.g., index.css):
   .no-scrollbar::-webkit-scrollbar { display: none; }
   .no-scrollbar { scrollbar-width: none; }
*/
