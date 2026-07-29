// src/pages/handhistory/create/solveBridge.ts
//
// Bridges a recorded hand to the postflop solve pipeline: when a hand saw a
// flop heads-up, this derives everything the tree-building modal needs from
// the engine - pot, effective stack, positions (remapped to the solver's
// canonical names), per-street bet sizes from the actual bets, seeded ranges
// from canned charts, and the seat metadata shown in the solutions viewer.
//
// Units: the hand-history engine runs in raw chips with engine.bb as the
// big-blind rate; Pio tree configs use chips = bb * 100.
import type { Engine, EngineAction } from "./engine";
import {
  DEFAULT_TREE_SIZES,
  POSTFLOP_ORDER,
  cloneTreeSizes,
  type TreeParams,
  type TreeSizes,
} from "@/lib/solver/treeConfig";
import { getDefaultRange, type PreflopRole } from "@/lib/solver/defaultRanges";
import type { SeatMeta } from "@/lib/solver/uploadGameTree";

export interface FlopPlayerInfo {
  engineIndex: number;
  name: string;
  hhPos: string;
  solverPos: string;
  startStackBB: number;
  flopStackBB: number;
}

export type HandSolveExtract =
  | {
      eligible: false;
      reason: "no-flop" | "not-hu" | "allin-preflop" | "no-flop-snapshot";
    }
  | {
      eligible: true;
      oop: FlopPlayerInfo;
      ip: FlopPlayerInfo;
      /** Flop cards already entered in the hand's setup ([] when unknown). */
      flopCards: string[];
      /** Synthetic sim-folder name, e.g. "100BB_98BTN" (OOP token first).
       *  Becomes the {stacks} segment of the solution path; the watcher
       *  parses each token back into starting stacks in bb. */
      folder: string;
      preflopLine: string[];
      /** [OOP, IP] - ordered like POSTFLOP_ORDER, which is how the watcher
       *  re-derives seat roles. */
      alivePositions: string[];
      actingPos: string;
      params: TreeParams;
      seats: SeatMeta[];
      /** The hand's big blind in real chips (drives the viewer's chip display). */
      bigBlind: number;
    };

/** Hand-history position labels the solver doesn't use, remapped per
 *  dealt-in player count to the closest solver-canonical seat. */
const POS_MAPS: Record<number, Record<string, string>> = {
  4: { UTG: "CO" },
  5: { UTG: "HJ" },
  6: { UTG: "LJ" },
  7: { UTG: "UTG1", MP: "LJ" },
  8: { MP: "LJ" },
  9: { MP: "LJ" },
};

export const mapHHPosToSolver = (hhPos: string, dealtInCount: number): string =>
  POS_MAPS[dealtInCount]?.[hhPos] ?? hhPos;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const streetKey = (s: number): keyof TreeSizes =>
  s === 1 ? "flop" : s === 2 ? "turn" : "river";

const fmtBBAmount = (x: number): string => {
  const s = x.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};

const lastAggressorOf = (acts: EngineAction[]): number | null => {
  let aggr: number | null = null;
  for (const a of acts) {
    if (a.kind === "bet" || a.kind === "raise") aggr = a.player;
  }
  return aggr;
};

/** How a flop player entered the pot preflop, for the canned-chart lookup. */
const preflopRoleOf = (
  acts: EngineAction[],
  idx: number,
  solverPos: string
): PreflopRole => {
  const aggressions = acts.filter((a) => a.kind === "raise" || a.kind === "bet");
  const mine = aggressions.filter((a) => a.player === idx);
  if (mine.length > 0) {
    const last = aggressions[aggressions.length - 1];
    if (last.player === idx) {
      const firstMineIdx = aggressions.findIndex((a) => a.player === idx);
      return firstMineIdx === 0 ? "open" : "threeBet";
    }
    // Raised earlier, then called someone's re-raise.
    return "threeBetCall";
  }
  if (aggressions.length === 0) return "limp";
  return solverPos === "BB" ? "bbDefend" : "flatCall";
};

/** Walk the recorded postflop actions and turn the first bet/raise per seat
 *  per street into Pio size percentages; everything else keeps the solver's
 *  standard defaults. */
