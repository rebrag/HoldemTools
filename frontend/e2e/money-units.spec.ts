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
  betPotPct,
  currentStreetCommitChips,
  formatPioAction,
  potSplitChips,
  preflopCommitChips,
  priorStreetCommitChips,
  stackBehindChips,
} from "../src/lib/solver/postflopNode";
import { matchPlayedOption, type ActualAction } from "../src/lib/solver/handActualLine";
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
   - the numbers here are meaningless, the exact lines are the point.
   (Deliberate default change captured here: every street now carries a
   BetSize, with the flop defaulting to 33 for both seats.) */
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
  "#FlopConfig.BetSize#33",
  "#FlopConfig.RaiseSize#33",
  "#FlopConfig.AddAllin#True",
  "#TurnConfig.BetSize#50",
  "#TurnConfig.RaiseSize#a",
  "#TurnConfig.AddAllin#True",
  "#RiverConfig.BetSize#30 66",
  "#RiverConfig.RaiseSize#a",
  "#RiverConfig.AddAllin#True",
  "#RiverConfig.DonkBetSize#30",
  "#FlopConfigIP.BetSize#33",
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

/* Pio's bNNN segments are hand-cumulative: a player's whole postflop
   investment, never resetting at a street boundary. The numbers below are a
   real solved hand (chipScale 10, $67 flop pot): flop went bet $20.1 /
   raise to $74.8 / call, and the turn bet segment reads b2741 = 748 carried
   from the flop + 1993 actually bet. The viewer used to re-add the flop money
   and display "Bet 274.1" for a $199.3 bet. */
const TURN_NODE = "r:0:c:b201:b748:c:7s";
const RIVER_NODE = "r:0:c:b201:b748:c:7s:b2741:c:2h";

test("prior-street commit is the cumulative carry, not a per-street sum", () => {
  expect(priorStreetCommitChips(TURN_NODE)).toBe(748);
  // Two betting streets: the last cumulative value, not 748 + 2741.
  expect(priorStreetCommitChips(RIVER_NODE)).toBe(2741);
  // A check-through street has no bet segment; the carry persists.
  expect(priorStreetCommitChips("r:0:b201:c:7s:c:c:2h")).toBe(201);
});

test("live street bets subtract the carry from the cumulative segment", () => {
  expect(currentStreetCommitChips(`${TURN_NODE}:b2741`)).toEqual({ oop: 1993, ip: 0 });
  // A call matches the outstanding street-relative bet.
  expect(currentStreetCommitChips(`${TURN_NODE}:b2741:c`)).toEqual({
    oop: 1993,
    ip: 1993,
  });
});

test("turn and river labels show the street's bet, not the hand total", () => {
  expect(formatPioAction("b2741", TURN_NODE, 6000, 10)).toBe("Bet 199.3");
  // Facing the turn bet, a raise label is street-relative too.
  expect(formatPioAction("b6000", `${TURN_NODE}:b2741`, 12000, 10)).toBe(
    "Raise to 525.2"
  );
  // Sims share the node-id format, so the bb branch subtracts the carry too.
  expect(formatPioAction("b300", "r:0:b100:c:7s", null)).toBe("Bet 2bb");
  // Donk flop then check-through turn: the carry survives to the river.
  expect(formatPioAction("b1200", "r:0:b201:c:7s:c:c:2h", 6000, 10)).toBe("Bet 99.9");
});

test("ALLIN on later streets compares cumulative against cumulative", () => {
  expect(formatPioAction("b6000", TURN_NODE, 6000, 10)).toBe("ALLIN");
  expect(formatPioAction("b5999", TURN_NODE, 6000, 10)).toBe("ALLIN");
  // The old street-relative rule flagged exactly this bet as ALLIN
  // (6000 - 748 = 5252); it leaves 748 chips behind and is just a bet.
  expect(formatPioAction("b5252", TURN_NODE, 6000, 10)).toBe("Bet 450.4");
});

/* The percent a line card prints beside a bet's amount. The numbers below are
 * taken off a reference solver's own strip for a 5.5bb (550-chip) flop pot, so
 * they pin the convention as much as the arithmetic: a bet is measured against
 * the pot, a raise is the raise-BY amount against the pot after the call. */
