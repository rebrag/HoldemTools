// src/pages/private/controls.tsx
// Small shared UI pieces for the /private tools: segmented control, preset
// chips, and a determinate progress bar (state-driven width, no loops).
import clsx from "clsx";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-white/10 bg-white/[0.05] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            "px-3 py-1.5 rounded-md text-sm transition-colors active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            o.value === value
              ? "bg-emerald-400/20 text-emerald-300 font-semibold"
              : "text-emerald-100/70 hover:bg-white/10",
            disabled && "opacity-50"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "px-2.5 py-1 rounded-full text-xs border transition-colors active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        active
          ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300 font-semibold"
          : "border-white/10 bg-white/[0.05] text-emerald-100/70 hover:bg-white/10",
        disabled && "opacity-50"
      )}
    >
      {label}
    </button>
  );
}

export function ProgressBar({ progress, visible }: { progress: number; visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
      <div
        className="h-full rounded-full bg-emerald-400 transition-[width] duration-200"
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
    </div>
  );
}

export const glassCard =
  "rounded-xl border border-white/10 bg-white/[0.07] backdrop-blur-xl p-4 sm:p-5";
