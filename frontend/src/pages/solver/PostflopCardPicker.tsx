// Turn/river card picker: highlighted cards have an extracted street and open
// instantly; dimmed cards are extracted on demand by the local solver.
import React from "react";
import { X } from "lucide-react";
import CardPicker from "@/components/CardPicker";
import PlayingCard from "@/components/PlayingCard";
import type { PendingStreet, StreetPicker } from "@/hooks/usePostflopSession";

export interface PostflopCardPickerProps {
  picker: StreetPicker;
  usedCards: Set<string>;
  extractedCards: Set<string>;
  pendingStreet: PendingStreet | null;
  onPick: (card: string) => void;
  onClose: () => void;
  onCancelPending: () => void;
}

const PendingFlip = ({ pending }: { pending: PendingStreet }) => {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - pending.startedAt) / 1000));
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="flex flex-col items-center gap-2 py-6">
      <div className="[perspective:400px]">
        <div className="animate-[cardflip_1.2s_ease-in-out_infinite] [transform-style:preserve-3d]">
          <PlayingCard code={pending.card} width="clamp(48px, 12vw, 72px)" />
        </div>
      </div>
      <style>{`@keyframes cardflip { 0% { transform: rotateY(0deg); } 50% { transform: rotateY(180deg); } 100% { transform: rotateY(360deg); } }`}</style>
      <div className="text-xs text-gray-200 text-center">
        {pending.resolving ? (
          <>
            Re-solving this board from scratch - the saved solution was rotated
            out of the solver&apos;s disk cache.
            <br />
            <span className="text-amber-300">This takes a few minutes.</span>
          </>
        ) : (
          <>Dealing the {pending.card} - extracting this street from the full solve…</>
        )}
      </div>
      <div className="text-[11px] tabular-nums text-gray-400">
        {mm}:{ss} elapsed
      </div>
    </div>
  );
};

const PostflopCardPicker: React.FC<PostflopCardPickerProps> = ({
  picker,
  usedCards,
  extractedCards,
  pendingStreet,
  onPick,
  onClose,
  onCancelPending,
}) => {
  const streetLabel = picker.street === "turn" ? "turn" : "river";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60"
      onMouseDown={pendingStreet ? undefined : onClose}
    >
      <div
        className="relative w-full max-w-md mx-3 rounded-2xl bg-slate-900/95 border border-emerald-500/40 shadow-2xl p-4 text-gray-100"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!pendingStreet && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-gray-300 hover:text-white border border-white/10 shadow-sm"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        )}

        <h2 className="text-base font-semibold mb-1">
          Pick the {streetLabel} card
        </h2>

        {pendingStreet ? (
          <>
            <PendingFlip pending={pendingStreet} />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onCancelPending}
                className="rounded-lg px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-gray-200 border border-white/10 shadow-sm"
              >
                Stop waiting
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-300 mb-3">
              {extractedCards.size > 0 ? (
                <>
                  Glowing cards open instantly; the rest are pulled from the full
                  solve on demand{picker.street === "river" ? " (a few seconds)" : ""}.
                </>
              ) : (
                <>Any card is pulled from the full solve on demand (a few seconds).</>
              )}
            </p>
            <div className="max-h-[320px] overflow-y-auto pb-1">
              <CardPicker
                used={usedCards}
                highlight={extractedCards}
                onPick={(code) => {
                  if (!usedCards.has(code)) onPick(code);
                }}
                size="sm"
                fitToWidth
                cardWidth="100%"
                gapPx={4}
                className="w-full inline-grid mx-auto rounded-xl border border-gray-300 bg-slate-700/80 p-2"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PostflopCardPicker;
