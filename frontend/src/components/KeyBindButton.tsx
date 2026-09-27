// src/components/KeyBindButton.tsx
//
// "Set a shortcut for X": a small control that shows the key bound to an
// action and rebinds it from a real keypress. Click it and it waits for the
// next key (Escape backs out, a second click backs out); once bound it
// shows the combo as a key cap, with a clear button beside it. The owner
// keeps the combo (usually in localStorage) and fires the action with
// `useKeyBinding`; this only edits the combo.
import { useCallback, useState } from "react";
import { formatCombo, useKeyCapture, type KeyCombo } from "@/hooks/useKeyBinding";

interface KeyBindButtonProps {
  combo: KeyCombo | null;
  onChange: (combo: KeyCombo | null) => void;
  /** What the key does, for the tooltips: "Clear cards". */
  action: string;
  /** Pages that keep Tab for their inputs pass -1. */
  tabIndex?: number;
  className?: string;
}

const BASE =
  "inline-flex min-h-[24px] items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors";

const KeyBindButton = ({ combo, onChange, action, tabIndex, className = "" }: KeyBindButtonProps) => {
  const [capturing, setCapturing] = useState(false);
  const stop = useCallback(() => setCapturing(false), []);
  const bind = useCallback(
    (c: KeyCombo) => {
      onChange(c);
      setCapturing(false);
    },
    [onChange]
  );
  useKeyCapture(capturing, bind, stop);

  const label = combo ? formatCombo(combo) : null;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        tabIndex={tabIndex}
        onClick={() => setCapturing((c) => !c)}
        aria-pressed={capturing}
        title={
          capturing
            ? `Press the key to bind to ${action}. Esc cancels.`
            : label
              ? `${action} is bound to ${label}. Click to change it.`
              : `Choose a keyboard shortcut for ${action}`
        }
        className={`${BASE} ${
          capturing
            ? "border-emerald-400 bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-400/60"
            : "border-slate-700 bg-slate-950/50 text-slate-300 hover:border-slate-500 hover:text-slate-100"
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 12"
          className="h-3 w-5 shrink-0 fill-none stroke-current"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="1" y="1" width="18" height="10" rx="1.6" />
          <path d="M4 4h1M7 4h1M10 4h1M13 4h1M16 4h.01M4 7h1M7 7h6M16 7h.01" />
        </svg>
        {capturing ? (
          <span className="animate-pulse">Press a key…</span>
        ) : label ? (
          <kbd className="rounded bg-black/40 px-1 font-sans tabular-nums text-slate-100">{label}</kbd>
        ) : (
          <span>Set key</span>
        )}
      </button>
      {label && !capturing && (
        <button
          type="button"
          tabIndex={tabIndex}
          onClick={() => onChange(null)}
          aria-label={`Remove the ${action} shortcut`}
          title={`Remove the ${action} shortcut`}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-700 bg-slate-950/50 text-[11px] leading-none text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-100"
        >
          ×
        </button>
      )}
    </span>
  );
};

export default KeyBindButton;
