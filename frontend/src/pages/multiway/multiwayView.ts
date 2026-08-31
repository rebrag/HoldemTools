// src/pages/multiway/multiwayView.ts
//
// State and config for the multiway preflop tree builder.
//
// Deliberately a SIBLING of TreeBuildingView rather than an extension of it.
// That type is structurally heads-up (`oop` / `ip` everywhere) and is pinned
// byte-for-byte against PioViewer's clipboard format by an E2E test through
// lib/solver/treeParamsView.ts; widening it to N seats would put that
// invariant at risk for no gain, since a multiway spot cannot be expressed in
// PioViewer's format anyway. The two builders share the engine's JSON config
// and nothing else.

/** Seat labels clockwise from the small blind, per table size. Heads-up is
 *  the usual exception: the button IS the small blind. */
const SEAT_NAMES: Record<number, string[]> = {
  2: ["BTN", "BB"],
  3: ["SB", "BB", "BTN"],
  4: ["SB", "BB", "CO", "BTN"],
  5: ["SB", "BB", "UTG", "CO", "BTN"],
  6: ["SB", "BB", "UTG", "HJ", "CO", "BTN"],
  7: ["SB", "BB", "UTG", "UTG1", "HJ", "CO", "BTN"],
  8: ["SB", "BB", "UTG", "UTG1", "LJ", "HJ", "CO", "BTN"],
  9: ["SB", "BB", "UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN"],
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 9;

/** Which seat posts which blind, given where the button sits. Mirrors
 *  engine/src/game/preflop_tree.cpp exactly, heads-up exception included -
 *  the engine also emits these into artifact metadata so nothing downstream
 *  has to re-derive them. */
export const blindSeats = (players: number, button: number) => ({
  sb: players === 2 ? button : (button + 1) % players,
  bb: players === 2 ? (button + 1) % players : (button + 2) % players,
});

/** Position label for each seat index. */
export const seatLabels = (players: number, button: number): string[] => {
  const names = SEAT_NAMES[players] ?? SEAT_NAMES[MAX_PLAYERS];
  const { sb } = blindSeats(players, button);
  const out: string[] = [];
  for (let i = 0; i < players; i += 1) {
    // names[] is written clockwise from the small blind.
    out[(sb + i) % players] = names[i] ?? `P${i}`;
  }
  return out;
};

/** Order in which seats act preflop: the seat after the big blind first. */
export const actionOrder = (players: number, button: number): number[] => {
  const { bb } = blindSeats(players, button);
  return Array.from({ length: players }, (_, i) => (bb + 1 + i) % players);
};

export type GameKind = "holdem" | "omaha" | "omaha_hi_lo";
export type LimitKind = "nl" | "pl";
export type StreetKind = "preflop" | "flop" | "turn" | "river";

export interface MultiwayView {
  /* ---- New tree (the first dialog) ---- */
  game: GameKind;
  limit: LimitKind;
  street: StreetKind;
  players: number;

  /* ---- Stacks and blinds (the second dialog) ----
   * Money fields are STRINGS, raw as typed, for the same reason
   * TreeBuildingView's are: parsing on every keystroke fights the user over
   * a half-typed "1." and a cleared field. */
  smallBlind: string;
  bigBlind: string;
  ante: string;
  dead: string;
  button: number;
  stacks: string[];

  /* ---- Team (hand-sharing collusion research) ----
   * Seat indices sharing hole cards and maximizing SUMMED EV: empty or
   * exactly two. Awareness picks the game: "aware" = opponents adapt to
   * the team (a new equilibrium); "unaware" = opponents play the frozen
   * no-team baseline and the team best-responds jointly. */
  teamSeats: number[];
  awareness: "aware" | "unaware";

  /* ---- Solve settings ---- */
  boardSampleIter: string;
  boardSamplePair: string;
  seed: string;
  accuracy: string; // target exploitability, chips
  maxIterations: string;
}

/** The short-term target spot: 4-way, blinds 1/2, 20 chips (10bb) each. */
export const DEFAULT_VIEW: MultiwayView = {
  game: "holdem",
  limit: "nl",
  street: "preflop",
  players: 4,
  smallBlind: "1",
  bigBlind: "2",
  ante: "0",
  dead: "0",
  button: 3,
  stacks: ["20", "20", "20", "20"],
  teamSeats: [],
  awareness: "unaware",
  boardSampleIter: "500",
  boardSamplePair: "20000",
  seed: "20260830",
  accuracy: "0.004",
  // High enough for the sampled family (one deal per iteration); the
  // vectorized 2-3 seat solves stop on the accuracy target long before it.
  maxIterations: "200000",
};

/** Grow or shrink the per-seat arrays when the player count changes, keeping
 *  the button in range. */
export const withPlayers = (view: MultiwayView, players: number): MultiwayView => {
  const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(players)));
  const last = view.stacks[view.stacks.length - 1] ?? "20";
  const stacks = Array.from({ length: n }, (_, i) => view.stacks[i] ?? last);
  return {
    ...view,
    players: n,
    stacks,
    button: Math.min(view.button, n - 1),
    teamSeats: view.teamSeats.filter((s) => s < n),
  };
};

const num = (text: string): number => {
  const v = Number(text.trim());
  return Number.isFinite(v) ? v : NaN;
};

/** Everything wrong with the current view, in the order a user would fix it.
 *  Empty means the config below will build. */
