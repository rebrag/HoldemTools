// src/components/HandPreview.tsx
// Visual summary of a saved hand: every known hand (hero + revealed villains,
// each labeled with its player's name) and the board, all parsed from the
// hand's rawText (its embedded replay payload is the single source of truth).
// The card-fan half of HandSummaryRow, which adds the stat stack and action
// buttons around it. Hands with no embedded replay payload (legacy/imported)
// fall back to the first text line.
import React, { useMemo } from "react";
import PlayingCard from "@/components/PlayingCard";
import { CardBack } from "@/components/PokerTable";
import { summaryFromRawText, stripReplay } from "@/pages/handhistory/create/replay";

const CARD_W = 26;
// Cards in the fan overlap, but the face's rank+suit sits centred, so the
// overlap has to stay clear of it - anything past ~a fifth of the card width
// starts eating the glyphs it exists to keep legible.
const CARD_OVERLAP = Math.round(CARD_W * 0.15);

// One card slot: a known code renders face-up; null renders a face-down back
// (unknown/unrecorded card).
const Slot: React.FC<{ code: string | null }> = ({ code }) =>
  code ? <PlayingCard code={code} size="sm" width={CARD_W} /> : <CardBack w={CARD_W} />;

// A row of cards, fanned: each card overlaps the previous with a white ring +
// rising z-index so both faces stay legible while long boards stay narrow.
const CardGroup: React.FC<{ cards: (string | null)[] }> = ({ cards }) => (
  <div className="flex">
    {cards.map((c, i) => (
      <div
        key={i}
        className={i === 0 ? "" : "rounded-md ring-1 ring-white"}
        style={{ zIndex: i, marginLeft: i === 0 ? undefined : -CARD_OVERLAP }}
      >
        <Slot code={c} />
      </div>
    ))}
  </div>
);

// Fallback preview for hands without a replay payload: first non-empty line of
// the clean text, truncated (the list's previous behavior).
function firstLine(rawText: string): string {
  const line = stripReplay(rawText).split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

const HandPreview: React.FC<{
  rawText: string;
  /** Palette for muted text: "light" (default — hand-history page) or
   *  "dark" (Solution Library, bankroll session drawer). */
  tone?: "light" | "dark";
  /** Makes the board fan a button (the Solution Library opens the hand's
   *  solved board with it). Only rendered when the preview shows a board.
   *  Don't combine with a wrapping preview-click button — nested buttons
   *  are invalid markup. */
  onBoardClick?: () => void;
}> = ({ rawText, tone = "light", onBoardClick }) => {
  const summary = useMemo(() => summaryFromRawText(rawText), [rawText]);

  const dark = tone === "dark";
  const muted = dark ? "text-slate-400" : "text-gray-500";

  if (!summary) {
    return (
      <div className={`mt-1 truncate font-mono text-[11px] ${muted}`}>{firstLine(rawText)}</div>
    );
  }

  const { players, board } = summary;
  const hero = players.find((p) => p.isHero) ?? null;
  const opponents = players.filter((p) => !p.isHero);

  const PlayerBlock: React.FC<{ cards: (string | null)[]; label: string; hero?: boolean }> = ({
    cards,
    label,
    hero: isHero,
  }) => (
    <div className="flex flex-col items-center gap-0.5">
      <CardGroup cards={cards.length ? cards : [null, null]} />
      <span
        className={
          isHero
            ? "text-[8px] font-semibold uppercase tracking-wide text-emerald-600"
            : `max-w-[72px] truncate text-[9px] font-medium ${muted}`
        }
      >
        {label}
      </span>
    </div>
  );

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {hero && <PlayerBlock cards={hero.cards} label="Hero" hero />}

      {board.length > 0 &&
        (onBoardClick ? (
          <button
            type="button"
            onClick={onBoardClick}
            aria-label="Open solution"
            title="Open this board's solution"
            className="rounded-lg transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
          >
            <CardGroup cards={board} />
          </button>
        ) : (
          <CardGroup cards={board} />
        ))}

      {opponents.map((p, i) => (
        <PlayerBlock key={i} cards={p.cards} label={p.name} />
      ))}
    </div>
  );
};

// Memoized: rawText is the only prop, so a row re-render with the same hand
// skips rebuilding the card DOM entirely.
export default React.memo(HandPreview);
