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
import type { PushFoldDump } from "./pushfoldResult";

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
  /** The solve LINEAGE this run advances. Empty = the engine derives one from
   *  the spot, so re-solving the same spot continues it. Loading a past solve
   *  fills this in from its artifact, which is what makes "raise the budget
   *  and solve again" a deliberate continuation rather than a coincidence. */
  solveId: string;
  /** Unaware phase-1 (no-team baseline) iterations. Empty = same as
   *  maxIterations. Long team solves want this SMALLER than phase 2: the
   *  baseline converges quickly, while the team's conditioned charts are
   *  what sharpen with iterations. */
  baselineIterations: string;

  /* ---- Solve settings ---- */
  boardSampleIter: string;
  boardSamplePair: string;
  seed: string;
  accuracy: string; // target exploitability, chips
  maxIterations: string;
  /** Sampled-core batch size. Empty = derived from maxIterations (see
   *  buildMultiwayConfig). Pinned when a past solve is loaded, because the
   *  batch is part of the solve's IDENTITY - a checkpoint refuses a config
   *  whose batch moved - and the thing you change to continue a solve is
   *  exactly the budget the derivation reads. */
  batch: string;
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
  solveId: "",
  baselineIterations: "",
  boardSampleIter: "500",
  boardSamplePair: "20000",
  seed: "20260830",
  accuracy: "0.004",
  // High enough for the sampled family (one deal per iteration); the
  // vectorized 2-3 seat solves stop on the accuracy target long before it.
  maxIterations: "200000",
  batch: "",
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
  if (view.baselineIterations.trim() !== "" && !(num(view.baselineIterations) >= 1)) {
    issues.push("Baseline iterations must be at least 1 (or left empty for = max).");
  }
  if (view.batch.trim() !== "" && !(num(view.batch) >= 1)) {
    issues.push("Batch must be at least 1.");
  }
  if (view.solveId.trim() !== "" && !/^[A-Za-z0-9._-]{1,64}$/.test(view.solveId.trim())) {
    issues.push("Solve ID may only use letters, digits, '-', '_' and '.', up to 64 characters.");
  }
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

/** Whether this tree runs on the SAMPLED-deal core rather than the vectorized
 *  one. 4+ seats need it, and so does a hand-sharing team at any seat count -
 *  only the sampled core can express one.
 *
 *  Exported because the builder's labels and tooltips change with it ("the
 *  solve never reads this", "the accuracy target is ignored"), and having them
 *  re-derive the threshold is what let a 3-way team solve claim the vectorized
 *  behaviour it does not get. One predicate, used by the config and the copy
 *  that describes it. */
export const isSampledCore = (view: MultiwayView): boolean =>
  view.players >= 4 || view.teamSeats.length === 2;

/** Root pot: dead money, blinds and antes. Derived and never typed - the
 *  engine builds it the same way, so anywhere that shows a pot reads this
 *  rather than keeping its own copy. */
export const potChips = (view: MultiwayView): number =>
  (Number(view.dead) || 0) +
  (Number(view.smallBlind) || 0) +
  (Number(view.bigBlind) || 0) +
  (Number(view.ante) || 0) * view.players;

/** Rebuild the builder view from a solved artifact's metadata: the inverse of
 *  buildMultiwayConfig, and what makes opening a past solve move the table,
 *  the seat labels and the fields instead of leaving them showing whatever
 *  was last typed.
 *
 *  `base` supplies the few fields the artifact does not record - accuracy,
 *  baseline iterations, and game/limit/street, which a pushfold job pins to
 *  holdem/nl/preflop anyway.
 *
 *  Returns null for a payload written before the `preflop` metadata block
 *  existed, so the caller keeps the view it has rather than half-restoring
 *  one. */
