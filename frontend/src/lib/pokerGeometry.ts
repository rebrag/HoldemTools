// Shared poker-table geometry: seat coordinates around the oval felt.
// Used by the reusable <PokerTable> component (hand-history recorder and the
// solver's single-range view).

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
