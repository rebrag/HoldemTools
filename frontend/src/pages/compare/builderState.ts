// src/pages/compare/builderState.ts
//
// The /compare tree builder's state and its translation into an htsolver
// config. The state is deliberately shaped like PioViewer's tree-building
// screen (see treeConfigText.ts) plus the few knobs that are ours alone:
// solve accuracy, the iteration cap, and the pre-root aggressor.
import type { TreeBuildingView } from "@/components/treeBuildingView";
import {
  cloneSeat,
  fullRangeWeights,
  parseBoardCards,
  type StreetBoxes,
  type StreetKey,
  type TreeConfigText,
} from "./treeConfigText";

export interface BuilderState extends TreeConfigText {
  /** Aggressor on the street BEFORE the root; gates OOP donk sizes there. */
  preflopAggressor: "none" | "ip" | "oop";
  maxRaises: string;
  accuracyMode: "pct" | "chips";
  accuracy: string;
  maxIterations: string;
  /** PioViewer's "Change only betting structure when loading configuration":
   *  a pasted config replaces the sizing boxes and leaves the spot alone. */
  betStructureOnly: boolean;

  /* PioSolver is opt-in per run, and its two expensive halves are opt-in
   * within that. All three default to disabled: htsolver-only is the fast
   * iteration loop, and Pio is wanted only as an occasional accuracy check.
   * "No Pio" implies the other two, which the API also normalizes. */

  /** Do not run PioSolver at all: no process, no UPI, no Pio payload. */
  disablePio: boolean;
  /** Run Pio, but skip its per-hand extraction (the per-node UPI queries).
   *  Its root EV, exploitability and cost comparison still travel. */
  disableCompare: boolean;
  /** Skip the cross-exploitability gate (set_strategy upload + calc_results). */
  disableCrossCheck: boolean;
}

const street = (bet: string, raise: string, donk = ""): StreetBoxes => ({
  bet,
  raise,
  donk,
  addAllin: true,
  noThreeBet: false,
});

export const DEFAULT_BUILDER: BuilderState = {
  oopRange: fullRangeWeights(),
  ipRange: fullRangeWeights(),
  board: "9c 5d Jc 7s 9h",
  pot: "100",
  effectiveStacks: "400",
  allinThresholdPct: "90",
  addAllinCapPct: "300",
  oop: {
    flop: street("50", "100"),
    turn: street("50", "100"),
    river: street("50 100", "100"),
  },
  ip: {
    flop: street("50", "100"),
    turn: street("50", "100"),
    river: street("50 100", "100"),
  },
  preflopAggressor: "none",
  maxRaises: "3",
  accuracyMode: "pct",
  accuracy: "0.02",
  maxIterations: "20000",
  betStructureOnly: false,
  disablePio: true,
  disableCompare: true,
  disableCrossCheck: true,
};

/* ---------- shared tree-building panel adapters ----------
 * BuilderState is a structural SUPERSET of TreeBuildingView, so these are a
 * widening and a merge - not a conversion. Nothing is copied, reformatted or
 * trimmed, which is why serializeTreeConfigText cannot tell that the panel is
 * now shared (see e2e/tree-config-text.spec.ts for the byte-level proof). */

export const builderToView = (b: BuilderState): TreeBuildingView => b;

/** Merge, never reconstruct: accuracyMode / accuracy / maxIterations belong to
 *  /compare's own solve settings and never enter the shared panel. */
export const applyViewToBuilder = (
  prev: BuilderState,
  v: TreeBuildingView
): BuilderState => ({ ...prev, ...v });

export const cloneBuilder = (b: BuilderState): BuilderState => ({
  ...b,
  oopRange: { ...b.oopRange },
  ipRange: { ...b.ipRange },
  oop: cloneSeat(b.oop),
  ip: cloneSeat(b.ip),
});

/** Streets the board length actually puts in the tree. A 5-card board is a
 *  river solve, so flop and turn are inert - their boxes stay on screen and
 *  editable, they just do not reach the solver. */
export const activeStreets = (board: string): Set<StreetKey> => {
  const n = parseBoardCards(board).length;
  const active = new Set<StreetKey>(["river"]);
  if (n <= 4) active.add("turn");
  if (n <= 3) active.add("flop");
  return active;
};

/** 169-class weights -> the engine's range string ("AA:1,AKs:0.5,..."). */
const engineRange = (weights: Record<string, number>): string =>
  Object.entries(weights)
    .filter(([, w]) => w > 0)
    .map(([hand, w]) => `${hand}:${w}`)
    .join(",");

/** A size string ("50 100", "25,100", "a") -> percentages of the pot.
 *  "a" is Pio's all-in token; the engine expresses all-in as an oversized
 *  percentage that the tree builder clamps to the effective stack. */
const ALLIN_PCT = 10000;

