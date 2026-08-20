import React from "react";
import clsx from "clsx";

type Size = "sm" | "md" | "lg";

const SUIT_INFO = {
  h: { label: "hearts",   symbol: "♥", color: "text-red-600"   },
  d: { label: "diamonds", symbol: "♦", color: "text-blue-600"  },
  c: { label: "clubs",    symbol: "♣", color: "text-green-600" },
  s: { label: "spades",   symbol: "♠", color: "text-gray-900"  },
} as const;

function rankLabel(r: string) {
  if (r === "T") return "10";
  return r.toUpperCase();
}

function toName(code: string) {
  if (!code || code.length < 2) return "Unknown card";
  const r = rankLabel(code[0]);
  const s = (code[1] as keyof typeof SUIT_INFO) || "s";
  const suit = SUIT_INFO[s]?.label ?? "spades";
  const rankNames: Record<string, string> = {
    A: "Ace", K: "King", Q: "Queen", J: "Jack",
    "10": "Ten", "9": "Nine", "8": "Eight", "7": "Seven",
    "6": "Six", "5": "Five", "4": "Four", "3": "Three", "2": "Two",
  };
  const rn = rankNames[r] ?? r;
  return `${rn} of ${suit}`;
}

// Default widths when no explicit width is provided
const SIZE_WIDTH: Record<Size, number> = { sm: 40, md: 48, lg: 64 };

// The face is one centred rank over one centred suit, rather than the
// traditional pair of corner indices around a big centre pip. Most of the app
// is read on a phone, where a board card lands somewhere around 22-36px wide:
// at that size the classic layout spends its pixels drawing the same rank and
// suit three times over, so each copy ends up too small to read. One glyph
// pair gets the whole face instead.
//
// Sizes are fractions of the card's own rendered width, so they stay
// proportionate at any rendered size rather than only the one they were tuned
// at. A px width resolves them to px directly; a CSS-length width falls back to
// cqw container query units (see below).
//
// Anything that overlaps cards in a fan has to leave the outer ~20% of the
// width clear on each side, which is where these ratios put the edge of the
// widest glyph. `PokerTable` and `HandPreview` are the two fans today.
const RANK_RATIO = 0.66;
// "10" is the one two-glyph rank, so it gets its own (narrower) size rather
// than overflowing or forcing every other rank to shrink to match it.
const RANK_RATIO_WIDE = 0.56;
const SUIT_RATIO = 0.55;

interface PlayingCardProps {
  code: string;                 // "As", "Td", "7c"
  size?: Size;
  width?: number | string;      // px number or CSS length (e.g., "clamp(28px,6vw,56px)")
  className?: string;
}

const PlayingCard: React.FC<PlayingCardProps> = ({ code, size = "md", width, className }) => {
  const r = code?.[0]?.toUpperCase() ?? " ";
  const s = (code?.[1]?.toLowerCase() ?? "s") as keyof typeof SUIT_INFO;
  const suit = SUIT_INFO[s] ?? SUIT_INFO.s;

  // A px width (a number, or the size default) is known here, so every derived
  // length can be resolved to px up front. Only a caller-supplied CSS length -
  // a clamp() expression, or "100%" in CardPicker's fill-cell mode - is unknown
  // until layout, and those cards keep the container-query path.
  //
  // The split matters for paint cost: `container-type: inline-size` imposes
  // layout/style containment, and the hand-history list renders ~180 cards at
  // once (previews) while the tables render a dozen more. iOS Safari repaints
  // that many contained subtrees slowly enough that cards visibly blank out
  // mid-scroll, so the common case avoids containment entirely.
  const px = typeof width === "number" ? width : width == null ? SIZE_WIDTH[size] : null;
  const widthToken = px != null ? `${px}px` : (width as string);
  const len = (fraction: number) =>
    px != null ? `${fraction * px}px` : `${fraction * 100}cqw`;

  const rank = rankLabel(r);

  return (
    <div
      className={clsx(
        "relative inline-flex aspect-[3/4] items-center justify-center rounded-lg bg-white",
        "border border-gray-300 shadow-sm overflow-hidden select-none",
        className
      )}
      style={{
        width: widthToken,
        ...(px == null ? { containerType: "inline-size" } : null),
      } as React.CSSProperties}
      aria-label={toName(code)}
      role="img"
      title={toName(code)}
    >
      {/* When the width is only a CSS length these are sized in cqw (% of this
          element's own rendered width) so they scale correctly whether that
          length is a percentage (grid fill-cell mode) or a clamp() expression.
          A CSS var + calc() would not do: font-size percentages resolve
          against the parent's font-size, not this element's width. */}
      <div
        className={clsx(
          "pointer-events-none flex flex-col items-center leading-none",
          suit.color
        )}
        aria-hidden="true"
      >
        <span
          className="font-semibold"
          style={{ fontSize: len(rank.length > 1 ? RANK_RATIO_WIDE : RANK_RATIO) }}
        >
          {rank}
        </span>
        <span style={{ fontSize: len(SUIT_RATIO) }}>{suit.symbol}</span>
      </div>
    </div>
  );
};

// Memoized: props are all primitives and cards render in large batches
// (boards, previews, grids), so skipping unchanged cards is a cheap win.
export default React.memo(PlayingCard);
