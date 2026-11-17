// Pure-function tests for lib/solver/engineTree.ts, the one builder of
// htsolver's tree block. No browser; same harness as tree-params-view.spec.ts.
//
// Two things are pinned here:
//   1. engineTreeFromParams - the engine tree uploaded beside the Pio text for
//      solver and hand-history solves. It reads the SAME TreeParams object
//      buildTreeConfigText serializes, so the last test states that the two
//      serializations agree on the spot.
//   2. buildEngineConfig - /compare's config, refactored onto the shared core.
//      The literals in fixtures/engine-config-snapshots.json were captured from
//      the implementation BEFORE the refactor; a changed byte there changes
//      what engine.exe sees and what config_hash it stamps.
import { test, expect } from "@playwright/test";
import {
  DEFAULT_BUILDER,
  buildEngineConfig,
  type BuilderState,
} from "../src/pages/compare/builderState";
import {
  ALLIN_PCT,
  PIO_CAP_PER_STREET,
  engineTreeFromParams,
} from "../src/lib/solver/engineTree";
import {
  DEFAULT_TREE_SIZES,
  buildTreeConfigText,
  cloneTreeSizes,
  parseRangeText,
  type TreeParams,
} from "../src/lib/solver/treeConfig";
import snapshots from "./fixtures/engine-config-snapshots.json" with { type: "json" };

/* These run once, not per browser project. */
test.skip(({ isMobile }) => !!isMobile, "pure logic - desktop project only");

const FLOP = ["Ah", "Kd", "9c"];
const SEATS = { oop: "SB", ip: "BTN" };

/** The same preflop-sim shape tree-params-view.spec.ts and money-units.spec.ts
 *  pin: pot 550 / stack 2100 at chipScale 100, the golden default sizes. */
const simParams = (): TreeParams => ({
  rangeOOP: parseRangeText("22:1,33:0.169,AA:1"),
  rangeIP: parseRangeText("KK:1,QQ:0.75"),
  potChips: 550,
  effectiveStackChips: 2100,
  chipScale: 100,
  allinThreshold: 60,
  addAllinOnlyIfLessThanThisTimesThePot: 250,
  mergeSimilarBets: true,
  mergeSimilarBetsThreshold: 12,
  oop: cloneTreeSizes(DEFAULT_TREE_SIZES.oop),
  ip: cloneTreeSizes(DEFAULT_TREE_SIZES.ip),
  icm: { enabled: false, payoutsLiteral: "0\\n0\\n0", stacksLiteral: "2100\\n2100\\n2250" },
});

test("golden default sizes produce the exact engine tree", () => {
  expect(engineTreeFromParams(simParams(), FLOP, SEATS)).toEqual({
    schema: 1,
    game: "nlhe",
    board: "Ah Kd 9c",
    pot: 550,
    chip_scale: 100,
    players: [
      { seat: "SB", stack: 2100, range: "22:1,33:0.169,AA:1" },
      { seat: "BTN", stack: 2100, range: "KK:1,QQ:0.75" },
    ],
    bet_sizing: {
      river: {
        ip: { bets: [30, 66], raises: [ALLIN_PCT], no_3bet: false, add_allin: true },
        oop: {
          bets: [30, 66],
          donks: [30],
          raises: [ALLIN_PCT],
          no_3bet: false,
          add_allin: true,
        },
        allin_threshold: 0.6,
        max_raises: 4,
        add_allin_max_pot_ratio: 2.5,
        merge_similar_pct: 12,
      },
      turn: {
        ip: { bets: [50], raises: [ALLIN_PCT], no_3bet: false, add_allin: true },
        // No turn donk box in the defaults: OOP cannot lead into the
        // aggressor, exactly as an empty box means in PioViewer.
        oop: { bets: [50], donks: [], raises: [ALLIN_PCT], no_3bet: false, add_allin: true },
        allin_threshold: 0.6,
        max_raises: 4,
        add_allin_max_pot_ratio: 2.5,
        merge_similar_pct: 12,
      },
      flop: {
        ip: { bets: [33], raises: [ALLIN_PCT], no_3bet: false, add_allin: true },
        // Flop donks mirror flop bets: PioViewer has no flop donk box.
        oop: { bets: [33], donks: [33], raises: [33], no_3bet: false, add_allin: true },
        allin_threshold: 0.6,
        max_raises: 4,
        add_allin_max_pot_ratio: 2.5,
        merge_similar_pct: 12,
      },
    },
    preflop_aggressor: "none",
  });
  expect(PIO_CAP_PER_STREET).toBe(4);
});

