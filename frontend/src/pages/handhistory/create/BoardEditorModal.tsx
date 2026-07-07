// src/pages/handhistory/create/BoardEditorModal.tsx
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import PlayingCard from "@/components/PlayingCard";
import RankSuitKeypad from "@/components/RankSuitKeypad";

interface Props {
  board: (string | null)[]; // length 5
  otherUsed: Set<string>; // cards assigned to seats
  onSave: (board: (string | null)[]) => void;
  onClose: () => void;
}

const SLOT_LABELS = ["Flop", "Flop", "Flop", "Turn", "River"];

const BoardEditorModal: React.FC<Props> = ({ board, otherUsed, onSave, onClose }) => {
  const [cards, setCards] = useState<string[]>(
    board.filter((c): c is string => !!c)
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

  const gridUsed = new Set<string>([...otherUsed, ...cards]);

  const handlePick = (code: string) => {
    setCards((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code);
      if (otherUsed.has(code)) return prev;
      if (prev.length >= 5) return prev;
      return [...prev, code];
    });
  };

  const save = () => {
    const padded: (string | null)[] = Array.from({ length: 5 }, (_, i) => cards[i] ?? null);
    onSave(padded);
  };

  return createPortal(
    // Centered flex box; the dialog scrolls internally when tall. Deliberately
    // avoids a `min-h-full` scroll layer + `backdrop-filter` on the dialog: that
    // combination pins iOS Safari re-blurring the animated backdrop every frame,
    // stalling the open for seconds. Opaque dialog + internal scroll keeps it
    // centered and scroll-safe without any backdrop-filter cost.
    <div className="fixed inset-0 z-[1300] flex items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-8">
      {/* Clicking the backdrop commits the board (same as "Done"), not discard. */}
      <div className="absolute inset-0 bg-black/50" onPointerDown={save} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit board"
        className="relative z-[1310] max-h-full w-full max-w-sm overflow-y-auto rounded-2xl border border-emerald-300/40 bg-white p-4 shadow-2xl shadow-emerald-500/30"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">Board</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
          >
            <span className="text-sm">✕</span>
          </button>
        </div>

        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-700">
            Flop · Turn · River
          </span>
          {cards.length > 0 && (
            <button
              type="button"
              onClick={() => setCards([])}
              className="text-[11px] text-gray-500 underline underline-offset-2 hover:text-gray-700"
            >
              Clear
            </button>
          )}
        </div>
        <div className="mb-3 flex gap-2">
          {SLOT_LABELS.map((label, i) =>
            cards[i] ? (
              <button
                key={i}
                type="button"
                onClick={() => handlePick(cards[i])}
                aria-label={`Remove ${cards[i]}`}
                className="transition-transform hover:-translate-y-[1px] active:scale-95"
              >
                <PlayingCard code={cards[i]} size="md" width={38} />
              </button>
            ) : (
              <div
                key={i}
                className="flex aspect-[3/4] w-[38px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-[8px] text-gray-400"
              >
                {label}
              </div>
            )
          )}
        </div>

        <RankSuitKeypad
          used={gridUsed}
          onPick={handlePick}
          targetLabel={cards.length < 5 ? SLOT_LABELS[cards.length] : undefined}
          className="rounded-xl border border-slate-700 bg-slate-900 p-2.5"
        />

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
    </div>,
    document.body
  );
};

export default BoardEditorModal;