export const validate = (view: MultiwayView): string[] => {
  const issues: string[] = [];
  if (view.game !== "holdem") issues.push("Only Hold'em is implemented so far.");
  if (view.limit !== "nl") issues.push("Only no-limit is implemented so far.");
  if (view.street !== "preflop") {
    issues.push("Only preflop is implemented so far - postflop multiway is a later pass.");
  }
  const sb = num(view.smallBlind);
  const bb = num(view.bigBlind);
  if (!(bb > 0)) issues.push("The big blind must be a positive number of chips.");
  if (!(sb >= 0)) issues.push("The small blind cannot be negative.");
  if (Number.isFinite(sb) && Number.isFinite(bb) && sb > bb) {
    issues.push("The small blind is larger than the big blind.");
  }
  if (!(num(view.ante) >= 0)) issues.push("The ante cannot be negative.");
  if (!(num(view.dead) >= 0)) issues.push("Dead money cannot be negative.");
  view.stacks.slice(0, view.players).forEach((s, i) => {
    if (!(num(s) > 0)) issues.push(`Seat ${i + 1} needs a positive stack.`);
  });
  if (!(num(view.boardSamplePair) >= 1000)) {
    issues.push("Pairwise board sample must be at least 1000.");
  }
  if (!(num(view.boardSampleIter) >= 1)) {
    issues.push("Multiway board sample must be at least 1.");
  }
  if (!(num(view.maxIterations) >= 1)) issues.push("Max iterations must be at least 1.");
  if (view.teamSeats.length !== 0 && view.teamSeats.length !== 2) {
    issues.push("A hand-sharing team is exactly two seats (or none).");
  }
  if (view.teamSeats.length === 2 && view.players < 3) {
    issues.push("A team needs at least one opponent.");
  }
  return issues;
};

/** The stack-to-blind ratio the chart is really quoted at. */
export const effectiveBb = (view: MultiwayView): number => {
  const bb = num(view.bigBlind);
  const smallest = Math.min(...view.stacks.slice(0, view.players).map(num));
  return bb > 0 && Number.isFinite(smallest) ? smallest / bb : NaN;
};

/** The htsolver config, in the shape POST /api/enginecompare stores verbatim.
 *  Every field here is validated engine-side too - this only has to be
 *  well-formed, not trusted. */
export const buildMultiwayConfig = (view: MultiwayView): Record<string, unknown> => {
  const labels = seatLabels(view.players, view.button);
  return {
    schema: 1,
    game: "nlhe_preflop",
    // The engine works in chips; chip_scale is only how the UI reads them
    // back as big blinds.
    chip_scale: num(view.bigBlind),
    players: Array.from({ length: view.players }, (_, i) => ({
      seat: labels[i],
      stack: num(view.stacks[i]),
      // 100% at the root: which hands are worth jamming is the answer, not
      // the question, so nothing is filtered out before the solve.
      range: FULL_RANGE,
    })),
    preflop: {
      small_blind: num(view.smallBlind),
      big_blind: num(view.bigBlind),
      ante: num(view.ante),
      dead: num(view.dead),
      button: view.button,
      action_set: "jam_fold",
      board_sample: {
        iter_count: num(view.boardSampleIter),
        pair_count: num(view.boardSamplePair),
        seed: num(view.seed),
      },
    },
    // 4+ seats run the SAMPLED core (M8c): every iteration deals concrete
    // cards, so opponent-vs-opponent card removal is exact in expectation and
    // root EVs sum to the dead money by construction - the property the
    // factorized estimator provably cannot reach past 3 seats. 2-3 seats
    // stay on the vectorized core - EXCEPT when a team exists, which only
    // the sampled core can express. A sampled "iteration" is one dealt
    // hand, not one exact tree pass, hence the per-family checkpoint
    // cadence.
    algorithm:
      view.players >= 4 || view.teamSeats.length === 2
        ? { family: "sampled", sampled: { seed: num(view.seed), batch: 1024, lanes: 16 } }
        : { update: "dcfr" },
    ...(view.teamSeats.length === 2
      ? {
          agents: {
            partition: [
              [...view.teamSeats].sort((x, y) => x - y),
              ...Array.from({ length: view.players }, (_, i) => i)
                .filter((i) => !view.teamSeats.includes(i))
                .map((i) => [i]),
            ],
            awareness: view.awareness,
          },
        }
      : {}),
    budget: {
      iterations: num(view.maxIterations),
      target_nashconv: num(view.accuracy),
      // One checkpoint for a sampled solve: each checkpoint runs a
      // best-response pass over the factorized evaluator (~38 s at 500
      // boards), and targets cannot stop a 4+ seat sampled solve anyway,
      // so mid-solve checkpoints would only multiply the measuring cost.
      checkpoint_every:
        view.players >= 4 || view.teamSeats.length === 2 ? num(view.maxIterations) : 25,
    },
    memory_limit_gb: 12,
    threads: 0,
    output: { rollups_169: true },
  };
};

/** All 169 classes at weight 1. The engine's range grammar has no "100%"
 *  shorthand and no plus/dash ranges, so it is spelled out. */
const RANKS = "AKQJT98765432";
export const FULL_RANGE = (() => {
  const tokens: string[] = [];
  for (let i = 0; i < 13; i += 1) {
    for (let j = i; j < 13; j += 1) {
      if (i === j) tokens.push(`${RANKS[i]}${RANKS[i]}`);
      else tokens.push(`${RANKS[i]}${RANKS[j]}s`, `${RANKS[i]}${RANKS[j]}o`);
    }
  }
  return tokens.join(",");
})();
