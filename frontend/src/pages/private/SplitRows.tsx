// src/pages/private/SplitRows.tsx
// One split rendered as its three labeled card rows. Shared by the advisor
// tabs and the advanced dealer.
import React from "react";
import PlayingCard from "@/components/PlayingCard";

export interface SplitLike {
  top: string[];
  middle: string[];
  bottom: string[];
}

const SplitRows: React.FC<{ split: SplitLike; cardWidth: number }> = ({ split, cardWidth }) => {
  const rows: { label: string; cards: string[] }[] = [
    { label: "Top", cards: split.top },
    { label: "Middle", cards: split.middle },
    { label: "Bottom", cards: split.bottom },
  ];
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-emerald-100/60">{r.label}</span>
          <span className="flex gap-1">
            {r.cards.map((c) => (
              <PlayingCard key={c} code={c} width={cardWidth} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
};

export default SplitRows;
