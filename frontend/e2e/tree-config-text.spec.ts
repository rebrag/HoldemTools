// Pure-function tests for the /compare tree-config layer. No browser: Playwright
// is the only test runner in this repo and these modules are plain TS, so they
// run as ordinary assertions under the same harness as money-units.spec.ts.
//
// These goldens were captured from the pre-refactor implementation and pin the
// two things that leave the app:
//   1. serializeTreeConfigText - PioViewer clipboard text. A user copies this
//      and pastes it into PioViewer's tree builder, so ordering, spacing and
//      the range-token shorthand are load-bearing, not cosmetic.
//   2. buildEngineConfig - the htsolver JSON posted to /api/enginecompare.
//
// Neither had any coverage before, which made the shared-TreeBuilding refactor
// unverifiable. Anything that changes a byte here changes what a solver sees.
import { test, expect } from "@playwright/test";
import {
  DEFAULT_BUILDER,
  buildEngineConfig,
  type BuilderState,
} from "../src/pages/compare/builderState";
import {
  parseRangeTokens,
  parseTreeConfigText,
  serializeRangeTokens,
  serializeTreeConfigText,
} from "../src/pages/compare/treeConfigText";

/* These run once, not per browser project. */
test.skip(({ isMobile }) => !!isMobile, "pure logic - desktop project only");

const FULL_RANGE_TOKENS =
  "AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AK,AQ,AJ,AT,A9,A8,A7,A6,A5,A4,A3,A2," +
  "KQ,KJ,KT,K9,K8,K7,K6,K5,K4,K3,K2,QJ,QT,Q9,Q8,Q7,Q6,Q5,Q4,Q3,Q2,JT,J9,J8,J7," +
  "J6,J5,J4,J3,J2,T9,T8,T7,T6,T5,T4,T3,T2,98,97,96,95,94,93,92,87,86,85,84,83," +
  "82,76,75,74,73,72,65,64,63,62,54,53,52,43,42,32";

const DEFAULT_GOLDEN = [
  "#Type#NoLimit",
  `#Range0#${FULL_RANGE_TOKENS}`,
  `#Range1#${FULL_RANGE_TOKENS}`,
  "#Board#9c 5d Jc 7s 9h",
  "#Pot#100",
  "#EffectiveStacks#400",
  "#AllinThreshold#90",
  "#AddAllinOnlyIfLessThanThisTimesThePot#300",
  "#FlopConfig.BetSize#50",
  "#FlopConfig.RaiseSize#100",
  "#FlopConfig.AddAllin#True",
  "#TurnConfig.BetSize#50",
  "#TurnConfig.RaiseSize#100",
  "#TurnConfig.AddAllin#True",
  "#RiverConfig.BetSize#50 100",
  "#RiverConfig.RaiseSize#100",
  "#RiverConfig.AddAllin#True",
  "#FlopConfigIP.BetSize#50",
  "#FlopConfigIP.RaiseSize#100",
  "#FlopConfigIP.AddAllin#True",
  "#TurnConfigIP.BetSize#50",
  "#TurnConfigIP.RaiseSize#100",
  "#TurnConfigIP.AddAllin#True",
  "#RiverConfigIP.BetSize#50 100",
  "#RiverConfigIP.RaiseSize#100",
  "#RiverConfigIP.AddAllin#True",
].join("\n");

/** Every emit branch at once: an empty bet box, AddAllin off, an OOP donk on
 *  turn and river, IP noThreeBet (which has NO representation in Pio's format),
 *  fractional weights, a suited/offsuit pair that collapses, and one that does
 *  not because the two weights differ. */
const richBuilder = (): BuilderState => ({
  ...DEFAULT_BUILDER,
  oopRange: { AA: 1, KK: 0.5, AKs: 0.25, AKo: 0.25, T4s: 1, T4o: 1, "72o": 0.125 },
  ipRange: { QQ: 1, JTs: 0.75 },
  board: "Ah Kd 9c",
  pot: "55",
  effectiveStacks: "1000",
  allinThresholdPct: "70",
  addAllinCapPct: "250",
  oop: {
    flop: { bet: "33", raise: "", donk: "", addAllin: false, noThreeBet: false },
    turn: { bet: "", raise: "60", donk: "30", addAllin: true, noThreeBet: false },
    river: { bet: "30 66 125", raise: "a", donk: "25,50", addAllin: false, noThreeBet: false },
  },
  ip: {
    flop: { bet: "25", raise: "a", donk: "", addAllin: true, noThreeBet: true },
    turn: { bet: "75", raise: "", donk: "", addAllin: false, noThreeBet: true },
    river: { bet: "a", raise: "100", donk: "", addAllin: true, noThreeBet: false },
  },
});

