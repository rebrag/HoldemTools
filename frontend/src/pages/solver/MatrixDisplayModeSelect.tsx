// Display-mode dropdown above the study matrix (GTO Wizard's "Strategy" menu):
// a labeled pill opening a Strategy / EV / Equity radio popover. Equity needs
// per-combo data (postflop, acting seat), so it grays out elsewhere.
import React, { useCallback, useRef, useState } from "react";
import { useDismissOnOutside } from "@/hooks/useDismissOnOutside";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import {
  MATRIX_DISPLAY_MODE_OPTIONS,
  type MatrixDisplayMode,
} from "@/lib/solver/matrixDisplayMode";

const MatrixDisplayModeSelect: React.FC<{
  /** Effective mode (highlighted; may differ from the saved preference). */
  mode: MatrixDisplayMode;
  onChange: (mode: MatrixDisplayMode) => void;
  /** False grays out the Equity entry ("Postflop only"). */
  equityAvailable: boolean;
  className?: string;
}> = ({ mode, onChange, equityAvailable, className = "" }) => {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  /* Close on any press outside the button + popover, or on Escape. */
  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutside(wrapRef, open, close);

  const activeLabel =
    MATRIX_DISPLAY_MODE_OPTIONS.find((o) => o.mode === mode)?.label ??
    "Strategy";

  return (
    <div ref={wrapRef} className={`relative flex-shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="display-mode-btn"
        className={[
          "inline-flex h-9 items-center gap-1 rounded-lg px-3 shadow-sm",
          "border transition-colors",
          "text-xs font-semibold",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          open
            ? "border-accent/50 bg-accent/15 text-accent"
            : "border-hairline bg-white/5 text-slate-300 hover:border-white/25 hover:text-slate-100",
        ].join(" ")}
        title="Matrix display mode"
      >
        {activeLabel}
        <ChevronDown size={13} strokeWidth={2.4} />
      </button>

      {open && (
        <motion.div
          role="menu"
          aria-label="Matrix display mode"
          data-testid="display-mode-menu"
          className="
            absolute left-0 mt-2 w-60 z-50 p-1.5
            rounded-xl border border-hairline
            bg-surface/90 backdrop-blur-md
            shadow-[0_18px_40px_rgba(2,6,23,0.45)]
          "
          initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformOrigin: "top left" }}
        >
          <div className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Display
          </div>
          {MATRIX_DISPLAY_MODE_OPTIONS.map(({ mode: m, label, desc }) => {
            const active = m === mode;
            const disabled = m === "equity" && !equityAvailable;
            return (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                aria-disabled={disabled}
                disabled={disabled}
                data-mode={m}
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
                className={[
                  "w-full rounded-lg px-2 py-1.5 text-left transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  disabled
                    ? "cursor-not-allowed opacity-40"
                    : active
                    ? "bg-accent/20 text-accent"
                    : "text-slate-200 hover:bg-white/10",
                ].join(" ")}
              >
                <span className="block text-xs font-semibold">{label}</span>
                <span
                  className={`block text-[10px] leading-snug ${
                    active && !disabled ? "text-accent/80" : "text-slate-400"
                  }`}
                >
                  {disabled ? "Postflop only" : desc}
                </span>
              </button>
            );
          })}
        </motion.div>
      )}
    </div>
  );
};

export default MatrixDisplayModeSelect;
