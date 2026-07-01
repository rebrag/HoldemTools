// src/pages/handhistory/advanced/positions.ts
// Poker position labels (relative to the button) and seat coordinates around
// the oval table.

const ORDER_FROM_BTN: Record<number, string[]> = {
  2: ["BTN", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["BTN", "SB", "BB", "UTG"],
  5: ["BTN", "SB", "BB", "UTG", "CO"],
  6: ["BTN", "SB", "BB", "UTG", "HJ", "CO"],
  7: ["BTN", "SB", "BB", "UTG", "MP", "HJ", "CO"],
  8: ["BTN", "SB", "BB", "UTG", "UTG1", "MP", "HJ", "CO"],
  9: ["BTN", "SB", "BB", "UTG", "UTG1", "MP", "LJ", "HJ", "CO"],
};

// Label for every seat, given the table size and which seat has the button.
export function positionLabels(size: number, buttonSeat: number): string[] {
  const order =
    ORDER_FROM_BTN[size] ??
    Array.from({ length: size }, (_, i) => `P${i + 1}`);
  return Array.from({ length: size }, (_, i) => {
    const offset = (((i - buttonSeat) % size) + size) % size;
    return order[offset] ?? `P${i + 1}`;
  });
}

export interface SeatCoord {
  x: number; // percent of container width
  y: number; // percent of container height
}

// Evenly distribute seats around an ellipse, seat 0 at bottom-center (hero).
// Seat index increases clockwise so action (which follows seat order) visibly
// moves clockwise, as at a real table.
export function seatCoords(size: number): SeatCoord[] {
  return Array.from({ length: size }, (_, i) => {
    const angle = (i / size) * 2 * Math.PI;
    return {
      x: 50 - 46 * Math.sin(angle),
      y: 50 + 43 * Math.cos(angle),
    };
  });
}
