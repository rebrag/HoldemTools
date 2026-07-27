// FlopPickerModal.tsx
//
// Modal for choosing the three flop cards that get sent with an uploaded
// game tree. Pure presentation: all state (cards, text input, validation)
// lives in Solver, which also gates rendering behind POSTFLOP_ENABLED and
// an active pending upload.
import type { ChangeEvent } from "react";
import CardPicker from "@/components/CardPicker";
import PlayingCard from "@/components/PlayingCard";
import { boardToCards } from "@/lib/solver/postflopNode";
import type { PostflopIndexEntry } from "@/lib/solver/postflopLibrary";

interface FlopPickerModalProps {
  flopCards: string[];
  flopInput: string;
  flopInputError: string | null;
  /** Boards already solved for the pending line - offered as instant opens. */
  solvedForPendingLine: PostflopIndexEntry[];
  usedCards: Set<string>;
  canConfirm: boolean;
  onClose: () => void;
  onPickCard: (code: string) => void;
  onRemoveCardAt: (idx: number) => void;
  onInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onRandomize: () => void;
  onConfirm: () => void;
  /** Open an already-solved board (the modal closes itself first). */
  onOpenSolvedBoard: (entry: PostflopIndexEntry) => void;
}

const FlopPickerModal = ({
  flopCards,
  flopInput,
  flopInputError,
  solvedForPendingLine,
  usedCards,
  canConfirm,
  onClose,
  onPickCard,
  onRemoveCardAt,
  onInputChange,
  onRandomize,
  onConfirm,
  onOpenSolvedBoard,
}: FlopPickerModalProps) => {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60"
      onMouseDown={onClose}
    >
      <div
        className="relative w-full max-w-md mx-3 rounded-2xl bg-slate-900/95 border border-emerald-500/40 shadow-2xl p-4 text-gray-100"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-gray-300 hover:text-white border border-white/10 shadow-sm"
          aria-label="Close"
        >
          ×
        </button>

        <h2 className="text-base font-semibold mb-1">Choose flop cards</h2>
        <p className="text-xs text-gray-300 mb-3">
          Pick exactly three cards for the flop. This board will be sent with the game tree to be saved for later.
        </p>

        {solvedForPendingLine.length > 0 && (
          <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2">
            <div className="mb-1 text-[11px] font-semibold text-emerald-200">
              Already solved for this line - open instantly:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {solvedForPendingLine.map((entry) => (
                <button
                  key={`${entry.node_name}-${entry.board}`}
                  type="button"
                  onClick={() => onOpenSolvedBoard(entry)}
                  className="inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 hover:bg-emerald-500/20 px-1.5 py-1 transition-colors"
                  title={`Open ${entry.board}`}
                >
                  {boardToCards(entry.board).map((code) => (
                    <PlayingCard key={code} code={code} width="clamp(22px, 4vw, 30px)" />
                  ))}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="flex items-center justify-center gap-2">
            {Array.from({ length: 3 }).map((_, idx) => {
              const code = flopCards[idx];
              if (code) {
                return (
                  <button
                    key={`flop-${idx}-${code}`}
                    type="button"
                    onClick={() => onRemoveCardAt(idx)}
                    className="rounded-xl focus:outline-none"
                    title={`Remove ${code}`}
                  >
                    <PlayingCard code={code} width="clamp(40px, 8vw, 64px)" />
                  </button>
                );
              }
              const isNext = idx === flopCards.length;
              return (
                <div
                  key={`flop-slot-${idx}`}
                  className={`relative inline-flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed bg-white/10
                  ${isNext ? "border-emerald-400 ring-2 ring-emerald-400/70 animate-pulse" : "border-gray-500"}`}
                  style={{ width: "clamp(40px, 8vw, 64px)" }}
                  title={isNext ? "Next flop card will go here" : "Empty flop slot"}
                >
                  <span className={`text-sm ${isNext ? "text-emerald-300" : "text-gray-300"}`}>+</span>
                  {isNext && (
                    <span className="absolute -top-1 -right-1 text-[9px] bg-emerald-600 text-white rounded px-1 shadow">
                      NEXT
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onRandomize}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 shadow"
            title="Generate a random flop"
          >
            <span>Random flop</span>
            <span aria-hidden="true">🎲</span>
          </button>
        </div>

        <div className="mb-3 px-1">
          <div className="flex items-baseline justify-between mb-1 gap-2">
            <label className="text-[11px] font-medium text-gray-200">
              Or type flop (e.g. &quot;Ah Kd 9c&quot;):
            </label>
            {flopInputError && (
              <p className="text-[10px] text-red-400 text-right">
                {flopInputError}
              </p>
            )}
          </div>

          <input
            type="text"
            value={flopInput}
            onChange={onInputChange}
            placeholder="Ah Kd 9c"
            className="w-full rounded-md bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/80"
          />
        </div>

        <div className="mt-2 max-h-[320px] overflow-y-auto pb-1">
          <CardPicker
            used={usedCards}
            onPick={onPickCard}
            size="sm"
            fitToWidth
            cardWidth="100%"
            gapPx={4}
            className="w-full inline-grid mx-auto rounded-xl border border-gray-300 bg-slate-700/80 p-2"
          />
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-gray-200 border border-white/10 shadow-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold shadow
              ${
                canConfirm
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-emerald-600/50 text-white/70 cursor-not-allowed"
              }`}
          >
            <span>Confirm flop</span>
            <span aria-hidden="true">✓</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default FlopPickerModal;
