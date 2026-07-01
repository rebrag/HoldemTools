import { JSX, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * The Equity tool's internals: two hands face off, a board runs out, and the
 * equity bar + percentages animate to the result. Matchups cycle on a timer so
 * the preview always feels alive. Equities are representative, precomputed
 * values (not solved live) for a fast, dependency-free preview.
 */

type Suit = "s" | "h" | "d" | "c";
interface Card {
  rank: string;
  suit: Suit;
}
interface Matchup {
  a: Card[];
  b: Card[];
  board: Card[];
  equityA: number; // 0..100
  label: string;
}

const C = (rank: string, suit: Suit): Card => ({ rank, suit });

const MATCHUPS: Matchup[] = [
  {
    a: [C("A", "s"), C("K", "s")],
    b: [C("Q", "h"), C("Q", "d")],
    board: [C("A", "d"), C("7", "s"), C("2", "c")],
    equityA: 71,
    label: "Top pair vs overpair",
  },
  {
    a: [C("A", "h"), C("A", "c")],
    b: [C("K", "s"), C("K", "d")],
    board: [],
    equityA: 82,
    label: "Aces vs Kings, preflop",
  },
  {
    a: [C("7", "h"), C("6", "h")],
    b: [C("A", "d"), C("K", "c")],
    board: [C("8", "h"), C("5", "c"), C("J", "h")],
    equityA: 58,
    label: "Combo draw vs overcards",
  },
  {
    a: [C("J", "s"), C("J", "d")],
    b: [C("A", "c"), C("Q", "h")],
    board: [],
    equityA: 56,
    label: "Pair vs two overcards",
  },
];

const SUIT_GLYPH: Record<Suit, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const isRed = (s: Suit) => s === "h" || s === "d";

export function EquityDuelPreview({ className }: { className?: string }): JSX.Element {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const m = MATCHUPS[idx];

  useEffect(() => {
    if (reduce) return;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % MATCHUPS.length), 4200);
    return () => window.clearInterval(t);
  }, [reduce]);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-sky-300/90">
          Equity engine
        </span>
        <AnimatePresence mode="wait">
          <motion.span
            key={m.label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-[11px] text-slate-400"
          >
            {m.label}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between gap-3">
        <HandDisplay cards={m.a} align="start" keyId={`a${idx}`} />
        <div className="shrink-0 text-center">
          <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">vs</div>
        </div>
        <HandDisplay cards={m.b} align="end" keyId={`b${idx}`} />
      </div>

      {/* Board */}
      <div className="flex items-center justify-center gap-1.5">
        {m.board.length === 0 ? (
          <span className="font-mono text-[11px] text-slate-500">Preflop all-in</span>
        ) : (
          m.board.map((card, i) => (
            <PlayingCard key={`${idx}-b-${i}`} card={card} small delay={i * 0.08} />
          ))
        )}
      </div>

      {/* Equity bar */}
      <div>
        <div className="mb-1.5 flex items-center justify-between font-mono text-xs">
          <motion.span
            key={`ea${idx}`}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: 1 }}
            className="font-semibold text-sky-300"
          >
            {m.equityA}%
          </motion.span>
          <motion.span
            key={`eb${idx}`}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: 1 }}
            className="font-semibold text-slate-300"
          >
            {100 - m.equityA}%
          </motion.span>
        </div>
        <div className="relative h-3 overflow-hidden rounded-full bg-slate-700/60 ring-1 ring-white/10">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-400 to-cyan-300"
            initial={{ width: "50%" }}
            animate={{ width: `${m.equityA}%` }}
            transition={
              reduce ? { duration: 0 } : { duration: 0.9, ease: [0.22, 1, 0.36, 1] }
            }
          />
          <div className="absolute inset-0 rounded-full shadow-[inset_0_0_8px_rgba(0,0,0,0.4)]" />
        </div>
      </div>
    </div>
  );
}

function HandDisplay({
  cards,
  align,
  keyId,
}: {
  cards: Card[];
  align: "start" | "end";
  keyId: string;
}): JSX.Element {
  return (
    <div className={cn("flex gap-1.5", align === "end" && "flex-row-reverse")}>
      {cards.map((card, i) => (
        <PlayingCard key={`${keyId}-${i}`} card={card} delay={i * 0.06} />
      ))}
    </div>
  );
}

function PlayingCard({
  card,
  small = false,
  delay = 0,
}: {
  card: Card;
  small?: boolean;
  delay?: number;
}): JSX.Element {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, rotateY: 70 }}
      animate={{ opacity: 1, y: 0, rotateY: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      style={{ transformPerspective: 500 }}
      className={cn(
        "flex flex-col items-center justify-center rounded-md bg-white font-bold shadow-lg ring-1 ring-black/10",
        small ? "h-8 w-6 text-[11px]" : "h-11 w-8 text-sm",
        isRed(card.suit) ? "text-rose-600" : "text-slate-900",
      )}
    >
      <span className="leading-none">{card.rank}</span>
      <span className="leading-none">{SUIT_GLYPH[card.suit]}</span>
    </motion.div>
  );
}
