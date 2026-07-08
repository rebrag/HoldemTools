// src/pages/handhistory/create/positions.ts
// Poker position labels (relative to the button) and seat coordinates around
// the oval table.

// Seat geometry now lives in a shared module so the reusable <PokerTable>
// component can consume it without importing from this feature folder.
export { seatCoords, type SeatCoord } from "@/lib/pokerGeometry";

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

// Position label for every seat, counting only OCCUPIED seats. Positions are
// assigned by walking occupied seats clockwise from the button, so a 9-max table
// with three empty seats is labelled exactly like a 6-max game. Empty seats get
// "". `buttonSeat` must be occupied and not sitting out — callers keep that
// invariant by reassigning the button whenever its seat is emptied, vacated, or
// sat out. (Callers pass an "active" mask — occupied && !sittingOut — so
// sitting-out seats are labelled "" and skipped for blinds.)
export function positionLabelsForSeats(
  occupied: boolean[],
  buttonSeat: number
): string[] {
  const size = occupied.length;
  const occCount = occupied.filter(Boolean).length;
  const order =
    ORDER_FROM_BTN[occCount] ??
    Array.from({ length: occCount }, (_, i) => `P${i + 1}`);
  const labels: string[] = Array.from({ length: size }, () => "");
  let k = 0;
  for (let step = 0; step < size; step++) {
    const i = (buttonSeat + step) % size;
    if (!occupied[i]) continue;
    labels[i] = order[k] ?? `P${k + 1}`;
    k++;
  }
  return labels;
}

// Label for every seat, given the table size and which seat has the button.
// Convenience wrapper treating every seat as occupied.
export function positionLabels(size: number, buttonSeat: number): string[] {
  return positionLabelsForSeats(
    Array.from({ length: size }, () => true),
    buttonSeat
  );
}
