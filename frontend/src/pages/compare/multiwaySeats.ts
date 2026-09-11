// src/pages/compare/multiwaySeats.ts
//
// The seat-count rules /compare's builder lives by. The count itself is
// builder state (`BuilderState.midRanges`, one range per seat between OOP
// and the button - see builderState.seatCount), and buildEngineConfig turns
// it into the engine's players block; this file holds the two constants that
// bound it and the one line of copy that explains what a count implies.
//
// The rule encoded here is the engine's own, checked again by the API at
// queue time: 2-3 seats have an exact vectorized showdown, and past three
// there is none at all - the sweep's inclusion-exclusion grows as 52^(N-2) -
// so 4+ seats must run on the sampled core, which pins opponents and costs
// O(1) per hero hand at any seat count.

export const MAX_COMPARE_SEATS = 9;
/** The largest seat count with an exact vectorized showdown. */
export const EXACT_SEAT_LIMIT = 3;

/** What the seat count implies, for the one line of copy that explains it. */
export const seatCoreNote = (seats: number): string =>
  seats <= 2
    ? "Heads-up: the Pio-gated path, and the only one with a second solver to compare against."
    : seats <= EXACT_SEAT_LIMIT
      ? `${seats} seats still has an exact vectorized showdown, so this solve is exact and reports exploitability. No PioSolver column - Pio cannot build an N-seat postflop tree.`
      : `${seats} seats is past the ${EXACT_SEAT_LIMIT}-seat limit of the vectorized showdown, so this runs on the sampled core: iterations are DEALS, chips still conserve exactly, and there is no exploitability number to stop on.`;