const deriveSizes = (
  engine: Engine,
  oopIdx: number,
  ipIdx: number
): { oop: TreeSizes; ip: TreeSizes } => {
  const oop = cloneTreeSizes(DEFAULT_TREE_SIZES.oop);
  const ip = cloneTreeSizes(DEFAULT_TREE_SIZES.ip);

  // Aggressor of the previous street decides whether an OOP turn/river lead
  // is a donk bet (into the aggressor) or a regular bet.
  let prevStreetAggressor = lastAggressorOf(engine.streetActions[0]);

  for (let s = 1; s <= 3; s++) {
    const meta = engine.streetMeta[s];
    const acts = engine.streetActions[s] ?? [];
    if (!meta || acts.length === 0) continue;

    let pot = meta.potStart;
    const commit: Record<number, number> = {};
    const firstBetDone: Record<string, boolean> = {};
    const firstRaiseDone: Record<string, boolean> = {};
    let streetAggressor: number | null = null;
    const key = streetKey(s);

    for (const a of acts) {
      const role = a.player === oopIdx ? "oop" : a.player === ipIdx ? "ip" : null;
      const prev = commit[a.player] ?? 0;

      if (a.kind === "bet") {
        if (role && !firstBetDone[role]) {
          firstBetDone[role] = true;
          const pct = clamp(Math.round((100 * a.amount) / Math.max(pot, 1)), 5, 250);
          const target = role === "oop" ? oop : ip;
          if (role === "oop" && s >= 2 && prevStreetAggressor === ipIdx) {
            target[key].donkBetSize = String(pct);
          } else {
            target[key].betSize = String(pct);
          }
        }
        streetAggressor = a.player;
        pot += a.amount - prev;
        commit[a.player] = a.amount;
      } else if (a.kind === "raise") {
        // facing = the biggest street commitment before this raise
        const facing = Object.values(commit).reduce((m, v) => Math.max(m, v), 0);
        if (role && !firstRaiseDone[role]) {
          firstRaiseDone[role] = true;
          const target = role === "oop" ? oop : ip;
          if (a.allIn) {
            target[key].raiseSize = "a";
          } else {
            // Inverse of the solver's raise convention:
            // raiseTo = facing + pct/100 * (pot + facing)
            const pct = clamp(
              Math.round((100 * (a.amount - facing)) / Math.max(pot + facing, 1)),
              5,
              400
            );
            target[key].raiseSize = String(pct);
          }
        }
        streetAggressor = a.player;
        pot += a.amount - prev;
        commit[a.player] = a.amount;
      } else if (a.kind === "call") {
        // call amount = chips ADDED, unlike bet/raise totals
        pot += a.amount;
        commit[a.player] = prev + a.amount;
      }
      // check/fold: no money moves
    }

    if (streetAggressor !== null) prevStreetAggressor = streetAggressor;
  }

  return { oop, ip };
};

