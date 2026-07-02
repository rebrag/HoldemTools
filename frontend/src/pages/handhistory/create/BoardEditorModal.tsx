// src/pages/handhistory/create/BoardEditorModal.tsx
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import PlayingCard from "@/components/PlayingCard";
import CardPicker from "@/components/CardPicker";

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
    <div className="fixed inset-0 z-[1300] flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="absolute inset-0 bg-black/50" onPointerDown={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit board"
        className="relative z-[1310] w-full max-w-md rounded-2xl border border-emerald-300/40 bg-white/95 p-4 shadow-2xl shadow-emerald-500/30 backdrop-blur-sm"
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
              <PlayingCard key={i} code={cards[i]} size="md" width={38} />
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

        <CardPicker
          used={gridUsed}
          onPick={handlePick}
          minCardWidth={46}
          size="md"
          gapPx={5}
          className="grid w-full rounded-xl border border-gray-300 bg-slate-700/80 p-2"
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
