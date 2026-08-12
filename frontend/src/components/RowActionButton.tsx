// src/components/RowActionButton.tsx
// Compact, color-coded icon button for hand-row action panels
// (Replay / Solution / Share / Copy / Delete). Matches the app's
// TransportButton idiom: a motion.button with tap/hover feedback gated by
// useReducedMotion, an aria-label + title for the icon-only affordance, and a
// uniform square shape so the buttons read as one consistent set on the row.
import React from "react";
import { motion, useReducedMotion } from "framer-motion";

export type RowActionTone = "replay" | "solution" | "share" | "copy" | "delete";

const TONES: Record<RowActionTone, string> = {
  replay: "border-emerald-300 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
  solution: "border-violet-300 bg-violet-50 text-violet-600 hover:bg-violet-100",
  share: "border-sky-300 bg-sky-50 text-sky-600 hover:bg-sky-100",
  copy: "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100",
  delete: "border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100",
};

// Transient success look (Copy/Share confirmation) — always emerald.
const SUCCESS_TONE = "border-emerald-400 bg-emerald-100 text-emerald-700";

type RowActionProps = {
  icon: React.ReactNode;
  label: string;
  tone: RowActionTone;
  disabled?: boolean;
  success?: boolean; // show the emerald "done" state (e.g. after copy)
} & (
  | { onClick: (e: React.MouseEvent) => void; href?: never }
  /** Renders a real anchor that opens in a new tab. Actions that leave the
   *  page (replay, solution) use this so the list stays where it is, and so
   *  middle-click / ⌘-click / "open in new tab" behave as the user expects -
   *  none of which a button can offer. */
  | { href: string; onClick?: never }
);

const RowActionButton: React.FC<RowActionProps> = ({
  icon,
  label,
  tone,
  href,
  onClick,
  disabled,
  success,
}) => {
  const reduce = useReducedMotion();
  const className = `inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition-colors disabled:opacity-40 ${
    success ? SUCCESS_TONE : TONES[tone]
  }`;
  const motionProps = {
    whileTap: disabled || reduce ? undefined : { scale: 0.88 },
    whileHover: disabled || reduce ? undefined : { y: -1 },
  };

  if (href) {
    return (
      <motion.a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        // Don't toggle the row's expand/collapse on the way out.
        onClick={(e) => e.stopPropagation()}
        aria-label={label}
        title={label}
        {...motionProps}
        className={className}
      >
        {icon}
      </motion.a>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={(e) => {
        e.stopPropagation(); // don't toggle the row's expand/collapse
        onClick?.(e);
      }}
      disabled={disabled}
      aria-label={label}
      title={label}
      {...motionProps}
      className={className}
    >
      {icon}
    </motion.button>
  );
};

export default RowActionButton;
