// src/lib/solver/engineTree.ts
//
// The ONE builder of htsolver's tree block: `board`, `pot`, `chip_scale`,
// `players`, `bet_sizing`, `preflop_aggressor` (engine/docs config schema,
// and the contract the API whitelists on POST /api/gametrees). Everything a
// config says about HOW a tree is solved (algorithm, budget, threads) is the
// caller's business; this module only says WHAT the tree is.
//
// Two callers, one core:
//   - /compare's buildEngineConfig (pages/compare/builderState.ts) feeds it
//     the builder form. That path keeps the LEGACY sizing shape (the all-in is
//     appended to each size list as 10000, no `add_allin` keys) and its output
//     is pinned byte for byte by e2e/tree-config-text.spec.ts and
//     e2e/engine-tree.spec.ts.
//   - The solver and hand-history uploads call engineTreeFromParams with the
//     SAME TreeParams object buildTreeConfigText serializes for PioSOLVER, so
//     the Pio text and the engine tree cannot describe different spots. That
//     path asks for Pio's own tree rules (`pioRules`): AddAllin as a per-seat
//     flag under Pio's pot-ratio cap, and MergeSimilarBets.
//
// Pure and React-free, so the Playwright pure-logic specs import it directly.
import type { StreetSizes, TreeParams } from "./treeConfig";

export type EngineStreet = "flop" | "turn" | "river";

/** An EXPLICIT all-in size (Pio's `a`): an oversized percentage the engine's
 *  tree builder clamps to the effective stack. The engine never applies the
 *  `add_allin_max_pot_ratio` cap to it. */
export const ALLIN_PCT = 10000;

/** PioViewer's `CapPerStreet` default. The hand-history and solver panels
 *  have no raise-cap box, and PioViewer fills this in itself when building
 *  the tree from their config text (read off the `add_line` list it writes to
 *  C:\PioSOLVER\TreeBuilding\temp.txt), so the engine tree has to say the same
 *  number explicitly. */
export const PIO_CAP_PER_STREET = 4;

/** Streets a board of `cardCount` cards actually puts in the tree. A 5-card
 *  board is a river solve, so flop and turn are inert. */
export const activeStreetsFor = (cardCount: number): Set<EngineStreet> => {
  const active = new Set<EngineStreet>(["river"]);
  if (cardCount <= 4) active.add("turn");
  if (cardCount <= 3) active.add("flop");
  return active;
};

/** 169-class weights -> the engine's range string ("AA:1,AKs:0.5,...").
 *  Zero-weight classes are skipped. */
export const engineRange = (weights: Record<string, number>): string =>
  Object.entries(weights)
    .filter(([, w]) => w > 0)
    .map(([hand, w]) => `${hand}:${w}`)
    .join(",");

/** A size string in Pio syntax ("50 100", "25,100", "a") -> percentages of
 *  the pot, `a` being the explicit all-in. Throws a readable Error on junk. */
export const parseSizes = (text: string, what: string): number[] =>
  text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((raw) => {
      if (raw.toLowerCase() === "a") return ALLIN_PCT;
      const v = Number(raw);
      if (!(v > 0)) throw new Error(`Bad ${what} size "${raw}" - sizes are % of pot, or "a".`);
      return v;
    });

/** One seat's boxes on one street, as typed (Pio size syntax). */
export interface EngineSeatSizes {
  bet: string;
  raise: string;
  /** OOP only: a lead into the previous street's aggressor. Ignored on the
   *  flop, where OOP's donks mirror its bets (see streetSizing). An empty box
   *  means OOP cannot lead into the aggressor, exactly as in PioViewer. */
  donk: string;
  addAllin: boolean;
  noThreeBet: boolean;
}

export type EngineSeatStreets = Record<EngineStreet, EngineSeatSizes>;

/** PioViewer's tree rules the engine applies on request (contract section 1).
 *  Absent = the legacy shape /compare has always sent. */
export interface PioTreeRules {
  /** `#AddAllinOnlyIfLessThanThisTimesThePot#` / 100. 0 = no cap. */
  addAllinMaxPotRatio: number;
  /** `#MergeSimilarBetsThreshold#` when merging is on, 0 when it is off. */
  mergeSimilarPct: number;
}

