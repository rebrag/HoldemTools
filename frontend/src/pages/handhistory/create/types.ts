// src/pages/handhistory/create/types.ts
// State model for the Advanced Hand History recorder (visual hand entry).

// Hole cards for a seat. Length matches the game's hand size (2 for Hold'em,
// 4 for PLO, 5 for PLO5); empty slots are null.
export type HoleCards = (string | null)[];

// Cards dealt to each player, by game.
export function handSize(game: string): number {
  if (game === "PLO") return 4;
  if (game === "PLO5") return 5;
  return 2; // Holdem / Other
}

export interface Seat {
  occupied: boolean;
  name: string; // optional custom label ("David sunglasses kid"); falls back to position
  stack: string; // kept as string for input ergonomics; parsed when needed
  holeCards: HoleCards;
  /** Seated but not dealt in: shown at the table, excluded from the hand
   *  (no blinds, no cards, no action). Optional so old replay payloads,
   *  which predate the field, deserialize unchanged. */
  sittingOut?: boolean;
  /** Replay-only: render this seat's hole cards face-down until showdown.
   *  Lives solely in the embedded replay payload — the human-readable hand
   *  text never mentions it. Optional for the same backward-compat reason. */
  hideUntilShowdown?: boolean;
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

export function emptySeat(cards = 2): Seat {
  return {
    occupied: true,
    name: "",
    stack: "",
    holeCards: Array.from({ length: cards }, () => null),
  };
}

// A seat with no player in it (excluded from the hand). Distinct from emptySeat,
// which is an occupied-but-blank seat awaiting details.
export function blankSeat(cards = 2): Seat {
  return { ...emptySeat(cards), occupied: false };
}

// The next occupied seat clockwise from `from` (exclusive), or `from` itself
// when no other seat is occupied. Used to keep the button/hero on a live seat.
export function nextOccupiedSeat(seats: Seat[], from: number): number {
  const n = seats.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (seats[i]?.occupied) return i;
  }
  return from;
}

// A seat that is dealt into the hand: occupied and not sitting out. The engine,
// position labels, and button/hero assignment all key off this.
export function isActiveSeat(s: Seat | undefined): boolean {
  return !!s && s.occupied && !s.sittingOut;
}

// nextOccupiedSeat, but skipping sitting-out seats too. Used to keep the
// button/hero on a seat that is actually in the hand.
export function nextActiveSeat(seats: Seat[], from: number): number {
  const n = seats.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (isActiveSeat(seats[i])) return i;
  }
  return from;
}

// Grow/shrink a seat's hole cards to a new hand size, keeping assigned cards.
export function resizeHoleCards(hole: HoleCards, cards: number): HoleCards {
  const assigned = hole.filter((c): c is string => !!c);
  return Array.from({ length: cards }, (_, i) => assigned[i] ?? null);
}

// Optional overrides let callers seed the setup (e.g. from a bankroll session's
// game/blinds). The game determines each seat's hole-card count.
export type InitialStateOverrides = Partial<
  Pick<AdvancedHandState, "game" | "smallBlind" | "bigBlind" | "ante">
>;

export function createInitialState(
  tableSize = 9,
  overrides?: InitialStateOverrides
): AdvancedHandState {
  const game = overrides?.game ?? "Holdem";
  const cards = handSize(game);
  return {
    tableSize,
    game,
    smallBlind: overrides?.smallBlind ?? "0.5",
    bigBlind: overrides?.bigBlind ?? "1",
    ante: overrides?.ante ?? "0",
    straddleSeat: null,
    straddleAmount: "2",
    numBoards: 1,
    comment: "",
    buttonSeat: 0,
    heroSeat: 0,
    seats: Array.from({ length: tableSize }, () => emptySeat(cards)),
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
