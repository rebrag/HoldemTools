import React from "react";
import clsx from "clsx";

type Size = "sm" | "md" | "lg";

const SUIT_INFO = {
  h: { label: "hearts",   symbol: "♥", color: "text-red-600"   },
  d: { label: "diamonds", symbol: "♦", color: "text-blue-600"  },
  c: { label: "clubs",    symbol: "♣", color: "text-green-900" },
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

// Font-size ratios relative to the card's own rendered width. All corner/center
// sizing and offsets are expressed as fractions of the card width so they stay
// proportionate at any rendered size, not just the size the ratios were tuned
// at. A px width resolves them to px directly; a CSS-length width falls back to
// cqw container query units (see below).
const RATIOS: Record<
  Size,
  { center: number; cornerRank: number; cornerSuit: number; cornerInset: number }
> = {
  sm: { center: 0.62, cornerRank: 0.4, cornerSuit: 0.3, cornerInset: 0.07 },
  md: { center: 0.58, cornerRank: 0.36, cornerSuit: 0.27, cornerInset: 0.07 },
  lg: { center: 0.62, cornerRank: 0.4, cornerSuit: 0.3, cornerInset: 0.07 },
};

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
  const ratio = RATIOS[size];
  const len = (fraction: number) =>
    px != null ? `${fraction * px}px` : `${fraction * 100}cqw`;

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
      {/* big center suit — when the width is only a CSS length this is sized in
          cqw (% of this element's own rendered width) so it scales correctly
          whether that length is a percentage (grid fill-cell mode) or a clamp()
          expression. A CSS var + calc() would not do: font-size percentages
          resolve against the parent's font-size, not this element's width. */}
      <div
        className={clsx("pointer-events-none", suit.color)}
        aria-hidden="true"
        style={{ fontSize: len(ratio.center) }}
      >
        {suit.symbol}
      </div>

      {/* corner indices — offset scales with card width so it stays
          proportionate whether the card is 30px or 130px wide */}
      <div
        className="absolute flex flex-col items-center leading-none"
        style={{ top: len(ratio.cornerInset), left: len(ratio.cornerInset) }}
      >
        <span className={clsx("font-semibold", suit.color)}
              style={{ fontSize: len(ratio.cornerRank) }}>
          {rankLabel(r)}
        </span>
        <span className={clsx(suit.color)}
              style={{ fontSize: len(ratio.cornerSuit) }}>
          {suit.symbol}
        </span>
      </div>
      <div
        className="absolute flex rotate-180 flex-col items-center leading-none"
        style={{ bottom: len(ratio.cornerInset), right: len(ratio.cornerInset) }}
      >
        <span className={clsx("font-semibold", suit.color)}
              style={{ fontSize: len(ratio.cornerRank) }}>
          {rankLabel(r)}
        </span>
        <span className={clsx(suit.color)}
              style={{ fontSize: len(ratio.cornerSuit) }}>
          {suit.symbol}
        </span>
      </div>
    </div>
  );
};

// Memoized: props are all primitives and cards render in large batches
// (boards, previews, grids), so skipping unchanged cards is a cheap win.
export default React.memo(PlayingCard);
