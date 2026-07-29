// Pure-function tests for the money-unit layer. No browser: Playwright is the
// only test runner in this repo, and these modules are plain TS, so they run
// as ordinary assertions under the same harness.
//
// Two things are pinned here:
//   1. The tree text a preflop-sim solve produces, byte for byte. Everything
//      about the chip-scale work is built on "sims keep working exactly as
//      today", and the watcher pastes this text verbatim into PioSOLVER, so a
//      whitespace or ordering drift is a silent solve corruption.
//   2. The chips <-> display-money conversions, at every scale.
import { test, expect } from "@playwright/test";
import {
  DEFAULT_TREE_SIZES,
  buildTreeConfigText,
  cloneTreeSizes,
  parseRangeText,
  pickChipScale,
  type TreeParams,
} from "../src/lib/solver/treeConfig";
import {
  formatPioAction,
  preflopCommitChips,
  stackBehindChips,
} from "../src/lib/solver/postflopNode";
import { fmtMoney } from "../src/pages/solver/boardDisplay";

/* These run once, not per browser project. */
test.skip(({ isMobile }) => !!isMobile, "pure logic - desktop project only");

/** A solver-page (preflop sim) upload: the exact shape handleActionClick builds. */
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
  icm: {
    enabled: false,
    payoutsLiteral: "0\\n0\\n0",
    stacksLiteral: "2100\\n2100\\n2250",
  },
});

/* Captured from the shipped implementation. If a change to treeConfig.ts makes
   this fail, the sim solve path has changed and that is almost certainly a bug
   - the numbers here are meaningless, the exact lines are the point. */
const SIM_GOLDEN = [
  "#Type#NoLimit",
  "#Range0#22:1,33:0.169,AA:1",
  "#Range1#KK:1,QQ:0.75",
  "#ICM.ICMFormat#Pio ICM structure",
  "#ICM.Payouts#0\\n0\\n0",
  "#ICM.Stacks#2100\\n2100\\n2250",
  "#Board#Ah Kd 9c",
  "#Pot#550",
  "#EffectiveStacks#2100",
  "#AllinThreshold#60",
  "#AddAllinOnlyIfLessThanThisTimesThePot#250",
  "#MergeSimilarBets#True",
  "#MergeSimilarBetsThreshold#12",
  "#CapEnabled#True",
  "#CapMode#NoLimit",
  "#FlopConfig.RaiseSize#33",
  "#FlopConfig.AddAllin#True",
  "#TurnConfig.BetSize#50",
  "#TurnConfig.RaiseSize#a",
  "#TurnConfig.AddAllin#True",
  "#RiverConfig.BetSize#30 66",
  "#RiverConfig.RaiseSize#a",
  "#RiverConfig.AddAllin#True",
  "#RiverConfig.DonkBetSize#30",
  "#FlopConfigIP.BetSize#25",
  "#FlopConfigIP.RaiseSize#a",
  "#FlopConfigIP.AddAllin#True",
  "#TurnConfigIP.BetSize#50",
  "#TurnConfigIP.RaiseSize#a",
  "#TurnConfigIP.AddAllin#True",
  "#RiverConfigIP.BetSize#30 66",
  "#RiverConfigIP.RaiseSize#a",
  "#RiverConfigIP.AddAllin#True",
].join("\n");

test("sim tree config text is byte-identical to the shipped output", () => {
  expect(buildTreeConfigText(simParams(), ["Ah", "Kd", "9c"])).toBe(SIM_GOLDEN);
});

test("ICM sims insert #ICM.Enabled# and keep every other line in place", () => {
  const params = simParams();
  params.icm.enabled = true;
  const lines = buildTreeConfigText(params, ["Ah", "Kd", "9c"]).split("\n");
  expect(lines[4]).toBe("#ICM.Enabled#True");
  expect(lines.filter((l) => l !== "#ICM.Enabled#True").join("\n")).toBe(SIM_GOLDEN);
});

test("action labels are lossless at every chip scale", () => {
  // Scale 100 (a cash hand in cents): two cents apart must stay two labels.
  // toFixed(1) used to collapse both of these to "13.4", and because the label
  // is a JsonData key the second silently overwrote the first.
  expect(formatPioAction("b1337", "r:0", null, 100)).toBe("Bet 13.37");
  expect(formatPioAction("b1342", "r:0", null, 100)).toBe("Bet 13.42");

  // Scale 10 and 1 need fewer decimals, and trailing zeros are trimmed.
  expect(formatPioAction("b1500", "r:0", null, 10)).toBe("Bet 150");
  expect(formatPioAction("b1505", "r:0", null, 10)).toBe("Bet 150.5");
  expect(formatPioAction("b1500", "r:0", null, 1)).toBe("Bet 1500");

  // Sims keep the bb suffix and their existing one-decimal rounding.
  expect(formatPioAction("b138", "r:0", null)).toBe("Bet 1.4bb");
});

test("action labels never carry a thousands separator", () => {
  // lib/solver/utils.ts betSize() reads the first number out of the label;
  // "Bet 1,200" would parse as 1 and wreck the colour ramp and ordering.
  expect(formatPioAction("b2500000", "r:0", null, 1)).toBe("Bet 2500000");
});

test("ALLIN detection is scale independent", () => {
  // remaining = effective stack; a bet within one raw Pio chip is all-in.
  expect(formatPioAction("b2100", "r:0", 2100, 100)).toBe("ALLIN");
  expect(formatPioAction("b2099", "r:0", 2100, 1)).toBe("ALLIN");
  expect(formatPioAction("b1000", "r:0", 2100, 100)).toBe("Bet 10");
});

test("raises facing a bet read as 'Raise to'", () => {
  expect(formatPioAction("b800", "r:0:b300", null, 100)).toBe("Raise to 8");
});

