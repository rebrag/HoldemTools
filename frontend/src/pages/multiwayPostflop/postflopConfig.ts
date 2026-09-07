// src/pages/multiwayPostflop/postflopConfig.ts
//
// The builder's state, and the engine config it turns into.
//
// Kept apart from the page for the same reason /multiway keeps multiwayView
// apart: the config is the contract with the engine and the API, it has rules
// of its own, and it is worth reading without a component around it.
//
// The rule that shapes everything here is that the SEAT COUNT picks the core.
// The vectorized showdown sweep is O(H) at two seats and O(52*H) at three,
// and past three its inclusion-exclusion grows as 52^(N-2) - there is no
// vectorized terminal at all. So 3 seats solve exactly, and 4+ must set
// `algorithm.family: "sampled"`, which pins opponents to a dealt hand and
// costs O(1) per hero hand at any seat count. The API refuses the wrong
// combination at queue time; this builds the right one so it never comes up.

export const MIN_SEATS = 3;
export const MAX_SEATS = 9;

/** The largest seat count with an exact vectorized showdown. */
export const EXACT_SEAT_LIMIT = 3;

export interface MultiwayPostflopView {
  board: string;
  potChips: number;
  /** One stack per seat, in seat order. Unequal stacks build side pots. */
  stacks: number[];
  seats: string[];
  /** Percent-of-pot bet sizes offered on the root street. */
  betPcts: number[];
  /** Percent-of-pot raise sizes; empty means no raises are built. */
  raisePcts: number[];
  /** Offer an all-in as well. Kept separate from betPcts because the engine
   *  sizes bets as a percentage of POT while a shove is a fraction of the
   *  STACK: at SPR 7 an all-in is 700% of pot, at SPR 1 it is 100%, so a
   *  literal percentage would silently stop being a shove the moment the
   *  stack or pot moved. Derived at build time instead. */
  shove: boolean;
  maxRaises: number;
  /** A size at or above this fraction of a seat's own stack is snapped to
   *  exactly that stack. It is what turns the derived shove percentage into a
   *  clean all-in rather than an almost-all-in that leaves a chip behind. */
  allinThreshold: number;
  /** Range text per seat, engine grammar. */
  ranges: string[];
  iterations: number;
  /** Sampled core only; ignored at three seats. */
  seed: number;
}

const DEFAULT_SEAT_NAMES = ["OOP", "MID", "BTN", "S3", "S4", "S5", "S6", "S7", "S8"];

/** Every combo, in the engine's range grammar. */
export const FULL_RANGE = (() => {
  const ranks = "AKQJT98765432";
  const out: string[] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = i; j < 13; j++) {
      if (i === j) out.push(`${ranks[i]}${ranks[i]}`);
      else out.push(`${ranks[i]}${ranks[j]}s`, `${ranks[i]}${ranks[j]}o`);
    }
  }
  return out.join(",");
})();

export const defaultView = (): MultiwayPostflopView => ({
  board: "",
  potChips: 100,
  stacks: [700, 700, 700],
  seats: DEFAULT_SEAT_NAMES.slice(0, 3),
  betPcts: [50],
  raisePcts: [],
  shove: true,
  // A shove has to be raisable INTO for a 3-way tree to be interesting: a
  // seat facing a bet needs the option to jam over it.
  maxRaises: 1,
  allinThreshold: 0.9,
  ranges: [FULL_RANGE, FULL_RANGE, FULL_RANGE],
  iterations: 1000,
  seed: 1,
});

/** Resize every per-seat array together, so they can never disagree. */
export const withSeats = (v: MultiwayPostflopView, seats: number): MultiwayPostflopView => {
  const n = Math.max(MIN_SEATS, Math.min(MAX_SEATS, Math.round(seats) || MIN_SEATS));
  const grow = <T,>(arr: T[], fill: (i: number) => T): T[] =>
    Array.from({ length: n }, (_, i) => (i < arr.length ? arr[i] : fill(i)));
  return {
    ...v,
    seats: grow(v.seats, (i) => DEFAULT_SEAT_NAMES[i] ?? `S${i}`),
    stacks: grow(v.stacks, () => v.stacks[v.stacks.length - 1] ?? 700),
    ranges: grow(v.ranges, () => FULL_RANGE),
  };
};

