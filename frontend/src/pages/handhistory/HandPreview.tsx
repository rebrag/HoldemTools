// src/pages/handhistory/HandPreview.tsx
// Visual preview for a saved hand, shown in the hand-history lists in place of
// the first serialized text line. Renders the hero's hole cards, the board, and
// the hole cards + name of the villain who committed the most chips. Hands with
// no embedded replay payload (legacy/imported) fall back to the text line.
import React, { useMemo } from "react";
import PlayingCard from "@/components/PlayingCard";
import { CardBack } from "@/components/PokerTable";
import {
  buildHandPreview,
  parseReplay,
  stripReplay,
  type HandPreview as HandPreviewData,
} from "./create/replay";

const CARD_W = 22;

// One card slot: a known code renders face-up; null renders a face-down back
// (unknown/unrecorded card).
const Slot: React.FC<{ code: string | null }> = ({ code }) =>
  code ? <PlayingCard code={code} size="sm" width={CARD_W} /> : <CardBack w={CARD_W} />;

// A row of cards. `overlap` fans them so a long board takes less width; each
// card keeps a white ring + rising z-index so its (left) corner index stays
// legible over the previous card.
const CardGroup: React.FC<{ cards: (string | null)[]; overlap?: boolean }> = ({
  cards,
  overlap,
}) => (
  <div className="flex">
    {cards.map((c, i) => (
      <div
        key={i}
        className={
          i === 0
            ? ""
            : overlap
            ? "-ml-[7px] rounded-md ring-1 ring-white"
            : "ml-0.5"
        }
        style={{ zIndex: i }}
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

const HandPreview: React.FC<{ rawText: string }> = ({ rawText }) => {
  const preview = useMemo<HandPreviewData | null>(() => {
    const data = parseReplay(rawText);
    return data ? buildHandPreview(data) : null;
  }, [rawText]);

  if (!preview) {
    return (
      <div className="mt-1 truncate font-mono text-[11px] text-gray-500">{firstLine(rawText)}</div>
    );
  }

  const { players, board } = preview;
  const hero = players.find((p) => p.isHero) ?? null;
  const opponents = players.filter((p) => !p.isHero);

  const PlayerBlock: React.FC<{ cards: (string | null)[]; label: string; hero?: boolean }> = ({
    cards,
    label,
    hero: isHero,
  }) => (
    <div className="flex flex-col items-center gap-0.5">
      <CardGroup cards={cards.length ? cards : [null, null]} overlap />
      <span
        className={
          isHero
            ? "text-[8px] font-semibold uppercase tracking-wide text-emerald-600"
            : "max-w-[72px] truncate text-[9px] font-medium text-gray-500"
        }
      >
        {label}
      </span>
    </div>
  );

  const Dot = () => (
    <span className="text-gray-300" aria-hidden="true">
      ·
    </span>
  );

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {hero && <PlayerBlock cards={hero.cards} label="Hero" hero />}

      {board.length > 0 && (
        <>
          {hero && <Dot />}
          <CardGroup cards={board} overlap />
        </>
      )}

      {opponents.map((p, i) => (
        <React.Fragment key={i}>
          {(hero || board.length > 0 || i > 0) && <Dot />}
          <PlayerBlock cards={p.cards} label={p.name} />
        </React.Fragment>
      ))}
    </div>
  );
};

// Memoized: rawText is the only prop, so a row re-render with the same hand
// skips rebuilding the card DOM entirely.
export default React.memo(HandPreview);
