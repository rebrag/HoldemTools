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

// ── Bet ring ────────────────────────────────────────────────────────────────
// Bets render on their own ellipse between the seat ring and the center
// content (board + pot row), never overlapping either. Base ellipse, then
// per-zone adjustments. A bet is normally a short single-line row (chip
// spread + label pill), so top/bottom rules only have to clear ~8-10% of
// table height; a side seat whose base position crosses the board band
// instead renders as a narrow vertical tower (see `stack`) beside the board,
// where a wide row would collide with it or with the neighbouring seats' bets.
const BET_RX = 30; // ellipse x radius, % of table width
const BET_RY = 25; // ellipse y radius, % of table height
// Bottom-arc seats (the hero and its neighbours): pin the bet into the band
// between the pot row's bottom (~69%) and the hero's hole-card top (~79%).
const BET_BOTTOM_SEAT_Y = 72;
const BET_BOTTOM_Y = 74.5;
// A bottom-arc seat away from bottom-center is a "corner" seat: a full row
// there runs into either the hero's row (toward center) or the seat's own
// cards/avatar (toward the rim), so its chips keep the row shape but the
// label drops below, and the whole block hugs the corner.
const BET_BOTTOM_CORNER_X = 15; // |x-50| beyond which a bottom seat is a corner
const BET_CORNER_PULL = 0.85; // corner x, as a fraction of the ring x toward 50
const BET_CORNER_Y = 71.5;
// Top-arc seats: keep the bet below the seat cluster's bottom edge.
const BET_TOP_MIN_Y = 25;
// The board's vertical extent (five cards centered on 50%).
const BET_BOARD_BAND = { top: 42, bottom: 58 } as const;
// Tower position for board-band side seats: partway from the seat toward the
// table center, past the board's x extent (~24-76%).
const BET_STACK_T = 0.3;

export interface BetCoord extends SeatCoord {
  /** Stack the chips as a vertical tower (narrow footprint beside the board)
   *  instead of the usual horizontal spread. */
  vertical?: boolean;
  /** Put the amount label below the chips instead of beside them. */
  labelBelow?: boolean;
}

/** Bet anchor per seat, same angular order as seatCoords(size). */
export function betCoords(size: number): BetCoord[] {
  return seatCoords(size).map((seat, i) => {
    const angle = (i / size) * 2 * Math.PI;
    const x = 50 - BET_RX * Math.sin(angle);
    const y = 50 + BET_RY * Math.cos(angle);
    if (seat.y > BET_BOTTOM_SEAT_Y) {
      if (Math.abs(seat.x - 50) > BET_BOTTOM_CORNER_X) {
        return {
          x: 50 + (x - 50) * BET_CORNER_PULL,
          y: BET_CORNER_Y,
          labelBelow: true,
        };
      }
      return { x, y: BET_BOTTOM_Y };
    }
    if (seat.y < 100 - BET_BOTTOM_SEAT_Y) {
      return { x, y: Math.max(y, BET_TOP_MIN_Y) };
    }
    // Upper-shoulder seats (base lands just above the board): lift the row so
    // its bottom edge clears the board's top instead of kissing it.
    if (y > 36 && y <= BET_BOARD_BAND.top) {
      return { x, y: 36 };
    }
    if (y > BET_BOARD_BAND.top && y < BET_BOARD_BAND.bottom) {
      return {
        x: seat.x + (50 - seat.x) * BET_STACK_T,
        y: seat.y + (50 - seat.y) * BET_STACK_T,
        vertical: true,
        labelBelow: true,
      };
    }
    return { x, y };
  });
}