export interface EngineTreeSpec {
  /** 3 (flop), 4 (turn) or 5 (river) distinct cards, "Ah" style. */
  board: string[];
  /** Starting pot in chips. */
  potChips: number;
  /** Chips per unit of display money (may be below 1). */
  chipScale: number;
  /** Acting order: players[0] is OOP, the last is the button. */
  players: { seat: string; stackChips: number; range: Record<string, number> }[];
  /** OOP's sizes, and the sizes every other seat plays (the engine's `ip`). */
  sizes: { oop: EngineSeatStreets; ip: EngineSeatStreets };
  /** All-in threshold as a FRACTION of the stack (0.6, not 60). */
  allinThreshold: number;
  /** Raise cap per street. Explicit: there is no silent default here. */
  maxRaises: number;
  preflopAggressor: "none" | "ip" | "oop";
  pioRules?: PioTreeRules;
}

export interface EngineSeatSizing {
  bets: number[];
  donks?: number[];
  raises: number[];
  no_3bet: boolean;
  add_allin?: boolean;
}

export interface EngineStreetSizing {
  ip: EngineSeatSizing;
  oop: EngineSeatSizing;
  allin_threshold: number;
  max_raises: number;
  add_allin_max_pot_ratio?: number;
  merge_similar_pct?: number;
}

export interface EngineTree {
  schema: 1;
  game: "nlhe";
  board: string;
  pot: number;
  chip_scale: number;
  players: { seat: string; stack: number; range: string }[];
  bet_sizing: Partial<Record<EngineStreet, EngineStreetSizing>>;
  preflop_aggressor: "none" | "ip" | "oop";
}

/** Build the engine tree block. Throws a readable Error on anything the
 *  engine would refuse.
 *
 *  Key order is part of the output: the engine hashes the config (its
 *  `config_hash` lands in the artifact), and /compare's configs are pinned
 *  byte for byte, so streets go river, turn, flop and seats ip, oop - the
 *  order /compare has always sent - in both modes. */
export const buildEngineTree = (spec: EngineTreeSpec): EngineTree => {
  const { board } = spec;
  if (board.length < 3 || board.length > 5) {
    throw new Error("Board needs 3 (flop solve), 4 (turn), or 5 (river) cards.");
  }
  if (new Set(board).size !== board.length) throw new Error("Board has duplicate cards.");
  if (!(spec.potChips > 0)) throw new Error("Starting pot must be positive.");
  if (!(spec.chipScale > 0)) throw new Error("Chip scale must be positive.");
  if (spec.players.length < 2) throw new Error("A tree needs at least two players.");
  for (const p of spec.players) {
    if (!(p.stackChips >= 0)) throw new Error("Effective stacks cannot be negative.");
  }
  if (!(spec.maxRaises >= 0)) throw new Error(`Raise cap cannot be negative, got ${spec.maxRaises}.`);

  const pio = spec.pioRules;
  // Legacy: the all-in rides in each size list, and only next to at least one
  // real size - an empty list means "this seat cannot act this way here", and
  // an all-in-only lead is not what an empty box asks for. With Pio's rules
  // the engine adds it itself (same non-empty rule, plus the pot-ratio cap),
  // so the list carries only what was typed.
  const withAllin = (sizes: number[], addAllin: boolean): number[] =>
    !pio && addAllin && sizes.length > 0 ? [...sizes, ALLIN_PCT] : sizes;
  const allinFlag = (addAllin: boolean) => (pio ? { add_allin: addAllin } : {});

  const streetSizing = (key: EngineStreet): EngineStreetSizing => {
    const oop = spec.sizes.oop[key];
    const ip = spec.sizes.ip[key];
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
        ...allinFlag(ip.addAllin),
      },
      oop: {
        bets: withAllin(oopBets, oop.addAllin),
        donks: withAllin(oopDonks, oop.addAllin),
        raises: withAllin(parseSizes(oop.raise, "OOP raise"), oop.addAllin),
        no_3bet: oop.noThreeBet,
        ...allinFlag(oop.addAllin),
      },
      allin_threshold: spec.allinThreshold,
      max_raises: spec.maxRaises,
      ...(pio
        ? {
            add_allin_max_pot_ratio: pio.addAllinMaxPotRatio,
            merge_similar_pct: pio.mergeSimilarPct,
          }
        : {}),
    };
  };

  const active = activeStreetsFor(board.length);
  const betSizing: Partial<Record<EngineStreet, EngineStreetSizing>> = {
    river: streetSizing("river"),
  };
  if (active.has("turn")) betSizing.turn = streetSizing("turn");
  if (active.has("flop")) betSizing.flop = streetSizing("flop");

  return {
    schema: 1,
    game: "nlhe",
    board: board.join(" "),
    pot: spec.potChips,
    chip_scale: spec.chipScale,
    players: spec.players.map((p) => ({
      seat: p.seat,
      stack: p.stackChips,
      range: engineRange(p.range),
    })),
    bet_sizing: betSizing,
    preflop_aggressor: spec.preflopAggressor,
  };
};

