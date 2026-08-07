// src/components/SegmentedControl.tsx
// Small segmented pill control, dark-theme styled. Lifted from the bankroll
// desktop shell so the solver's mobile dock can share it; the active pill
// slides between options (framer-motion layoutId) unless reduced motion is on.
import React, { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}): React.ReactElement {
  const reduceMotion = useReducedMotion();
  /* layoutId is document-global; scope it so two controls never fight. */
  const groupId = useId();
  return (
    <div
      className={`inline-flex items-center rounded-full bg-white/10 p-[2px] text-[11px] ${className}`}
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            data-testid={`segment-${opt.key}`}
            data-active={active ? "true" : undefined}
            className={`relative px-2.5 py-1 rounded-full transition text-[11px] ${
              active
                ? "text-emerald-950 font-semibold"
                : "text-emerald-100/80 hover:text-emerald-50"
            }`}
          >
            {active && (
              <motion.span
                layoutId={reduceMotion ? undefined : `${groupId}-pill`}
                className="absolute inset-0 rounded-full bg-emerald-400 shadow-sm"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
