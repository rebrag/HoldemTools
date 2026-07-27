// src/pages/solver/SolverTableCenter.tsx
// Center slot of the solver's poker table: the community cards, dealt onto the
// felt with the same BoardRow the hand recorder and replayer use. Streets the
// session hasn't reached yet stay face-down, so the table reads as a hand in
// progress rather than a static diagram.
import React from "react";
import BoardRow from "@/components/BoardRow";

const SolverTableCenter: React.FC<{ board: string[]; cardWidth: number }> = ({
  board,
  cardWidth,
}) => (
  <BoardRow
    board={[0, 1, 2, 3, 4].map((i) => board[i] ?? null)}
    revealCount={board.length}
    live
    cardWidth={cardWidth}
    ariaLabel={`Board ${board.join(" ")}`}
  />
);

export default SolverTableCenter;
