// src/pages/handhistory/create/BoardEditorModal.tsx
// Board card entry for the recorder, in the app's shared overlay shell: a
// bottom sheet under 640px (thumb-reachable, which matters most when this
// opens itself mid-hand to ask for the turn or the river) and a centered modal
// above it.
//
// Dismissing COMMITS. Every pick is already visible in the slot row above the
// keypad, so there is nothing hidden to discard, and the auto-open flow makes
// silent discard actively harmful: a user who taps the turn card and then taps
// the backdrop must keep that card. "Cancel" stays as the explicit way to back
// out with the board untouched.
//
// The old hand-rolled shell avoided `backdrop-filter` on the dialog because a
// `min-h-full` scroll layer plus a blurred dialog pinned iOS Safari re-blurring
// the animated backdrop every frame. ResponsiveDrawer doesn't have that layer -
// it sizes the panel with `max-h-[92vh]` inside an `absolute inset-0` flex box -
// and the same shell is already used elsewhere on this page (QuickSetupDrawer).
import React, { useEffect, useId, useState } from "react";
import PlayingCard from "@/components/PlayingCard";
import RankSuitKeypad from "@/components/RankSuitKeypad";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";

interface Props {
  /** Mount permanently and toggle this, so the sheet's exit animation plays. */
  open: boolean;
  board: (string | null)[]; // length 5
  otherUsed: Set<string>; // cards assigned to seats
  /** Heading — run-it-twice hands mount two of these. */
  title?: string;
  onSave: (board: (string | null)[]) => void;
  onClose: () => void;
}

const SLOT_LABELS = ["Flop", "Flop", "Flop", "Turn", "River"];

const BoardEditorModal: React.FC<Props> = ({
  open,
  board,
  otherUsed,
  title = "Board",
  onSave,
  onClose,
}) => {
  // Both boards stay mounted, so the heading id has to be per-instance.
  const titleId = useId();
  const [cards, setCards] = useState<string[]>(() =>
    board.filter((c): c is string => !!c)
  );

  // Re-seed from the live board each time the sheet opens. The component stays
  // mounted for its exit animation, so the initializer only ever runs once.
  useEffect(() => {
    if (open) setCards(board.filter((c): c is string => !!c));
    // `board` is intentionally not a dependency: re-syncing while the sheet is
    // open would fight the user's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const gridUsed = new Set<string>([...otherUsed, ...cards]);
  // The next empty slot is what the keypad fills, so a board with a gap earlier
  // than the street being asked about gets caught up first.
  const target = cards.length < 5 ? SLOT_LABELS[cards.length] : undefined;

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

  return (
    <ResponsiveDrawer
      open={open}
      onClose={save}
      scrollMode="custom"
      desktopMaxWidthClassName="sm:max-w-sm"
      /* Matches the stacking the hand-rolled portal had, so the orientation
         gate (which documents itself as sitting above it) still wins. */
      zClassName="z-[1300]"
      showCloseButton={false}
      ariaLabelledBy={titleId}
    >
      <>
        <div className="px-5 pt-2 sm:pt-5 pb-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id={titleId} className="text-lg font-bold tracking-tight text-white">
              {title}
            </h2>
            {cards.length > 0 && (
              <button
                type="button"
                onClick={() => setCards([])}
                className="text-[11px] text-slate-400 underline underline-offset-2 transition-colors hover:text-slate-200"
              >
                Clear
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {target ? `Tap the ${target.toLowerCase()} card.` : "Board complete."}{" "}
            Tap a dealt card to take it back.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-3">
          <div className="mb-3 flex gap-2">
            {SLOT_LABELS.map((label, i) =>
              cards[i] ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => handlePick(cards[i])}
                  aria-label={`Remove ${cards[i]}`}
                  className="rounded-lg transition-transform hover:-translate-y-[1px] active:scale-95"
                >
                  <PlayingCard code={cards[i]} size="md" width={38} />
                </button>
              ) : (
                <div
                  key={i}
                  className={`flex aspect-[3/4] w-[38px] flex-col items-center justify-center rounded-lg border border-dashed text-[8px] transition-colors ${
                    // The slot the keypad is about to fill, so an auto-opened
                    // sheet shows at a glance which card it is asking for.
                    i === cards.length
                      ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
                      : "border-white/20 bg-white/5 text-slate-500"
                  }`}
                >
                  {label}
                </div>
              )
            )}
          </div>

          <RankSuitKeypad
            used={gridUsed}
            onPick={handlePick}
            targetLabel={target}
            className="rounded-xl border border-slate-700 bg-slate-900 p-2.5"
          />
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
            onClick={save}
            className="flex-1 cursor-pointer rounded-xl bg-accent py-2.5 text-sm font-semibold text-on-accent transition-all hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            Done
          </button>
        </div>
      </>
    </ResponsiveDrawer>
  );
};

export default BoardEditorModal;