test("bet percentages are measured against the pot the bet goes into", () => {
  // Flop, 5.5bb pot: a 1.8bb bet is a third of it, a 5.7bb bet is a pot bet.
  expect(betPotPct("b180", "r:0", 550, 8000)).toBe(33);
  expect(betPotPct("b570", "r:0", 550, 8000)).toBe(104);
  // Raising to 9.1 over a 1.8 bet: 7.3 into 5.5 + 1.8 + 1.8 = 9.1.
  expect(betPotPct("b910", "r:0:b180", 550, 8000)).toBe(80);
  // Turn, after that 1.8 bet was called: the pot is 9.1 and the carry is out.
  expect(betPotPct("b1640", "r:0:b180:c:6h", 550, 8000)).toBe(160);
  expect(betPotPct("b790", "r:0:b180:c:6h", 550, 8000)).toBe(67);
});

test("only bets and raises carry a percentage", () => {
  // Fold, check and call are not a size choice; an all-in has no amount on
  // its label, so it gets no percentage either.
  expect(betPotPct("f", "r:0:b180", 550, 8000)).toBeNull();
  expect(betPotPct("c", "r:0", 550, 8000)).toBeNull();
  expect(betPotPct("c", "r:0:b180", 550, 8000)).toBeNull();
  expect(betPotPct("b8000", "r:0", 550, 8000)).toBeNull();
  // A solve with no recorded pot prints the amount alone.
  expect(betPotPct("b180", "r:0", null, 8000)).toBeNull();
  expect(betPotPct("b180", "r:0", 0, 8000)).toBeNull();
});

test("pot math no longer re-adds completed streets", () => {
  // Turn pot: 670 + 2 x 748 = 2166 chips (216.6 display).
  expect(potSplitChips(TURN_NODE, 670).potChips).toBe(2166);
  // River pot after the called turn bet: 670 + 2 x 2741, not 670 + 2 x 3489.
  expect(potSplitChips(RIVER_NODE, 670).potChips).toBe(6152);
  // Live turn bets sit in front of the seats until matched.
  expect(potSplitChips(`${TURN_NODE}:b2741`, 670)).toEqual({
    potChips: 2166,
    oopChips: 1993,
    ipChips: 0,
  });
  // Stacks behind on a multi-street line: carry once, live bet once.
  expect(stackBehindChips(`${TURN_NODE}:b2741`, "oop", 15000, 400)).toBe(
    15000 - 400 - 748 - 1993
  );
});

/* The PLAYED hint: solver sizes are whole-percent-of-pot discretizations of
   the hand's real amounts, so the matcher picks the closest sized option and
   accepts it within 20% - never a wildly different size. */
const bet = (amount: number, allIn = false): ActualAction => ({
  kind: "bet",
  amount,
  allIn,
});

test("played-action matching picks the closest size within tolerance", () => {
  const options = ["Check", "Bet 15", "Bet 20.1", "Bet 33.5"];
  expect(matchPlayedOption(options, bet(20))).toBe("Bet 20.1");
  expect(matchPlayedOption(["Check", "Bet 199.3"], bet(200))).toBe("Bet 199.3");
  expect(matchPlayedOption(["Fold", "Call", "Raise to 74.8"], {
    kind: "raise",
    amount: 75,
    allIn: false,
  })).toBe("Raise to 74.8");
  // Nothing near the actual size: no claim.
  expect(matchPlayedOption(options, bet(60))).toBeNull();
  // The 20% cap is relative, so big bets keep proportional slack.
  expect(matchPlayedOption(["Bet 240"], bet(200))).toBe("Bet 240");
  expect(matchPlayedOption(["Bet 245"], bet(200))).toBeNull();
});

test("played-action matching handles the non-sized labels", () => {
  expect(matchPlayedOption(["Check", "Bet 20.1"], { kind: "check", amount: null, allIn: false })).toBe("Check");
  expect(matchPlayedOption(["Fold", "Call"], { kind: "fold", amount: null, allIn: false })).toBe("Fold");
  expect(matchPlayedOption(["Fold", "Call"], { kind: "call", amount: null, allIn: false })).toBe("Call");
  // A call facing a raise where an aggressive ALLIN option is also on the
  // node: the call is the Call branch, never the shove.
  expect(matchPlayedOption(["ALLIN", "Call", "Fold"], { kind: "call", amount: null, allIn: false })).toBe("Call");
  // Calling a shove in a tree whose call branch is labeled ALLIN.
  expect(matchPlayedOption(["Fold", "ALLIN"], { kind: "call", amount: null, allIn: true })).toBe("ALLIN");
  // An all-in bet matches the ALLIN label directly, whatever its size.
  expect(matchPlayedOption(["Check", "ALLIN"], bet(612, true))).toBe("ALLIN");
  // No matching label at the node: no claim.
  expect(matchPlayedOption(["Bet 20.1"], { kind: "check", amount: null, allIn: false })).toBeNull();
});