export const seatCount = (v: MultiwayPostflopView): number => v.seats.length;
export const usesSampledCore = (v: MultiwayPostflopView): boolean =>
  seatCount(v) > EXACT_SEAT_LIMIT;

const CARD_RE = /[2-9TJQKA][hdcs]/gi;
export const boardCards = (board: string): string[] => board.match(CARD_RE) ?? [];

/** Empty when the view would solve; otherwise the first thing wrong with it,
 *  phrased as what to do rather than what failed. */
export const validate = (v: MultiwayPostflopView): string | null => {
  const cards = boardCards(v.board);
  if (cards.length !== 3 && cards.length !== 4 && cards.length !== 5) {
    return "The board needs 3, 4 or 5 cards.";
  }
  if (new Set(cards.map((c) => c.toLowerCase())).size !== cards.length) {
    return "The board has a duplicate card.";
  }
  if (v.potChips <= 0) return "The pot has to be positive.";
  if (v.stacks.some((s) => s <= 0)) return "Every stack has to be positive.";
  if (v.betPcts.length === 0 && v.raisePcts.length === 0 && !v.shove) {
    return "Give at least one bet size, or turn the shove on - otherwise there is nothing to solve.";
  }
  if (v.iterations <= 0) return "Iterations has to be positive.";
  if (v.ranges.some((r) => !r.trim())) return "Every seat needs a range.";
  return null;
};

/** Effective stack in big-blind-free terms: pot-to-stack ratio, which is how
 *  a postflop spot is actually described. */
export const spr = (v: MultiwayPostflopView): number => {
  const smallest = Math.min(...v.stacks);
  return v.potChips > 0 ? smallest / v.potChips : NaN;
};

/** The engine config for this view, ready to POST as the job's `config`. */
export const buildConfig = (v: MultiwayPostflopView): Record<string, unknown> => {
  const cards = boardCards(v.board);
  // The all-in, as the percentage of pot that reaches the deepest stack. Any
  // computed size at or above `allin_threshold` of a seat's own stack is
  // snapped to exactly that stack by the tree builder, so one oversized
  // percentage yields a true shove for every seat, at every depth, however
  // unequal the stacks are.
  const shovePct = Math.ceil((100 * Math.max(...v.stacks)) / Math.max(1, v.potChips));
  const bets = v.shove ? [...v.betPcts, shovePct] : v.betPcts;
  const raises = v.shove ? [...v.raisePcts, shovePct] : v.raisePcts;
  const sizing = {
    bets,
    raises,
    max_raises: v.maxRaises,
    allin_threshold: v.allinThreshold,
  };
  // Sizing is required for the root street and every street after it, so a
  // flop tree carries three and a river tree one.
  const bet_sizing: Record<string, unknown> = {};
  if (cards.length <= 3) bet_sizing.flop = sizing;
  if (cards.length <= 4) bet_sizing.turn = sizing;
  bet_sizing.river = sizing;

  const algorithm: Record<string, unknown> = { update: "dcfr" };
  if (usesSampledCore(v)) {
    algorithm.family = "sampled";
    algorithm.sampled = { seed: v.seed, batch: 4096, lanes: 4 };
  }

  return {
    schema: 1,
    game: "nlhe",
    board: cards.join(" "),
    pot: v.potChips,
    chip_scale: 100,
    players: v.seats.map((seat, i) => ({
      seat,
      stack: v.stacks[i],
      range: v.ranges[i],
    })),
    bet_sizing,
    algorithm,
    qre: { mode: "nash" },
    budget: {
      iterations: v.iterations,
      // Only meaningful where a best response exists, which is 2-3 seats.
      // Past that the engine ignores it and runs to the iteration budget.
      checkpoint_every: Math.max(1, Math.floor(v.iterations / 10)),
    },
    memory_limit_gb: 24,
    // The watcher overwrites output.* with viewer-quality flags, but sending
    // a coherent block keeps a hand-run config valid too.
    output: { strategy_quantize_u8: true, ev_float32: true, rollups_169: true },
  };
};

const RANKS = "23456789TJQKA";
const SUITS = "hdcs";

/** A random board of `n` distinct cards. */
export const randomBoard = (n: number): string => {
  const deck: string[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(`${r}${s}`);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, n).join(" ");
};