const parseSizes = (text: string, what: string): number[] =>
  text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((raw) => {
      if (raw.toLowerCase() === "a") return ALLIN_PCT;
      const v = Number(raw);
      if (!(v > 0)) throw new Error(`Bad ${what} size "${raw}" - sizes are % of pot, or "a".`);
      return v;
    });

/** Appends the all-in option when the box is ticked. Only meaningful next to
 *  at least one real size: an empty list means "this seat cannot lead here",
 *  and an all-in-only lead is not what an empty box asks for. */
const withAllin = (sizes: number[], addAllin: boolean): number[] =>
  addAllin && sizes.length > 0 ? [...sizes, ALLIN_PCT] : sizes;

export interface EngineConfigResult {
  config: object;
  /** The accuracy target handed to Pio, as a percent of the pot. */
  pioAccuracyPct: number;
  /* Harness options, siblings of `config` rather than fields inside it:
   * `config` is the htsolver config handed verbatim to engine.exe, while
   * these steer engine_compare.py. Same shape as pioAccuracyPct. */
  disablePio: boolean;
  disableCompare: boolean;
  disableCrossCheck: boolean;
}

/** Build the htsolver config from the form; throws with a readable message
 *  on anything invalid. */
export const buildEngineConfig = (b: BuilderState): EngineConfigResult => {
  const board = parseBoardCards(b.board);
  if (board.length < 3 || board.length > 5) {
    throw new Error("Board needs 3 (flop solve), 4 (turn), or 5 (river) cards.");
  }
  if (new Set(board).size !== board.length) throw new Error("Board has duplicate cards.");

  const pot = Number(b.pot);
  const stacks = Number(b.effectiveStacks);
  if (!(pot > 0)) throw new Error("Starting pot must be positive.");
  if (!(stacks >= 0)) throw new Error("Effective stacks cannot be negative.");

  const allinThreshold = Math.min(
    1.5,
    Math.max(0.1, Number(b.allinThresholdPct) / 100 || 0.9)
  );
  const maxRaises = Math.max(0, Math.min(20, Number(b.maxRaises) || 3));

  const streetSizing = (key: StreetKey) => {
    const oop = b.oop[key];
    const ip = b.ip[key];
    const oopBets = parseSizes(oop.bet, "OOP bet");
    // The flop has no donk box, matching PioViewer: a flop-rooted tree treats
    // OOP's first-in as a plain bet. Mirroring the bets into `donks` keeps
    // that true even when preflop_aggressor says IP was the aggressor, which
    // would otherwise leave OOP with no way to lead the flop at all.
    const oopDonks = key === "flop" ? oopBets : parseSizes(oop.donk, "OOP donk");
    return {
      ip: {
        bets: withAllin(parseSizes(ip.bet, "IP bet"), ip.addAllin),
        raises: withAllin(parseSizes(ip.raise, "IP raise"), ip.addAllin),
        no_3bet: ip.noThreeBet,
      },
      oop: {
        bets: withAllin(oopBets, oop.addAllin),
        donks: withAllin(oopDonks, oop.addAllin),
        raises: withAllin(parseSizes(oop.raise, "OOP raise"), oop.addAllin),
        no_3bet: oop.noThreeBet,
      },
      allin_threshold: allinThreshold,
      max_raises: maxRaises,
    };
  };

  const active = activeStreets(b.board);
  const betSizing: Record<string, unknown> = { river: streetSizing("river") };
  if (active.has("turn")) betSizing.turn = streetSizing("turn");
  if (active.has("flop")) betSizing.flop = streetSizing("flop");

  const accuracy = Number(b.accuracy);
  if (!(accuracy > 0)) throw new Error("Accuracy must be positive.");
  const accuracyPct = b.accuracyMode === "pct" ? accuracy : (accuracy / pot) * 100;

  const iterations = Math.max(100, Number(b.maxIterations) || 20000);

  return {
    pioAccuracyPct: accuracyPct,
    disablePio: b.disablePio,
    disableCompare: b.disableCompare,
    disableCrossCheck: b.disableCrossCheck,
    config: {
      schema: 1,
      game: "nlhe",
      board: board.join(" "),
      pot,
      chip_scale: 100,
      players: [
        { seat: "OOP", stack: stacks, range: engineRange(b.oopRange) },
        { seat: "IP", stack: stacks, range: engineRange(b.ipRange) },
      ],
      bet_sizing: betSizing,
      preflop_aggressor: b.preflopAggressor,
      algorithm: { update: "dcfr" },
      qre: { mode: "nash" },
      budget: {
        iterations,
        target_exploitable_pct: accuracyPct,
        checkpoint_every: 250,
      },
      memory_limit_gb: 12,
      // 0 = one worker per hardware thread on the machine that runs the
      // solve. Results are bitwise identical at any thread count.
      threads: 0,
    },
  };
};
