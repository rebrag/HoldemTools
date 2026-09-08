// src/pages/compare/multiwaySeats.ts
//
// Turning /compare's two-seat engine config into an N-seat one.
//
// A post-processing step rather than a second builder: the tree block a
// multiway solve needs - board, pot, stacks, per-street sizings - is exactly
// what /compare already builds, and the only difference is how many seats sit
// behind it. Rewriting TreeBuilding to carry a seat count would push that
// through its other two call sites (the PioSOLVER upload path among them),
// where there is no such choice to make.
//
// The rule this encodes is the engine's own, checked again by the API at
// queue time: 2-3 seats have an exact vectorized showdown, and past three
// there is none at all - the sweep's inclusion-exclusion grows as 52^(N-2) -
// so 4+ seats must run on the sampled core, which pins opponents and costs
// O(1) per hero hand at any seat count.

export const MAX_COMPARE_SEATS = 9;
/** The largest seat count with an exact vectorized showdown. */
export const EXACT_SEAT_LIMIT = 3;

const SEAT_NAMES = ["OOP", "MID", "BTN", "S3", "S4", "S5", "S6", "S7", "S8"];

interface Player {
  seat?: string;
  stack?: number;
  range?: string;
  [k: string]: unknown;
}

/**
 * Widen `config` to `seats` players, reusing seat 1's stack and range for the
 * seats added. Returns the config unchanged at two seats, so the heads-up
 * path is untouched by construction.
 *
 * Also selects the core: past three seats it sets `algorithm.family` to
 * "sampled" with a seed, because the vectorized core has no showdown there
 * and the API refuses the combination.
 */
export const widenToSeats = (config: object, seats: number, seed = 1): object => {
  if (seats <= 2) return config;
  const c = { ...(config as Record<string, unknown>) };
  const players = ((c.players as Player[] | undefined) ?? []).slice();
  if (players.length === 0) return config;
  const template = players[players.length - 1];
  while (players.length < seats) {
    players.push({ ...template, seat: SEAT_NAMES[players.length] ?? `S${players.length}` });
  }
  players.length = seats;
  // Name them consistently: the heads-up builder says OOP/IP, and "IP" reads
  // wrong once there are three seats behind the button.
  c.players = players.map((p, i) => ({ ...p, seat: SEAT_NAMES[i] ?? `S${i}` }));

  const algorithm = { ...((c.algorithm as Record<string, unknown>) ?? {}) };
  if (seats > EXACT_SEAT_LIMIT) {
    algorithm.family = "sampled";
    algorithm.sampled = { seed, batch: 4096, lanes: 4 };
  } else {
    // Coming back down from a sampled seat count must not leave the flag on.
    delete algorithm.family;
    delete algorithm.sampled;
  }
  c.algorithm = algorithm;

  // Suit isomorphism is built and gated against a heads-up tree; the engine
  // refuses it past two seats rather than collapse something it cannot check.
  c.isomorphism = false;
  return c;
};

/** What the seat count implies, for the one line of copy that explains it. */
export const seatCoreNote = (seats: number): string =>
  seats <= 2
    ? "Heads-up: the Pio-gated path, and the only one with a second solver to compare against."
    : seats <= EXACT_SEAT_LIMIT
      ? `${seats} seats still has an exact vectorized showdown, so this solve is exact and reports exploitability. No PioSolver column - Pio cannot build an N-seat postflop tree.`
      : `${seats} seats is past the ${EXACT_SEAT_LIMIT}-seat limit of the vectorized showdown, so this runs on the sampled core: iterations are DEALS, chips still conserve exactly, and there is no exploitability number to stop on.`;
