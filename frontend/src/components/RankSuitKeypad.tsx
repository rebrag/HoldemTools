// src/components/RankSuitKeypad.tsx
// Mobile-first card selector: instead of a 52-card grid, the user taps a rank
// then a suit (either order) and the completed card is emitted via onPick. Two
// compact rows of thumb-sized targets, meant to dock at the bottom of a screen.
import React, { useEffect, useState } from "react";
import { RANKS } from "@/lib/cards";

type Suit = "s" | "h" | "c" | "d";

const SUITS: { s: Suit; glyph: string; color: string }[] = [
  { s: "s", glyph: "♠", color: "text-slate-100" },
  { s: "h", glyph: "♥", color: "text-red-400" },
  { s: "d", glyph: "♦", color: "text-blue-400" },
  { s: "c", glyph: "♣", color: "text-emerald-400" },
];

const rankLabel = (r: string) => (r === "T" ? "10" : r);

interface RankSuitKeypadProps {
  used: Set<string>;
  onPick: (code: string) => void;
  /** What the next card fills, e.g. "Seat 2" / "Board" — undefined = nothing left. */
  targetLabel?: string;
  className?: string;
}

const RankSuitKeypad: React.FC<RankSuitKeypadProps> = ({
  used,
  onPick,
  targetLabel,
  className,
}) => {
  const [rank, setRank] = useState<string | null>(null);
  const [suit, setSuit] = useState<Suit | null>(null);

  const disabled = !targetLabel;

  // Once a rank and suit are both chosen, emit the card and reset for the next.
  useEffect(() => {
    if (rank && suit) {
      const code = `${rank}${suit}`;
      if (!used.has(code)) onPick(code);
      setRank(null);
      setSuit(null);
    }
  }, [rank, suit, used, onPick]);

  // Clear any half-made selection when there's nowhere left to place a card.
  useEffect(() => {
    if (disabled) {
      setRank(null);
      setSuit(null);
    }
  }, [disabled]);

  const rankUnavailable = (r: string) =>
    suit ? used.has(`${r}${suit}`) : SUITS.every((su) => used.has(`${r}${su.s}`));
  const suitUnavailable = (s: Suit) => (rank ? used.has(`${rank}${s}`) : false);

  return (
    <div className={className}>
      {/* Context line: what we're filling + progress of the current tap */}
      <div className="mb-2 flex items-center justify-center gap-1.5 text-[11px] font-semibold">
        {disabled ? (
          <span className="text-slate-500">All cards set — tap a card to remove it</span>
        ) : (
          <>
            <span className="text-slate-400">Adding to</span>
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-300 ring-1 ring-emerald-500/30">
              {targetLabel}
            </span>
            {rank && (
              <span className="text-slate-300">
                · <b className="text-emerald-300">{rankLabel(rank)}</b> — pick a suit
              </span>
            )}
          </>
        )}
      </div>

      {/* Ranks — two thumb-friendly rows (7 + 6) */}
      <div className="mb-2 grid grid-cols-7 gap-1.5">
        {RANKS.map((r) => {
          const off = disabled || rankUnavailable(r);
          const on = rank === r;
          return (
            <button
              key={r}
              type="button"
              disabled={off}
              onClick={() => setRank((cur) => (cur === r ? null : r))}
              className={`rounded-md py-2.5 text-sm font-bold tabular-nums transition ${
                on
                  ? "bg-emerald-500 text-emerald-950 shadow-glow"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700 active:scale-95"
              } ${off ? "opacity-30" : ""}`}
              aria-pressed={on}
            >
              {rankLabel(r)}
            </button>
          );
        })}
      </div>

      {/* Suits — four large targets */}
      <div className="grid grid-cols-4 gap-2">
        {SUITS.map(({ s, glyph, color }) => {
          const off = disabled || suitUnavailable(s);
          const on = suit === s;
          return (
            <button
              key={s}
              type="button"
              disabled={off}
              onClick={() => setSuit((cur) => (cur === s ? null : s))}
              className={`rounded-lg bg-slate-800 py-2.5 text-2xl font-bold leading-none transition hover:bg-slate-700 active:scale-95 ${color} ${
                on ? "ring-2 ring-emerald-400" : ""
              } ${off ? "opacity-30" : ""}`}
              aria-label={`suit ${glyph}`}
              aria-pressed={on}
            >
              {glyph}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default RankSuitKeypad;
