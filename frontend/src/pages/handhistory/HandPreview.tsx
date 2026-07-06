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

const CardGroup: React.FC<{ cards: (string | null)[] }> = ({ cards }) => (
  <div className="flex gap-0.5">
    {cards.map((c, i) => (
      <Slot key={i} code={c} />
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

  const { heroCards, board, villainCards, villainName } = preview;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* hero */}
      <div className="flex flex-col items-center gap-0.5">
        <CardGroup cards={heroCards ?? [null, null]} />
        <span className="text-[8px] font-semibold uppercase tracking-wide text-emerald-600">
          Hero
        </span>
      </div>

      {board.length > 0 && (
        <>
          <span className="text-gray-300" aria-hidden="true">
            ·
          </span>
          <CardGroup cards={board} />
        </>
      )}

      {villainName != null && (
        <>
          <span className="text-gray-300" aria-hidden="true">
            ·
          </span>
          <div className="flex flex-col items-center gap-0.5">
            <CardGroup cards={villainCards ?? [null, null]} />
            <span className="max-w-[72px] truncate text-[9px] font-medium text-gray-500">
              {villainName}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default HandPreview;