test("AddAllin is a flag under Pio's rules, never an appended 10000", () => {
  const tree = engineTreeFromParams(simParams(), FLOP, SEATS);
  // An explicit "a" is the only 10000 that appears; the AddAllin box rides as
  // add_allin so the engine can apply the pot-ratio cap to it alone.
  expect(tree.bet_sizing.flop!.oop.bets).toEqual([33]);
  expect(tree.bet_sizing.flop!.ip.raises).toEqual([ALLIN_PCT]);

  const off = simParams();
  off.oop.flop = { ...off.oop.flop, addAllin: false };
  const t2 = engineTreeFromParams(off, FLOP, SEATS);
  expect(t2.bet_sizing.flop!.oop.add_allin).toBe(false);
  expect(t2.bet_sizing.flop!.ip.add_allin).toBe(true);
});

test("a recorded hand's chip scale passes through untouched (0.1 and 1000)", () => {
  // $25 pot / $738 stack at 0.1 chips per dollar would be fractional, so the
  // shapes here are what solveBridge.ts actually produces: whole chips.
  for (const [chipScale, potChips, stack] of [
    [0.1, 3, 74],
    [1000, 25000, 59000],
  ] as const) {
    const p: TreeParams = { ...simParams(), chipScale, potChips, effectiveStackChips: stack };
    const tree = engineTreeFromParams(p, FLOP, SEATS);
    expect(tree.chip_scale).toBe(chipScale);
    expect(tree.pot).toBe(potChips);
    expect(tree.players.map((pl) => pl.stack)).toEqual([stack, stack]);
  }
});

test("fractional chips are refused rather than rounded behind Pio's back", () => {
  expect(() =>
    engineTreeFromParams({ ...simParams(), potChips: 2.5 }, FLOP, SEATS)
  ).toThrow(/whole chips/);
});

test("MergeSimilarBets off sends merge_similar_pct 0", () => {
  const tree = engineTreeFromParams({ ...simParams(), mergeSimilarBets: false }, FLOP, SEATS);
  for (const street of ["flop", "turn", "river"] as const) {
    expect(tree.bet_sizing[street]!.merge_similar_pct).toBe(0);
  }
});

test("river and turn donks come from the donk box; IP never leads", () => {
  const p = simParams();
  p.oop.river = { ...p.oop.river, donkBetSize: "25,75" };
  p.oop.turn = { ...p.oop.turn, donkBetSize: undefined };
  // A donk size on IP is meaningless and must not reach the engine.
  p.ip.river = { ...p.ip.river, donkBetSize: "50" };
  const tree = engineTreeFromParams(p, FLOP, SEATS);
  expect(tree.bet_sizing.river!.oop.donks).toEqual([25, 75]);
  expect(tree.bet_sizing.turn!.oop.donks).toEqual([]);
  expect(tree.bet_sizing.river!.ip.donks).toBeUndefined();
  expect(tree.bet_sizing.turn!.ip.donks).toBeUndefined();
});

test('raiseSize "a" is an explicit all-in in both seats', () => {
  const p = simParams();
  p.oop.flop = { ...p.oop.flop, raiseSize: "a" };
  p.ip.turn = { ...p.ip.turn, raiseSize: "50 a" };
  const tree = engineTreeFromParams(p, FLOP, SEATS);
  expect(tree.bet_sizing.flop!.oop.raises).toEqual([ALLIN_PCT]);
  expect(tree.bet_sizing.turn!.ip.raises).toEqual([50, ALLIN_PCT]);
});

test("ICM throws a readable error; junk sizes throw too", () => {
  const icm = { ...simParams(), icm: { ...simParams().icm, enabled: true } };
  expect(() => engineTreeFromParams(icm, FLOP, SEATS)).toThrow(/ICM/);

  const junk = simParams();
  junk.oop.turn = { ...junk.oop.turn, betSize: "2x" };
  expect(() => engineTreeFromParams(junk, FLOP, SEATS)).toThrow(/Bad OOP bet size "2x"/);
});