test("chip scale keeps amounts whole and the pot precise", () => {
  // Pot floor 500 chips, and every amount has to survive the scaling.
  expect(pickChipScale([11, 97.5, 200], 11)).toBe(100); // $1/$2 cash
  expect(pickChipScale([150, 700, 2000], 150)).toBe(10); // $3/$5 cash
  expect(pickChipScale([600, 5000], 600)).toBe(1); // whole chips, pot big enough
  expect(pickChipScale([1500, 25000], 1500)).toBe(1); // tournament
  // Micro stakes need a deeper scale to clear the pot floor at all.
  expect(pickChipScale([0.11, 2], 0.11)).toBe(10000);
  // Thousandths are expressible, but only as far as the 16-bit ceiling allows:
  // 100 at x1000 would be 100000, so this settles for x100 and rounds.
  expect(pickChipScale([12.345, 100], 12.345)).toBe(100);
});

/* PioSOLVER stores the pot and both stacks in 16 bits and refuses the tree
   above 65535 - "consider dividing stacks/pot by 10 or 100". This is the bug
   that killed three real solves: a $735 effective stack at 100 chips per dollar
   is 73500, and PioViewer rejected it outright at set_eff_stack. */
test("no scale is ever chosen that breaks Pio's 16-bit chip limit", () => {
  // The exact hand that failed: $31 flop pot, $735 effective, $1985 deepest seat.
  const scale = pickChipScale([31, 735, 1985], 31);
  expect(735 * scale).toBeLessThanOrEqual(65535);
  expect(1985 * scale).toBeLessThanOrEqual(65535);
  expect(scale).toBe(10);

  // The ceiling holds across the range, including hands played for more chips
  // than Pio can hold at all, where the scale has to drop below 1.
  for (const [values, pot] of [
    [[11, 97.5], 11],
    [[150, 700], 150],
    [[31, 735, 1985], 31],
    [[1500, 25000], 1500],
    [[8000, 250000], 8000], // deep MTT: needs a fraction of a chip per unit
    [[50000, 3_000_000], 50000], // absurdly deep
  ] as [number[], number][]) {
    const s = pickChipScale(values, pot);
    for (const v of [...values, pot]) {
      expect(Math.round(v * s)).toBeLessThanOrEqual(65535);
    }
  }
});

/* Bigger is better: Pio rounds bets to whole chips, so the scale should spend
   all the headroom the limit allows rather than settle for merely adequate. */
test("the scale is the largest one that fits, never merely a workable one", () => {
  for (const [values, pot] of [
    [[11, 97.5], 11],
    [[25, 738], 25],
    [[150, 700, 2000], 150],
    [[600, 5000], 600],
    [[1500, 25000], 1500],
    [[8000, 250000], 8000],
  ] as [number[], number][]) {
    const scale = pickChipScale(values, pot);
    const largest = Math.max(...values, pot);
    // One rung further up would break the limit, so this rung is maximal.
    expect((pot + 2 * largest) * scale * 10).toBeGreaterThan(65535);
    for (const v of [...values, pot]) {
      expect(Math.round(v * scale)).toBeLessThanOrEqual(65535);
    }
  }
});

/* The scale exists only so Pio gets whole numbers. It must never reach the
   screen: the solution has to read back in the amounts the hand was played for. */
test("the viewer shows the hand's own amounts, not the scaled chips", () => {
  const scale = pickChipScale([25, 738], 25); // x10, so the config is in dimes
  const money = { mode: "money" as const, bbSize: 5 };

  expect(fmtMoney(250 / scale, money)).toBe("25"); // the $25 pot
  expect(fmtMoney(7380 / scale, money)).toBe("738"); // the $738 stack
  // A $12 bet into that pot is 120 chips, and reads back as the amount bet.
  expect(formatPioAction("b120", "r:0", null, scale)).toBe("Bet 12");
  // Cents survive too, at whatever precision the scale carries.
  expect(formatPioAction("b125", "r:0", null, scale)).toBe("Bet 12.5");
  // And the same solve can still be read in big blinds on demand.
  expect(fmtMoney(250 / scale, { mode: "bb", bbSize: 5 })).toBe("5 bb");
});

/* The reported failure: a $25 pot with $738 effective went out as #Pot#2500 /
   #EffectiveStacks#73800, and Pio refused 73800 at set_eff_stack. */
test("a $25 pot with a $738 stack fits inside Pio's limit", () => {
  const scale = pickChipScale([25, 738], 25);
  expect(scale).toBe(10);
  expect(Math.round(25 * scale)).toBe(250);
  expect(Math.round(738 * scale)).toBe(7380);
  // What it used to emit, for the record.
  expect(738 * 100).toBeGreaterThan(65535);
});

test("preflop commit and stack-behind math follow the scale", () => {
  // A $150/$100 hand at scale 10: stacks_map tokens are display money, so the
  // starting stack is 150 * 10 = 1500 Pio chips and 400 of them went in preflop.
  expect(preflopCommitChips({ SB: 150, BTN: 100 }, ["SB", "BTN"], 600, 10)).toBe(400);
  // Sims (default scale) read the tokens as bb.
  expect(preflopCommitChips({ SB: 25, BB: 25 }, ["SB", "BB"], 2100, 100)).toBe(400);
  // Missing effective stack means "unknown", never a wrong number.
  expect(preflopCommitChips({ SB: 150, BTN: 100 }, ["SB", "BTN"], null, 10)).toBe(0);

  // stackBehindChips is pure chips in / chips out, so it is unit agnostic.
  expect(stackBehindChips("r:0:b300", "oop", 1500, 400)).toBe(800);
});
