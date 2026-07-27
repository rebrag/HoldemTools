// src/components/BoardRow.tsx
// The five community cards as they sit on the felt: face-up once dealt,
// face-down while the street is still to come. Shared by the hand recorder,
// the hand replayer, and the solver's postflop table so every surface deals
// the board the same way.
import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import PlayingCard from "@/components/PlayingCard";
import { CardBack } from "@/components/PokerTable";

export interface BoardRowProps {
  /** Up to five card codes; empty / null slots render face-down. */
  board: (string | null)[];
  /** How many slots are dealt. Ignored when `live` is false. */
  revealCount: number;
  /** True while a hand is running: undealt slots stay face-down. False shows
   *  every filled slot face-up (the recorder's setup phase). */
  live: boolean;
  /** Rendered card width in px; the gap scales with it. */
  cardWidth?: number;
  /** When set the row becomes a button (the recorder's board editor). */
  onEdit?: () => void;
  ariaLabel: string;
}

/**
 * A card is re-keyed on the face it currently shows, so dealing one remounts
 * it and plays the deal-in flip; scrubbing a replay backwards re-hides it the
 * same way.
 */
const BoardRow: React.FC<BoardRowProps> = ({
  board,
  revealCount,
  live,
  cardWidth = 36,
  onEdit,
  ariaLabel,
}) => {
  const reduce = useReducedMotion();
  const gap = Math.max(2, Math.round(cardWidth * 0.11));

  const cards = [0, 1, 2, 3, 4].map((i) => {
    const code = board[i];
    const faceUp = (!live || i < revealCount) && !!code;
    return (
      <motion.div
        key={faceUp ? `${i}-${code}` : `${i}-back`}
        className="flex"
        style={{ transformPerspective: 600 }}
        initial={reduce ? false : { opacity: 0, y: -8, rotateY: 90, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, rotateY: 0, scale: 1 }}
        transition={{
          type: "spring",
          stiffness: 320,
          damping: 24,
          delay: reduce ? 0 : i * 0.04,
        }}
      >
        {faceUp ? (
          <PlayingCard code={code!} size="sm" width={cardWidth} />
        ) : (
          <CardBack w={cardWidth} />
        )}
      </motion.div>
    );
  });

  if (!onEdit) {
    return (
      <div className="flex" style={{ gap }} aria-label={ariaLabel}>
        {cards}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex"
      style={{ gap }}
      aria-label={ariaLabel}
    >
      {cards}
    </button>
  );
};

export default BoardRow;
