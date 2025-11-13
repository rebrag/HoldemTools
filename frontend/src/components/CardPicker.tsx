// src/components/CardPicker.tsx
import React from "react";
import PlayingCard from "./PlayingCard";
import { RANKS } from "../lib/cards";

type Suit = "s" | "h" | "c" | "d";
const SUITS: Suit[] = ["s", "h", "c", "d"];

interface CardPickerProps {
  used: Set<string>;
  onPick: (code: string) => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  cardWidth?: number | string;   // responsive or fixed; controls total grid width
  gapPx?: number;                // grid gap in px (default 6)
  className?: string;
  /** NEW: if true, 13 cards auto-fill the full width using 1fr columns */
  fitToWidth?: boolean;
}

const CardPicker: React.FC<CardPickerProps> = ({
  used,
  onPick,
  disabled,
  size = "sm",
  cardWidth = "clamp(28px, 5.8vw, 56px)",
  gapPx = 4,
  className,
  fitToWidth = false,
}) => {
  const widthToken =
    typeof cardWidth === "number" ? `${cardWidth}px` : cardWidth;

  // 52 codes in suit-major order (spades, hearts, clubs, diamonds), 13 per row
  const codes = SUITS.flatMap((suit) => RANKS.map((r) => `${r}${suit}`));

  const gridTemplateColumns = fitToWidth
    ? "repeat(13, minmax(0, 1fr))"   // split width into 13 equal fractions
    : "repeat(13, var(--card-w))";   // old behavior: explicit card width

  return (
    <div
      className={
        className ??
        "justify-center items-center inline-grid mx-auto rounded-xl border border-gray-300 bg-slate-700/80 p-2"
      }
      style={{
        gridTemplateColumns,
        gap: `${gapPx}px`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ["--card-w" as any]: widthToken,
      }}
    >
      {codes.map((code) => {
        const isUsed = used.has(code);
        return (
          <button
            key={code}
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              if (!disabled) onPick(code);
            }}
            className={`rounded-md transition focus:outline-none
              ${isUsed ? "opacity-30" : "hover:opacity-90"}
              ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
            aria-pressed={isUsed}
            aria-label={code}
            title={code}
          >
            {/* key part: width 100% so card fills the grid cell when fitToWidth=true */}
            <PlayingCard
              code={code}
              size={size}
              width={fitToWidth ? "100%" : widthToken}
            />
          </button>
        );
      })}
    </div>
  );
};

export default CardPicker;
