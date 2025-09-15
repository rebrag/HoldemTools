import React from "react";
import PlayingCard from "./PlayingCard";
import { tokenize, sortCardsDesc } from "../lib/cards";

interface CardRowProps {
  cardsStr: string;          // e.g. "As 7d Ac Kh"
  size?: "sm" | "md" | "lg";
  ariaLabel?: string;
}

const CardRow: React.FC<CardRowProps> = ({ cardsStr, size = "md", ariaLabel }) => {
  const codes = sortCardsDesc(tokenize(cardsStr));
  if (codes.length === 0) {
    return <em className="text-gray-400">—</em>;
  }
  return (
    <div className="flex items-center gap-1.5" aria-label={ariaLabel}>
      {codes.map((c) => (
        <PlayingCard key={c} code={c} size={size} />
      ))}
    </div>
  );
};

export default CardRow;