test("the engine tree and the Pio text describe the same spot", () => {
  /* A hand-history-like params object at a non-100 scale (money-units'
   * $25 / $738 case lands on 10), plus a sim one. */
  const hand: TreeParams = {
    ...simParams(),
    potChips: 250,
    effectiveStackChips: 7380,
    chipScale: 10,
    allinThreshold: 70,
    addAllinOnlyIfLessThanThisTimesThePot: 300,
  };
  for (const params of [simParams(), hand]) {
    const text = buildTreeConfigText(params, FLOP);
    const line = (key: string) => {
      const hit = text.split("\n").find((l) => l.startsWith(`#${key}#`));
      if (hit === undefined) throw new Error(`no #${key}# line`);
      return hit.slice(key.length + 2);
    };
    const tree = engineTreeFromParams(params, FLOP, SEATS);

    expect(tree.board).toBe(line("Board"));
    expect(tree.pot).toBe(Number(line("Pot")));
    for (const p of tree.players) expect(p.stack).toBe(Number(line("EffectiveStacks")));
    // The text carries no chip scale (the upload sends it beside the text);
    // both are read from the one params object.
    expect(tree.chip_scale).toBe(params.chipScale);
    expect(tree.players[0].range).toBe(line("Range0"));
    expect(tree.players[1].range).toBe(line("Range1"));
    expect(tree.bet_sizing.flop!.allin_threshold).toBe(Number(line("AllinThreshold")) / 100);
    expect(tree.bet_sizing.flop!.add_allin_max_pot_ratio).toBe(
      Number(line("AddAllinOnlyIfLessThanThisTimesThePot")) / 100
    );
    expect(tree.bet_sizing.flop!.merge_similar_pct).toBe(Number(line("MergeSimilarBetsThreshold")));
  }
});

/* ---------- buildEngineConfig: byte identity across the refactor ---------- */

/** Heads-up flop with every sizing branch, a pre-root aggressor, sampling on
 *  and the sampled-core second config. A blank raise cap falls back to 3. */
const richHu = (): BuilderState => ({
  ...DEFAULT_BUILDER,
  oopRange: { AA: 1, KK: 0.5, AKs: 0.25 },
  ipRange: { QQ: 1, JTs: 0.75 },
  board: "Ah Kd 9c",
  pot: "55",
  effectiveStacks: "1000",
  allinThresholdPct: "70",
  addAllinCapPct: "250",
  maxRaises: "",
  preflopAggressor: "ip",
  oop: {
    flop: { bet: "33", raise: "", donk: "75", addAllin: false, noThreeBet: false },
    turn: { bet: "", raise: "60", donk: "30", addAllin: true, noThreeBet: false },
    river: { bet: "30 66 125", raise: "a", donk: "25,50", addAllin: false, noThreeBet: true },
  },
  ip: {
    flop: { bet: "25", raise: "a", donk: "", addAllin: true, noThreeBet: true },
    turn: { bet: "75", raise: "", donk: "", addAllin: false, noThreeBet: true },
    river: { bet: "a", raise: "100", donk: "", addAllin: true, noThreeBet: false },
  },
  runSampledCore: true,
  sampling: true,
  updateRule: "cfr_plus",
});

/** Four seats on a turn, explicit sampled-core knobs. */
const multiway = (): BuilderState => ({
  ...DEFAULT_BUILDER,
  oopRange: { AA: 1 },
  ipRange: { QQ: 1, "72o": 0.125 },
  midRanges: [{ KK: 1 }, { JJ: 0.5 }],
  board: "Ah Kd 9c 2s",
  maxRaises: "2",
  advancedSolver: true,
  sampledAbstraction: "histogram",
  timeBudgetMinutes: "3",
});

/** Three seats on a flop, planner-chosen core, annealed QRE. */
const planned = (): BuilderState => ({
  ...DEFAULT_BUILDER,
  oopRange: { AA: 1 },
  ipRange: { QQ: 1 },
  midRanges: [{ KK: 1 }],
  board: "Ah Kd 9c",
  updateRule: "qre",
  qreAnneal: true,
});

test("buildEngineConfig(DEFAULT_BUILDER).config is byte-identical to before the refactor", () => {
  expect(JSON.stringify(buildEngineConfig(DEFAULT_BUILDER).config)).toBe(snapshots.def);
});

test("non-default heads-up, multiway and planned configs are byte-identical", () => {
  expect(JSON.stringify(buildEngineConfig(richHu()))).toBe(snapshots.rich);
  expect(JSON.stringify(buildEngineConfig(multiway()))).toBe(snapshots.multi);
  expect(JSON.stringify(buildEngineConfig(planned()))).toBe(snapshots.planned);
});
