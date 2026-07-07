// src/pages/handhistory/create/SeatEditorModal.tsx
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import PlayingCard from "@/components/PlayingCard";
import RankSuitKeypad from "@/components/RankSuitKeypad";
import type { HoleCards, Seat } from "./types";

export interface SeatEditResult {
  seat: Seat;
  makeButton: boolean;
  makeHero: boolean;
  makeStraddle: boolean;
  straddleAmount: string;
}

interface Props {
  positionLabel: string;
  seat: Seat;
  isButton: boolean;
  isHero: boolean;
  isStraddle: boolean;
  straddleAmount: string; // current straddle amount in state
  bigBlind: string; // used to default a fresh straddle to 2× BB
  canStraddle: boolean; // false for the BB seat (already a forced bet)
  capacity: number; // hole cards for this game (2 / 4 / 5)
  otherUsed: Set<string>; // cards assigned elsewhere (other seats + board)
  onSave: (result: SeatEditResult) => void;
  onClose: () => void;
  // Setup-phase structural actions on an occupied seat. Omitted during the
  // action phase, where changing who is in the hand isn't allowed.
  allowStructural?: boolean;
  onEmpty?: () => void; // remove the player, leaving an empty seat
  onMove?: () => void; // start moving this player to another seat
}

const SeatEditorModal: React.FC<Props> = ({
  positionLabel,
  seat,
  isButton,
  isHero,
  isStraddle,
  straddleAmount,
  bigBlind,
  canStraddle,
  capacity,
  otherUsed,
  onSave,
  onClose,
  allowStructural,
  onEmpty,
  onMove,
}) => {
  const [name, setName] = useState(seat.name);
  const [stack, setStack] = useState(seat.stack);
  const [hole, setHole] = useState<HoleCards>(seat.holeCards);
  const [makeButton, setMakeButton] = useState(isButton);
  const [makeHero, setMakeHero] = useState(isHero);
  const [makeStraddle, setMakeStraddle] = useState(isStraddle);
  const defaultStraddle = (() => {
    const bb = parseFloat(bigBlind);
    return Number.isFinite(bb) && bb > 0 ? (bb * 2).toString() : "2";
  })();
  const [straddleAmt, setStraddleAmt] = useState(
    isStraddle && straddleAmount ? straddleAmount : defaultStraddle
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const selected = hole.filter((c): c is string => !!c);
  const gridUsed = new Set<string>([...otherUsed, ...selected]);

  const pad = (arr: string[]): HoleCards =>
    Array.from({ length: capacity }, (_, i) => arr[i] ?? null);

  const handlePick = (code: string) => {
    setHole((prev) => {
      const arr = prev.filter((c): c is string => !!c);
      if (arr.includes(code)) return pad(arr.filter((c) => c !== code));
      if (otherUsed.has(code)) return prev; // used elsewhere
      if (arr.length >= capacity) return prev;
      return pad([...arr, code]);
    });
  };

  const save = () => {
    // Don't resurrect a deliberately-empty seat on a no-op save (e.g. tapping the
    // backdrop): it only becomes occupied once something is entered.
    const filled = name.trim() !== "" || stack.trim() !== "" || hole.some((c) => !!c);
    onSave({
      seat: {
        occupied: seat.occupied || filled,
        name: name.trim(),
        stack: stack.trim(),
        holeCards: pad(hole.filter((c): c is string => !!c)),
      },
      makeButton,
      makeHero,
      makeStraddle: canStraddle && makeStraddle,
      straddleAmount: straddleAmt.trim() || defaultStraddle,
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[1300] overflow-y-auto">
      {/* Clicking the backdrop commits the edit (same as "Done"), not discard. */}
      <div className="absolute inset-0 bg-black/50" onPointerDown={save} aria-hidden="true" />
      {/* Center when it fits; scroll (never clipping top or bottom) when it's taller
          than the viewport. Bottom safe-area padding keeps "Done" clear of the
          home indicator on mobile. */}
      <div className="relative flex min-h-full items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit seat ${positionLabel}`}
        className="relative z-[1310] w-full max-w-sm rounded-2xl border border-emerald-300/40 bg-white/95 p-4 shadow-2xl shadow-emerald-500/30 backdrop-blur-sm"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">
            Seat · {positionLabel}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
          >
            <span className="text-sm">✕</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[140px] flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">
              Name <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder={positionLabel}
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            />
          </div>
          <div className="w-[120px] flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Stack</label>
            <input
              type="tel"
              inputMode="decimal"
              value={stack}
              onChange={(e) => setStack(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="100"
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700">
            <input
              type="checkbox"
              checked={makeButton}
              onChange={(e) => setMakeButton(e.target.checked)}
              className="h-4 w-4 accent-emerald-600"
            />
            Dealer button here
          </label>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700">
            <input
              type="checkbox"
              checked={makeHero}
              onChange={(e) => setMakeHero(e.target.checked)}
              className="h-4 w-4 accent-emerald-600"
            />
            This is my hand (hero)
          </label>
          {canStraddle && (
            <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700">
              <input
                type="checkbox"
                checked={makeStraddle}
                onChange={(e) => setMakeStraddle(e.target.checked)}
                className="h-4 w-4 accent-emerald-600"
              />
              Posts a straddle
            </label>
          )}
        </div>

        {canStraddle && makeStraddle && (
          <div className="mt-3 flex items-center gap-2">
            <label className="text-xs font-medium text-gray-700">Straddle amount</label>
            <input
              type="tel"
              inputMode="decimal"
              value={straddleAmt}
              onChange={(e) => setStraddleAmt(e.target.value)}
              className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            />
          </div>
        )}

        {/* Hole cards */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-gray-700">Hole cards</label>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => setHole([null, null])}
                className="text-[11px] text-gray-500 underline underline-offset-2 hover:text-gray-700"
              >
                Clear
              </button>
            )}
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            {Array.from({ length: capacity }, (_, i) => hole[i] ?? null).map((c, i) =>
              c ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => handlePick(c)}
                  aria-label={`Remove ${c}`}
                  className="transition-transform hover:-translate-y-[1px] active:scale-95"
                >
                  <PlayingCard code={c} size="md" width={40} />
                </button>
              ) : (
                <div
                  key={i}
                  className="flex aspect-[3/4] w-10 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-[10px] text-gray-400"
                >
                  ?
                </div>
              )
            )}
          </div>
          <RankSuitKeypad
            used={gridUsed}
            onPick={handlePick}
            targetLabel={
              selected.length < capacity ? name.trim() || positionLabel : undefined
            }
            className="rounded-xl border border-slate-700 bg-slate-900 p-2.5"
          />
        </div>

        {allowStructural && seat.occupied && (
          <div className="mt-4 flex items-center gap-4 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={() => onMove?.()}
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-600"
            >
              ↔ Move player
            </button>
            <button
              type="button"
              onClick={() => onEmpty?.()}
              className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 underline underline-offset-2 hover:text-rose-500"
            >
              ✕ Empty seat
            </button>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="inline-flex items-center rounded-full bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/40 transition-transform duration-150 hover:-translate-y-[1px] hover:bg-emerald-500 active:translate-y-[1px]"
          >
            Done
          </button>
        </div>
      </div>
      </div>
    </div>,
    document.body
  );
};

export default SeatEditorModal;
