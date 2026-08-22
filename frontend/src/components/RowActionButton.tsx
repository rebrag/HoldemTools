// src/components/RowActionButton.tsx
// Compact, color-coded icon button for hand-row action panels
// (Replay / Solution / Share / Copy / Delete). Matches the app's
// TransportButton idiom: a motion.button with tap/hover feedback gated by
// useReducedMotion, an aria-label + title for the icon-only affordance, and a
// uniform square shape so the buttons read as one consistent set on the row.
import React from "react";
import { motion, useReducedMotion } from "framer-motion";

export type RowActionTone = "replay" | "edit" | "solution" | "share" | "copy" | "delete";

const TONES: Record<RowActionTone, string> = {
  replay: "border-emerald-300 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
  edit: "border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100",
  solution: "border-violet-300 bg-violet-50 text-violet-600 hover:bg-violet-100",
  share: "border-sky-300 bg-sky-50 text-sky-600 hover:bg-sky-100",
  copy: "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100",
  delete: "border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100",
};

// Same palette translated for dark panels (drawer surfaces).
const DARK_TONES: Record<RowActionTone, string> = {
  replay: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20",
  edit: "border-amber-400/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20",
  solution: "border-violet-400/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20",
  share: "border-sky-400/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20",
  copy: "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
  delete: "border-rose-400/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20",
};

// Transient success look (Copy/Share confirmation) — always emerald.
const SUCCESS_TONE = "border-emerald-400 bg-emerald-100 text-emerald-700";
const DARK_SUCCESS_TONE = "border-emerald-400/60 bg-emerald-500/25 text-emerald-200";

/** The full class string for one of these buttons, exported so link-shaped
 *  siblings (HandSummaryRow's Replay <Link>) can render identically. */
export function rowActionClasses(
  tone: RowActionTone,
  variant: "light" | "dark" = "light",
  success = false,
  size: "md" | "sm" = "md"
): string {
  const toneClasses = success
    ? variant === "dark"
      ? DARK_SUCCESS_TONE
      : SUCCESS_TONE
    : (variant === "dark" ? DARK_TONES : TONES)[tone];
  const sizeClasses = size === "sm" ? "h-7 w-7 rounded-md" : "h-8 w-8 rounded-lg";
  return `inline-flex ${sizeClasses} items-center justify-center border shadow-sm transition-colors disabled:opacity-40 ${toneClasses}`;
}

const RowActionButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  tone: RowActionTone;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  success?: boolean; // show the emerald "done" state (e.g. after copy)
  variant?: "light" | "dark";
  size?: "md" | "sm";
}> = ({ icon, label, tone, onClick, disabled, success, variant = "light", size = "md" }) => {
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
      className={rowActionClasses(tone, variant, success, size)}
    >
      {icon}
    </motion.button>
  );
};

export default RowActionButton;