export function extractHandSolve(args: {
  /** Final engine of the completed hand. */
  engine: Engine;
  /** Pre-action snapshots kept by the recorder (used for exact flop-time stacks). */
  history: Engine[];
  /** state.board - flop cards may or may not have been entered. */
  board: (string | null)[];
  buttonSeat: number;
}): HandSolveExtract {
  const { engine, history, board, buttonSeat } = args;
  const bb = engine.bb || 1;

  // A preflop all-in has zero postflop decision points - solving the flop
  // would produce a trivial tree, so it's deliberately not offered.
  if (engine.allInStreet === 0) return { eligible: false, reason: "allin-preflop" };
  if (engine.reached < 1) return { eligible: false, reason: "no-flop" };
  if (engine.streetMeta[1]?.players !== 2) return { eligible: false, reason: "not-hu" };

  // Stacks at the moment the flop was dealt: the pre-action snapshot of the
  // first flop action (committed already swept into the pot).
  const flopSnap =
    history.find((h) => h.street === 1) ?? (engine.street === 1 ? engine : null);
  if (!flopSnap) return { eligible: false, reason: "no-flop-snapshot" };

  // The two flop players, in postflop acting order (seat-walk left of the
  // button, mirroring the engine's firstToActPostflop).
  const players = flopSnap.players;
  const n = players.length;
  const btnIdx = players.findIndex((p) => p.seat === buttonSeat);
  const live: number[] = [];
  for (let step = 1; step <= n && live.length < 2; step++) {
    const i = ((btnIdx >= 0 ? btnIdx : n - 1) + step) % n;
    if (!players[i].folded) live.push(i);
  }
  if (live.length !== 2) return { eligible: false, reason: "not-hu" };
  const [oopIdx, ipIdx] = live;

  let oopPos = mapHHPosToSolver(players[oopIdx].pos, n);
  let ipPos = mapHHPosToSolver(players[ipIdx].pos, n);
  const order = POSTFLOP_ORDER as readonly string[];

  // 9-max can collapse two labels onto one token (MP and LJ both -> LJ);
  // give the OOP seat the nearest earlier free token.
  if (oopPos === ipPos) {
    for (let i = order.indexOf(oopPos) - 1; i >= 0; i--) {
      if (order[i] !== "SB" && order[i] !== "BB") {
        oopPos = order[i];
        break;
      }
    }
  }
  // The watcher assigns Range0/Range1 by POSTFLOP_ORDER, so the OOP label
  // must sort before the IP label; swap if a mapping ever inverted them.
  if (order.indexOf(oopPos) > order.indexOf(ipPos)) {
    console.warn(
      `solveBridge: position mapping inverted OOP/IP order (${oopPos} vs ${ipPos}); swapping labels.`
    );
    [oopPos, ipPos] = [ipPos, oopPos];
  }

  const info = (idx: number, solverPos: string): FlopPlayerInfo => ({
    engineIndex: idx,
    name: players[idx].name,
    hhPos: players[idx].pos,
    solverPos,
    startStackBB: players[idx].startingStack / bb,
    flopStackBB: players[idx].stack / bb,
  });
  const oop = info(oopIdx, oopPos);
  const ip = info(ipIdx, ipPos);

  const potChips = Math.round((engine.streetMeta[1].potStart / bb) * 100);
  const effectiveStackChips = Math.round(
    (Math.min(players[oopIdx].stack, players[ipIdx].stack) / bb) * 100
  );

  const flopFromBoard = board.slice(0, 3);
  const flopCards = flopFromBoard.every((c): c is string => !!c)
    ? [...flopFromBoard] as string[]
    : [];

  // Folder tokens use HAND-START stacks: the viewer treats folder-derived
  // stacks as starting stacks and subtracts preflop money itself.
  const token = (p: FlopPlayerInfo) =>
    `${Math.max(1, Math.round(p.startStackBB))}${p.solverPos}`;
  const folder = `${token(oop)}_${token(ip)}`;

  // Display line for the solutions library, from the two flop players'
  // preflop actions.
  const preflopLine = ["Root"];
  for (const a of engine.streetActions[0]) {
    if (a.player !== oopIdx && a.player !== ipIdx) continue;
    if (a.kind === "raise" || a.kind === "bet") {
      preflopLine.push(a.allIn ? "ALLIN" : `Raise ${fmtBBAmount(a.amount / bb)}bb`);
    } else if (a.kind === "call") {
      preflopLine.push("Call");
    } else if (a.kind === "check") {
      preflopLine.push("Check");
    }
  }

  // Last of the two to act preflop - mirrors the solver flow, where the
  // acting position is the caller who closed the action.
  let actingPos = ipPos;
  for (const a of engine.streetActions[0]) {
    if (a.player === oopIdx) actingPos = oopPos;
    else if (a.player === ipIdx) actingPos = ipPos;
  }

  const sizes = deriveSizes(engine, oopIdx, ipIdx);

  const roleOOP = preflopRoleOf(engine.streetActions[0], oopIdx, oopPos);
  const roleIP = preflopRoleOf(engine.streetActions[0], ipIdx, ipPos);

  const stackChipsAtFlop = (idx: number) =>
    Math.round((players[idx].stack / bb) * 100);

  // Stacks literal: OOP first, IP second, then everyone else - Pio matches
  // these positionally against Range0/Range1. Literal "\n" separators.
  const otherIdxs = players.map((_, i) => i).filter((i) => i !== oopIdx && i !== ipIdx);
  const stacksLiteral = [oopIdx, ipIdx, ...otherIdxs]
    .map((i) => String(stackChipsAtFlop(i)))
    .join("\\n");

  const params: TreeParams = {
    rangeOOP: getDefaultRange(oopPos, roleOOP),
    rangeIP: getDefaultRange(ipPos, roleIP),
    potChips,
    effectiveStackChips,
    allinThreshold: 60,
    addAllinOnlyIfLessThanThisTimesThePot: 250,
    mergeSimilarBets: true,
    mergeSimilarBetsThreshold: 12,
    oop: sizes.oop,
    ip: sizes.ip,
    icm: { enabled: false, payoutsLiteral: "0\\n0\\n0", stacksLiteral },
  };

  const seats: SeatMeta[] = players.map((p, i) => ({
    pos: i === oopIdx ? oopPos : i === ipIdx ? ipPos : p.pos,
    name: p.name,
    stackChips: stackChipsAtFlop(i),
    folded: p.folded,
    hero: engine.heroIndex === i,
    cards: p.hole.filter((c): c is string => !!c),
  }));

  return {
    eligible: true,
    oop,
    ip,
    flopCards,
    folder,
    preflopLine,
    alivePositions: [oopPos, ipPos],
    actingPos,
    params,
    seats,
    bigBlind: bb,
  };
}
