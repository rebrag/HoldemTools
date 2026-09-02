// src/lib/sessionSim/types.ts
//
// Types shared by the session simulator's core (src/lib/sessionSim), its
// worker (src/workers/sessionSimWorker.ts) and the /multiway UI. Type-only:
// importing it pulls no code into a bundle.

/** A solved push/fold tree compiled into flat typed arrays the dealer can
 *  walk without touching JSON. Everything is structured-clone friendly so it
 *  posts to a worker as-is. */
export interface CompiledPolicy {
  seats: number;
  /** Chips per big blind (metadata.chip_scale). */
  chipScale: number;
  rootId: number;
  nodeCount: number;
  /* ---- node table, indexed by node id ---- */
  /** 0 decision, 1 fold terminal, 2 showdown terminal. */
  kind: Uint8Array;
  actor: Int16Array;
  numChildren: Uint8Array;
  firstChild: Int32Array;
  foldWinner: Int16Array;
  pot: Float64Array;
  /** commit[id * seats + seat]: chips that seat has put in at this node. */
  commit: Float64Array;
  /* ---- decision policy ---- */
  /** 0 frozen 169-class row, 1 team 169x169 conditioned table, 2 forced
   *  single child. */
  policyKind: Uint8Array;
  /** Offset into `table` of this node's P(fold) block. */
  policyOffset: Int32Array;
  /** Team nodes: the partner seat the row is conditioned on. */
  partner: Int16Array;
  /** All P(fold) blocks back to back: 169 floats for a frozen node, 169*169
   *  for a team node laid out [partnerClass * 169 + ownClass]. */
  table: Float32Array;
  /** Seats whose net chips are summed into each hand's result. For a team
   *  solve these are the team's seats. */
  scoredSeats: number[];
  /** The hand-sharing pair, or null for a no-team solve scored on a chosen
   *  pair (the check script and a future "no sharing" comparison row). */
  teamSeats: [number, number] | null;
  meta: {
    solveId: string;
    iterations: number;
    /** The artifact's own sampled team EV in chips (sum over scored seats):
     *  the sanity reference a simulation should reproduce within noise. */
    artifactEvChips: number;
    pairingLabel: string;
    seatLabels: string[];
    /** Conditioned cells that had no data (zero-reach conditionings) and fell
     *  back to the node's marginal row. */
    fallbackCells: number;
  };
}

/** Per-hand team results for one solve, in chips. */
export interface SimulatedPool {
  results: Float32Array;
  sum: number;
  sumSq: number;
  showdowns: number;
}

export interface PoolStats {
  hands: number;
  /** Chips per hand. */
  mean: number;
  variance: number;
  showdowns: number;
}

export interface AnalyzeParams {
  handsPerSession: number;
  sessions: number;
  /** Bankrolls in bb: a session "busts" when its cumulative result touches
   *  -X at any hand. */
  bankrolls: number[];
  /** Drawdown depths (bb) for the probability table. */
  ddThresholds: number[];
  /** Hands at which the session paths are sampled for the fan and the
   *  running drawdown/minimum matrices. */
  checkpoints: number;
}

export interface PoolMeta {
  solveId: string;
  iterations: number;
  pairingLabel: string;
  artifactEvChips: number;
}

export interface Percentile {
  p: number;
  value: number;
}

export interface SessionAnalysis {
  handsPerSession: number;
  sessions: number;
  entries: number;
  /** Rotation win rate in bb per 100 hands, with its standard error. */
  bbPer100: number;
  bbPer100Se: number;
  /** Standard deviation of one hand's result under the rotation, bb. */
  sdPerHandBb: number;
  showdownPct: number;
  perEntry: {
    solveId: string;
    iterations: number;
    pairingLabel: string;
    hands: number;
    /** Share of the session's hands this entry plays. */
    weight: number;
    bbPer100: number;
    bbPer100Se: number;
    artifactBbPer100: number;
  }[];
  fan: {
    hands: number[];
    p5: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p95: number[];
    expected: number[];
    /** Session 0's own path at the same hands: one real session to look at. */
    sample: number[];
  };
  /** P(biggest downswing >= x) for several session lengths. A prefix of a
   *  session is a session of that length, so the shorter ones come free. */
  drawdown: {
    hands: number;
    x: number[];
    p: number[];
    atLeast: { threshold: number; p: number }[];
    percentiles: Percentile[];
  }[];
  bankrolls: {
    bankroll: number;
    /** Sessions whose cumulative result touched -bankroll. */
    bustP: number;
    /** Wilson 95% half-width of bustP. */
    bustHalf: number;
    /** Long-run risk of ruin, Brownian approximation exp(-2 mu X / sigma^2). */
    ruinLongRun: number;
  }[];
  finalResult: {
    percentiles: Percentile[];
    mean: number;
    sd: number;
    /** Sessions that ended below zero. */
    pLoss: number;
  };
}

/* ---------- worker protocol ---------- */

export type SimIn =
  | {
      type: "simulate";
      taskId: number;
      policy: CompiledPolicy;
      hands: number;
      seed: number;
      reportEvery: number;
    }
  | {
      type: "analyze";
      pools: Float32Array[];
      poolStats: PoolStats[];
      poolMeta: PoolMeta[];
      chipScale: number;
      params: AnalyzeParams;
      seed: number;
    };

export type SimOut =
  | { type: "progress"; taskId: number; done: number }
  | { type: "simulated"; taskId: number; pool: SimulatedPool }
  | { type: "analysis"; result: SessionAnalysis }
  | { type: "error"; message: string };