export const viewFromDump = (
  meta: PushFoldDump["metadata"],
  base: MultiwayView
): MultiwayView | null => {
  const pf = meta.preflop;
  if (!pf || !meta.seats?.length) return null;

  const players = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, meta.seats.length));
  const button = Math.min(Math.max(0, Math.round(pf.button)), players - 1);

  const recorded = meta.stacks;
  const stacks = Array.from({ length: players }, (_, i) => {
    const s = recorded?.[i];
    return s != null ? String(s) : base.stacks[i] ?? "20";
  });

  /* The artifact records the root pot but not its parts. buildMultiwayConfig
   * builds that pot as dead + sb + bb + ante * players, and the builder has
   * no dead-money input (the field exists in MultiwayView but nothing renders
   * it, so it is always 0), which leaves the ante uniquely recoverable. */
  const anteEach = (meta.pot - pf.small_blind - pf.big_blind) / players;
  const ante = Number.isFinite(anteEach) && anteEach > 0 ? String(anteEach) : "0";

  const teamSeats = (meta.team?.seats ?? []).filter((s) => s >= 0 && s < players);

  return {
    ...base,
    players,
    button,
    smallBlind: String(pf.small_blind),
    bigBlind: String(pf.big_blind),
    ante,
    dead: "0",
    stacks,
    teamSeats,
    awareness: meta.team?.awareness === "aware" ? "aware" : "unaware",
    // Carrying the id forward is what turns "load a past solve, raise the
    // budget, solve" into a CONTINUATION of that solve rather than a new one
    // that happens to look the same.
    solveId: meta.solve_id ?? base.solveId,
    // Phase 1 is its own budget with its own checkpoint. Restoring what the
    // loaded solve actually ran keeps a re-solve extending phase 2 - changing
    // it moves the baseline, which the engine refuses unless asked to rebase.
    baselineIterations:
      meta.team?.baseline_iterations != null
        ? String(meta.team.baseline_iterations)
        : base.baselineIterations,
    ...(meta.board_sample
      ? {
          boardSampleIter: String(meta.board_sample.iter_count),
          boardSamplePair: String(meta.board_sample.pair_count),
          seed: String(meta.board_sample.seed),
        }
      : {}),
    // Requested, not reached: a time-capped solve writes fewer iterations than
    // it was asked for, and restoring the smaller number would silently shrink
    // the budget of a re-solve from this spot.
    maxIterations: String(meta.requested_iterations ?? meta.iterations ?? base.maxIterations),
    // The batch travels with the solve, not with the budget. It is part of
    // config_solve_key, so a re-solve that re-derived it from a smaller
    // budget would cross the 10M threshold downwards, fail the checkpoint's
    // spot check, and silently restart a long solve from zero - which is
    // exactly what "load it, raise the budget, solve" would have done.
    batch: meta.sampled?.batch != null ? String(meta.sampled.batch) : base.batch,
  };
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
    algorithm: isSampledCore(view)
        ? {
            family: "sampled",
            sampled: {
              seed: num(view.seed),
              // Every batch boundary is a full discount + lane-fold sweep
              // over the solver arrays, so at multi-million iteration
              // budgets a small batch spends minutes on synchronization
              // alone. Larger batches only coarsen the linear-discount
              // granularity, which is negligible at that scale.
              // A pinned batch wins: it came from the solve being continued,
              // and re-deriving it would silently fork a new lineage.
              batch: num(view.batch) >= 1
                  ? num(view.batch)
                  : num(view.maxIterations) >= 10_000_000
                    ? 8192
                    : 1024,
              lanes: 16,
            },
          }
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
            ...(view.awareness === "unaware" && num(view.baselineIterations) >= 1
              ? { baseline_iterations: num(view.baselineIterations) }
              : {}),
          },
        }
      : {}),
    ...(view.solveId.trim() !== "" ? { solve: { id: view.solveId.trim() } } : {}),
    budget: {
      iterations: num(view.maxIterations),
      target_nashconv: num(view.accuracy),
      // One checkpoint for a sampled solve: each checkpoint runs a
      // best-response pass over the factorized evaluator (~38 s at 500
      // boards), and targets cannot stop a 4+ seat sampled solve anyway,
      // so mid-solve checkpoints would only multiply the measuring cost.
      checkpoint_every: isSampledCore(view) ? num(view.maxIterations) : 25,
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