const RICH_GOLDEN = [
  "#Type#NoLimit",
  "#Range0#AA,KK:0.5,AK:0.25,T4,72o:0.125",
  "#Range1#QQ,JTs:0.75",
  "#Board#Ah Kd 9c",
  "#Pot#55",
  "#EffectiveStacks#1000",
  "#AllinThreshold#70",
  "#AddAllinOnlyIfLessThanThisTimesThePot#250",
  // Empty raise/donk emit nothing; AddAllin off emits nothing.
  "#FlopConfig.BetSize#33",
  // An empty bet emits nothing, but the street still carries raise + donk.
  "#TurnConfig.RaiseSize#60",
  "#TurnConfig.AddAllin#True",
  "#TurnConfig.DonkBetSize#30",
  "#RiverConfig.BetSize#30 66 125",
  "#RiverConfig.RaiseSize#a",
  "#RiverConfig.DonkBetSize#25,50",
  // IP never emits a donk line, and noThreeBet has no key at all.
  "#FlopConfigIP.BetSize#25",
  "#FlopConfigIP.RaiseSize#a",
  "#FlopConfigIP.AddAllin#True",
  "#TurnConfigIP.BetSize#75",
  "#RiverConfigIP.BetSize#a",
  "#RiverConfigIP.RaiseSize#100",
  "#RiverConfigIP.AddAllin#True",
].join("\n");

test("default tree config text is byte-identical to the shipped output", () => {
  expect(serializeTreeConfigText(DEFAULT_BUILDER)).toBe(DEFAULT_GOLDEN);
});

test("every emit branch is byte-identical to the shipped output", () => {
  expect(serializeTreeConfigText(richBuilder())).toBe(RICH_GOLDEN);
});

test("serialize -> parse round-trips the betting structure", () => {
  const rich = richBuilder();
  const back = parseTreeConfigText(serializeTreeConfigText(rich));

  expect(back.oop).toEqual(rich.oop);
  // noThreeBet is deliberately NOT in PioViewer's format, so it cannot survive
  // a round trip. The panel warns about exactly this rather than emitting a
  // guessed key that would fail to paste back into PioViewer.
  expect(back.ip).toEqual({
    flop: { ...rich.ip.flop, noThreeBet: false },
    turn: { ...rich.ip.turn, noThreeBet: false },
    river: rich.ip.river,
  });
});

test("serialize -> parse round-trips the spot", () => {
  const rich = richBuilder();
  const back = parseTreeConfigText(serializeTreeConfigText(rich));

  expect(back.spot).toEqual({
    oopRange: rich.oopRange,
    ipRange: rich.ipRange,
    board: rich.board,
    pot: rich.pot,
    effectiveStacks: rich.effectiveStacks,
    allinThresholdPct: rich.allinThresholdPct,
    addAllinCapPct: rich.addAllinCapPct,
  });
});

test("range tokens collapse a matched suited/offsuit pair and split a mismatched one", () => {
  // Same weight -> one rankless token; different weights -> both, suffixed.
  expect(serializeRangeTokens({ T4s: 1, T4o: 1 })).toBe("T4");
  expect(serializeRangeTokens({ T4s: 1, T4o: 0.5 })).toBe("T4s,T4o:0.5");
  expect(parseRangeTokens("T4")).toEqual({ T4s: 1, T4o: 1 });
  expect(parseRangeTokens("T4s,T4o:0.5")).toEqual({ T4s: 1, T4o: 0.5 });
  // Pio writes the higher rank first; a hand-typed range may not.
  expect(parseRangeTokens("4To")).toEqual({ T4o: 1 });
});

test("htsolver config is byte-identical to the shipped output", () => {
  const small: BuilderState = {
    ...DEFAULT_BUILDER,
    oopRange: { AA: 1, KK: 0.5 },
    ipRange: { QQ: 1 },
    board: "Ah Kd 9c 2s",
  };
  const { config, pioAccuracyPct } = buildEngineConfig(small);

  expect(pioAccuracyPct).toBe(0.02);
  expect(config).toEqual({
    schema: 1,
    game: "nlhe",
    board: "Ah Kd 9c 2s",
    pot: 100,
    chip_scale: 100,
    players: [
      { seat: "OOP", stack: 400, range: "AA:1,KK:0.5" },
      { seat: "IP", stack: 400, range: "QQ:1" },
    ],
    // A 4-card board is a turn solve: flop is excluded, river always present.
    bet_sizing: {
      turn: {
        ip: { bets: [50, 10000], raises: [100, 10000], no_3bet: false },
        oop: { bets: [50, 10000], donks: [], raises: [100, 10000], no_3bet: false },
        allin_threshold: 0.9,
        max_raises: 3,
      },
      river: {
        ip: { bets: [50, 100, 10000], raises: [100, 10000], no_3bet: false },
        oop: {
          bets: [50, 100, 10000],
          donks: [],
          raises: [100, 10000],
          no_3bet: false,
        },
        allin_threshold: 0.9,
        max_raises: 3,
      },
    },
    preflop_aggressor: "none",
    algorithm: { update: "dcfr" },
    qre: { mode: "nash" },
    budget: { iterations: 20000, target_exploitable_pct: 0.02, checkpoint_every: 250 },
    memory_limit_gb: 12,
    threads: 0,
  });
});
