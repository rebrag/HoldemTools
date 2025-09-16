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

// Font-size ratios relative to --card-w (card width)
const RATIOS: Record<Size, { center: number; cornerRank: number; cornerSuit: number }> = {
  sm: { center: 0.42, cornerRank: 0.28, cornerSuit: 0.22 }, // smaller center on small
  md: { center: 0.50, cornerRank: 0.30, cornerSuit: 0.24 },
  lg: { center: 0.56, cornerRank: 0.34, cornerSuit: 0.26 },
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

  const widthToken = typeof width === "number" ? `${width}px` : width || `${SIZE_WIDTH[size]}px`;
  const ratio = RATIOS[size];

  return (
    <div
      className={clsx(
        "relative inline-flex aspect-[3/4] items-center justify-center rounded-lg bg-white",
        "border border-gray-300 shadow-sm overflow-hidden select-none",
        className
      )}
      style={{
        width: widthToken,
        ["--card-w"]: widthToken,
      } as React.CSSProperties}
      aria-label={toName(code)}
      role="img"
      title={toName(code)}
    >
      {/* big center suit */}
      <div
        className={clsx("pointer-events-none", suit.color)}
        aria-hidden="true"
        style={{ fontSize: `calc(var(--card-w) * ${ratio.center})` }}
      >
        {suit.symbol}
      </div>

      {/* corner indices */}
      <div className="absolute top-1 left-1 flex flex-col items-center leading-none">
        <span className={clsx("font-semibold", suit.color)}
              style={{ fontSize: `calc(var(--card-w) * ${ratio.cornerRank})` }}>
          {rankLabel(r)}
        </span>
        <span className={clsx(suit.color)}
              style={{ fontSize: `calc(var(--card-w) * ${ratio.cornerSuit})` }}>
          {suit.symbol}
        </span>
      </div>
      <div className="absolute bottom-1 right-1 rotate-180 flex flex-col items-center leading-none">
        <span className={clsx("font-semibold", suit.color)}
              style={{ fontSize: `calc(var(--card-w) * ${ratio.cornerRank})` }}>
          {rankLabel(r)}
        </span>
        <span className={clsx(suit.color)}
              style={{ fontSize: `calc(var(--card-w) * ${ratio.cornerSuit})` }}>
          {suit.symbol}
        </span>
      </div>
    </div>
  );
};

export default PlayingCard;
