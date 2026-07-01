// src/pages/handhistory/advanced/types.ts
// State model for the Advanced Hand History recorder (visual hand entry).

export type HoleCards = [string | null, string | null];

export interface Seat {
  occupied: boolean;
  name: string; // optional custom label ("David sunglasses kid"); falls back to position
  stack: string; // kept as string for input ergonomics; parsed when needed
  holeCards: HoleCards;
}

export interface AdvancedHandState {
  tableSize: number; // 2..9
  game: string; // "Holdem" | "PLO" | ...
  smallBlind: string;
  bigBlind: string;
  ante: string; // per-player ante (0 = none)
  straddleSeat: number | null; // seat index posting a straddle, or null
  straddleAmount: string;
  numBoards: 1 | 2; // 2 = run it twice
  comment: string;
  buttonSeat: number; // seat index holding the dealer button
  heroSeat: number; // "Dealt to" — the recorder's own seat
  seats: Seat[];
  board: (string | null)[]; // length 5 (flop, flop, flop, turn, river); nulls allowed
  board2: (string | null)[]; // second board, used when numBoards === 2
}

export function emptySeat(): Seat {
  return { occupied: true, name: "", stack: "", holeCards: [null, null] };
}

export function createInitialState(tableSize = 9): AdvancedHandState {
  return {
    tableSize,
    game: "Holdem",
    smallBlind: "0.5",
    bigBlind: "1",
    ante: "0",
    straddleSeat: null,
    straddleAmount: "2",
    numBoards: 1,
    comment: "",
    buttonSeat: 0,
    heroSeat: 0,
    seats: Array.from({ length: tableSize }, emptySeat),
    board: [null, null, null, null, null],
    board2: [null, null, null, null, null],
  };
}

// Resize the seat array, preserving existing seats where possible.
export function resizeSeats(seats: Seat[], size: number): Seat[] {
  return Array.from({ length: size }, (_, i) => seats[i] ?? emptySeat());
}

// All card codes currently assigned (hole cards + board(s)), optionally excluding some.
export function usedCards(
  state: AdvancedHandState,
  exclude?: (string | null)[]
): Set<string> {
  const used = new Set<string>();
  for (const s of state.seats) {
    for (const c of s.holeCards) if (c) used.add(c);
  }
  for (const c of state.board) if (c) used.add(c);
  if (state.numBoards === 2) {
    for (const c of state.board2) if (c) used.add(c);
  }
  if (exclude) for (const c of exclude) if (c) used.delete(c);
  return used;
}
