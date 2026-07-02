// src/pages/handhistory/advanced/positions.ts
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
