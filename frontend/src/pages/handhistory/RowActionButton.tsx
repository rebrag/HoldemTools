// src/pages/handhistory/RowActionButton.tsx
// Compact, color-coded icon button for the saved-hand row action panel
// (Replay / Share / Copy / Delete). Matches the app's TransportButton idiom:
// a motion.button with tap/hover feedback gated by useReducedMotion, an
// aria-label + title for the icon-only affordance, and a uniform square shape
// so the four buttons read as one consistent set and fit cleanly on the row.
import React from "react";
import { motion, useReducedMotion } from "framer-motion";

export type RowActionTone = "replay" | "share" | "copy" | "delete";

const TONES: Record<RowActionTone, string> = {
  replay: "border-emerald-300 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
  share: "border-sky-300 bg-sky-50 text-sky-600 hover:bg-sky-100",
  copy: "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100",
  delete: "border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100",
};

// Transient success look (Copy/Share confirmation) — always emerald.
const SUCCESS_TONE = "border-emerald-400 bg-emerald-100 text-emerald-700";

const RowActionButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  tone: RowActionTone;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  success?: boolean; // show the emerald "done" state (e.g. after copy)
}> = ({ icon, label, tone, onClick, disabled, success }) => {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={(e) => {
        e.stopPropagation(); // don't toggle the row's expand/collapse
        onClick(e);
      }}
      disabled={disabled}
      aria-label={label}
      title={label}
      whileTap={disabled || reduce ? undefined : { scale: 0.88 }}
      whileHover={disabled || reduce ? undefined : { y: -1 }}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition-colors disabled:opacity-40 ${
        success ? SUCCESS_TONE : TONES[tone]
      }`}
    >
      {icon}
    </motion.button>
  );
};

export default RowActionButton;
