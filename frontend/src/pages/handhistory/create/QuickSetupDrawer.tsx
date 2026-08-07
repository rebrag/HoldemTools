// src/pages/handhistory/create/QuickSetupDrawer.tsx
// One-shot table setup: every seat's name and stack in a single list, instead
// of tapping seats one by one. Structural details (cards, hero, button,
// straddles) stay in SeatEditorModal - this drawer only covers the fields
// every seat needs.
//
// Rendered through ResponsiveDrawer (bottom sheet on phones), which the parent
// keeps mounted and toggles via `open` so the exit animation plays. The shared
// drawer uses backdrop-blur; unlike SeatEditorModal's full-screen scroll layer
// (which avoids it for iOS Safari's sake) this shell is already shipped on
// this page by the solve prompt, so the concern doesn't apply here.
import { useEffect, useRef, useState } from "react";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import { positionLabelsForSeats } from "./positions";
import type { Seat } from "./types";

export interface QuickSetupRow {
  occupied: boolean;
  name: string;
  stack: string;
}

interface QuickSetupDrawerProps {
  open: boolean;
  onClose: () => void;
  seats: Seat[];
  buttonSeat: number;
  onApply: (rows: QuickSetupRow[]) => void;
}

const rowsFromSeats = (seats: Seat[]): QuickSetupRow[] =>
  seats.map((s) => ({ occupied: s.occupied, name: s.name, stack: s.stack }));

const inputCls =
  "w-full rounded-lg border border-hairline bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40";

const QuickSetupDrawer: React.FC<QuickSetupDrawerProps> = ({
  open,
  onClose,
  seats,
  buttonSeat,
  onApply,
}) => {
  const [rows, setRows] = useState<QuickSetupRow[]>(() => rowsFromSeats(seats));
  /* Flat [name0, stack0, name1, stack1, ...] so Enter walks the list. */
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  /* Re-seed from the live seats each time the drawer opens, so a seat edited
   * through SeatEditorModal in between shows its current values. */
  useEffect(() => {
    if (open) setRows(rowsFromSeats(seats));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* Position chips recompute from the drawer's own rows, so toggling a seat
   * re-labels the table live. Sitting-out seats keep their exclusion. */
  const labels = positionLabelsForSeats(
    rows.map((r, i) => r.occupied && !seats[i]?.sittingOut),
    buttonSeat
  );

  const setRow = (i: number, partial: Partial<QuickSetupRow>) =>
    setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...partial } : r)));

  /* Typing into an empty seat's row seats a player there (same "filled means
   * occupied" spirit as the seat editor); the toggle empties it again. */
  const editRow = (i: number, partial: Partial<QuickSetupRow>) =>
    setRow(i, rows[i].occupied ? partial : { ...partial, occupied: true });

  const focusNext = (flatIdx: number) => {
    const refs = inputRefs.current;
    for (let k = flatIdx + 1; k < refs.length; k++) {
      const el = refs[k];
      if (el && !el.disabled) {
        el.focus();
        return;
      }
    }
    apply();
  };

  const isLastEnabled = (flatIdx: number) =>
    !inputRefs.current.some((el, k) => k > flatIdx && el && !el.disabled);

  const apply = () =>
    onApply(
      rows.map((r) => ({ ...r, name: r.name.trim(), stack: r.stack.trim() }))
    );

  return (
    <ResponsiveDrawer
      open={open}
      onClose={onClose}
      scrollMode="custom"
      desktopMaxWidthClassName="sm:max-w-lg"
      zClassName="z-[80]"
      ariaLabelledBy="quick-setup-title"
    >
      <>
        <div className="px-5 pt-2 sm:pt-5 pb-3">
          <h2
            id="quick-setup-title"
            className="text-lg font-bold tracking-tight text-white"
          >
            Quick setup
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Enter every player's name and stack in one go. Cards, hero, and
            straddles are still set per seat.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-3">
          <div className="flex flex-col gap-1.5">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.occupied}
                  onChange={(e) => setRow(i, { occupied: e.target.checked })}
                  aria-label={`Seat ${i + 1} occupied`}
                  className="h-4 w-4 shrink-0 accent-emerald-500"
                />
                <span
                  className={`w-11 shrink-0 text-center text-[11px] font-semibold tabular-nums ${
                    row.occupied ? "text-emerald-300" : "text-slate-600"
                  }`}
                >
                  {labels[i] || `S${i + 1}`}
                </span>
                <input
                  ref={(el) => {
                    inputRefs.current[i * 2] = el;
                  }}
                  type="text"
                  value={row.name}
                  disabled={!row.occupied}
                  placeholder={labels[i] || `Seat ${i + 1}`}
                  enterKeyHint="next"
                  onChange={(e) => editRow(i, { name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") focusNext(i * 2);
                  }}
                  className={`${inputCls} flex-1 min-w-0`}
                  aria-label={`Seat ${i + 1} name`}
                />
                <input
                  ref={(el) => {
                    inputRefs.current[i * 2 + 1] = el;
                  }}
                  type="tel"
                  inputMode="decimal"
                  value={row.stack}
                  disabled={!row.occupied}
                  placeholder="Stack"
                  enterKeyHint={isLastEnabled(i * 2 + 1) ? "done" : "next"}
                  onChange={(e) => editRow(i, { stack: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") focusNext(i * 2 + 1);
                  }}
                  className={`${inputCls} w-20 shrink-0`}
                  aria-label={`Seat ${i + 1} stack`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 border-t border-hairline px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-xl border border-hairline bg-white/5 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="flex-1 cursor-pointer rounded-xl bg-accent py-2.5 text-sm font-semibold text-on-accent transition-all hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            Apply
          </button>
        </div>
      </>
    </ResponsiveDrawer>
  );
};

export default QuickSetupDrawer;
