// src/components/HandPreview.tsx
// Visual summary of a saved hand: every known hand (hero + revealed villains,
// each labeled with its player's name) and the board, all parsed from the
// hand's rawText (its embedded replay payload is the single source of truth).
// The card-fan half of HandSummaryRow, which adds the stat stack and action
// buttons around it. Hands with no embedded replay payload (legacy/imported)
// fall back to the first text line.
import React, { useMemo } from "react";
import PlayingCard from "@/components/PlayingCard";
import PlayerAvatar from "@/components/PlayerAvatar";
import { CardBack } from "@/components/PokerTable";
import { usePlayers } from "@/hooks/usePlayers";
import { summaryFromRawText, stripReplay } from "@/pages/handhistory/create/replay";

const CARD_W = 26;
// Cards in the fan overlap tightly to keep long rows (boards, PLO hands)
// narrow in the list; the centred rank+suit stays just clear of the tuck.
const CARD_OVERLAP = Math.round(CARD_W * 0.3);

// One card slot: a known code renders face-up; null renders a face-down back
// (unknown/unrecorded card).
const Slot: React.FC<{ code: string | null }> = ({ code }) =>
  code ? <PlayingCard code={code} size="sm" width={CARD_W} /> : <CardBack w={CARD_W} />;

// A row of cards, fanned: each card overlaps the previous with a rising
// z-index so both faces stay legible while long boards stay narrow. The
// cards' own borders separate them — no extra ring, which read as a stray
// white outline on the dark list background.
const CardGroup: React.FC<{ cards: (string | null)[] }> = ({ cards }) => (
  <div className="flex">
    {cards.map((c, i) => (
      <div
        key={i}
        className="relative"
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
  /** Makes each linked player's identity chip open that player's editor.
   *  Takes the id rather than a bound closure so every hop from the host page
   *  down to here forwards ONE referentially stable function — this component
   *  is memoized on its props, and an inline arrow anywhere in the chain
   *  rebuilds every card fan on every parent render. */
  onPlayerClick?: (playerId: string) => void;
}> = ({ rawText, tone = "light", onBoardClick, onPlayerClick }) => {
  const summary = useMemo(() => summaryFromRawText(rawText), [rawText]);
  // Consumed here rather than passed as a prop so the memo contract stays
  // rawText+tone: the roster loading re-renders rows once via the shared
  // store, not through a new prop identity on every parent render.
  const { byId: playersById } = usePlayers();

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

  const PlayerBlock: React.FC<{
    cards: (string | null)[];
    label: string;
    hero?: boolean;
    playerId?: string;
  }> = ({ cards, label, hero: isHero, playerId }) => {
    // The 14px avatar is far too small to tap, so the whole chip (avatar +
    // name) is the target. A span with role="button" rather than a real
    // button: the host often wraps this preview in one, and nested
    // interactive elements are invalid markup (same trick as the dealer badge
    // in PokerTableSeat). The negative margins exactly cancel the padding, so
    // the hit box grows without moving anything in the fan row.
    const live = !!playerId && !!onPlayerClick;
    const open = (e: React.SyntheticEvent) => {
      e.stopPropagation();
      onPlayerClick!(playerId!);
    };

    return (
      <div className="flex flex-col items-center gap-0.5">
        <CardGroup cards={cards.length ? cards : [null, null]} />
        <span
          {...(live
            ? {
                role: "button",
                tabIndex: 0,
                title: `Edit ${label}`,
                "aria-label": `Edit ${label}`,
                onClick: open,
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open(e);
                  }
                },
              }
            : {})}
          className={`flex max-w-[80px] items-center gap-1 ${
            live
              ? `-mx-1 -my-1.5 cursor-pointer touch-manipulation rounded-full px-1 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                  dark ? "hover:bg-white/10" : "hover:bg-emerald-100/70"
                }`
              : ""
          }`}
        >
          {/* Tiny identity chip for linked players; sized to the label's
              line-height so the fan row's rhythm is untouched. */}
          {playerId && (
            <PlayerAvatar
              player={playersById.get(playerId)}
              name={label}
              size="xs"
              className={`!h-3.5 !w-3.5 ${
                live ? "transition hover:ring-2 hover:ring-emerald-400/60" : ""
              }`}
            />
          )}
          <span
            className={
              isHero
                ? "text-[8px] font-semibold uppercase tracking-wide text-emerald-600"
                : `min-w-0 truncate text-[9px] font-medium ${muted}`
            }
          >
            {label}
          </span>
        </span>
      </div>
    );
  };

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {hero && (
        <PlayerBlock cards={hero.cards} label="Hero" hero playerId={hero.playerId} />
      )}

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
        <PlayerBlock key={i} cards={p.cards} label={p.name} playerId={p.playerId} />
      ))}
    </div>
  );
};

// Memoized: rawText is the only prop, so a row re-render with the same hand
// skips rebuilding the card DOM entirely.
export default React.memo(HandPreview);