/* ---------- TreeParams (the Pio upload's own description) ---------- */

/** TreeParams keeps an unset box as `undefined`; the core wants "". IP never
 *  leads into an aggressor, so its donk box is ignored. TreeParams has no
 *  no-3bet flag (Pio's text has no key for it), so it is always false. */
const seatSizesFrom = (s: StreetSizes, isOop: boolean): EngineSeatSizes => ({
  bet: s.betSize ?? "",
  raise: s.raiseSize ?? "",
  donk: isOop ? (s.donkBetSize ?? "") : "",
  addAllin: s.addAllin,
  noThreeBet: false,
});

const seatStreetsFrom = (s: TreeParams["oop"], isOop: boolean): EngineSeatStreets => ({
  flop: seatSizesFrom(s.flop, isOop),
  turn: seatSizesFrom(s.turn, isOop),
  river: seatSizesFrom(s.river, isOop),
});

/**
 * The engine tree for the spot `buildTreeConfigText(params, flopCards)`
 * describes to PioSOLVER, read from the SAME object field by field:
 * `#Pot#` -> `pot`, `#EffectiveStacks#` -> both stacks, `#AllinThreshold#`
 * / 100, `#AddAllinOnlyIfLessThanThisTimesThePot#` / 100, MergeSimilarBets,
 * and the per-seat Bet/Raise/Donk/AddAllin boxes. The raise cap is
 * PioViewer's own default (PIO_CAP_PER_STREET) unless `opts.maxRaises` says
 * otherwise. `players[0]` is OOP, labelled `seats.oop`.
 *
 * Throws when ICM is on: the engine solves chip EV only, so an ICM spot stays
 * on PioSOLVER and the caller uploads the Pio text alone.
 */
export const engineTreeFromParams = (
  params: TreeParams,
  flopCards: string[],
  seats: { oop: string; ip: string },
  opts?: { maxRaises?: number }
): EngineTree => {
  if (params.icm.enabled) {
    throw new Error("htsolver has no ICM model; an ICM spot is solved by PioSOLVER only.");
  }
  if (!Number.isInteger(opts?.maxRaises ?? PIO_CAP_PER_STREET)) {
    throw new Error(`Raise cap must be a whole number of raises, got ${opts?.maxRaises}.`);
  }
  if (!Number.isInteger(params.potChips) || !Number.isInteger(params.effectiveStackChips)) {
    throw new Error(
      `Pot and stacks must be whole chips (got ${params.potChips} / ${params.effectiveStackChips}).`
    );
  }
  return buildEngineTree({
    board: flopCards,
    potChips: params.potChips,
    chipScale: params.chipScale,
    players: [
      { seat: seats.oop, stackChips: params.effectiveStackChips, range: params.rangeOOP },
      { seat: seats.ip, stackChips: params.effectiveStackChips, range: params.rangeIP },
    ],
    sizes: {
      oop: seatStreetsFrom(params.oop, true),
      ip: seatStreetsFrom(params.ip, false),
    },
    allinThreshold: params.allinThreshold / 100,
    maxRaises: opts?.maxRaises ?? PIO_CAP_PER_STREET,
    // The Pio config has no pre-root aggressor: its flop root lets OOP bet,
    // and the mirrored flop donks above say the same thing to the engine.
    preflopAggressor: "none",
    pioRules: {
      addAllinMaxPotRatio: params.addAllinOnlyIfLessThanThisTimesThePot / 100,
      mergeSimilarPct: params.mergeSimilarBets ? params.mergeSimilarBetsThreshold : 0,
    },
  });
};
