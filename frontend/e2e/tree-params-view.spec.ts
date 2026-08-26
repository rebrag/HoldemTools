// Pure-function tests for the TreeParams <-> shared-view adapter. No browser,
// same harness as money-units.spec.ts.
//
// The theorem this file exists to state: splitting TreeParams into the shared
// panel's view model and merging it back must produce config text that is
// byte-identical to what the un-split params produce. The watcher pastes that
// text VERBATIM into PioSOLVER, so a drift is a silent solve corruption, not a
// visible bug.
//
// Note this holds independently of the UI - it is a property of the adapter
// alone, which is why it can be verified before the modal is migrated.
import { test, expect } from "@playwright/test";
import {
  DEFAULT_TREE_SIZES,
  buildTreeConfigText,
  cloneTreeSizes,
  parseRangeText,
  type TreeParams,
} from "../src/lib/solver/treeConfig";
import {
  mergeTreeParams,
  splitTreeParams,
} from "../src/lib/solver/treeParamsView";

/* These run once, not per browser project. */
test.skip(({ isMobile }) => !!isMobile, "pure logic - desktop project only");

const FLOP = ["Ah", "Kd", "9c"];

/** A preflop-sim upload: the exact shape handleActionClick builds. Mirrors
 *  simParams() in money-units.spec.ts so both files pin the same baseline. */
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

/** A recorded hand in its own money at a NON-100 scale - the $25 pot / $738
 *  stack case from money-units.spec.ts, where chipScale lands on 10. */
const handParams = (): TreeParams => ({
  ...simParams(),
  potChips: 250,
  effectiveStackChips: 7380,
  chipScale: 10,
  oop: {
    flop: { betSize: "33", raiseSize: "50", addAllin: true },
    turn: { betSize: "66", raiseSize: "a", donkBetSize: "40", addAllin: false },
    river: { betSize: "30 66", raiseSize: "a", donkBetSize: "25", addAllin: true },
  },
  ip: cloneTreeSizes(DEFAULT_TREE_SIZES.ip),
});

/** Every optional field absent on at least one street, so the `undefined` <->
 *  "" collapse is exercised in both directions. */
const sparseParams = (): TreeParams => ({
  ...simParams(),
  oop: {
    flop: { addAllin: false },
    turn: { raiseSize: "50", addAllin: true },
    river: { betSize: "75", addAllin: false },
  },
  ip: {
    flop: { betSize: "33", addAllin: true },
    turn: { addAllin: false },
    river: { betSize: "50", raiseSize: "a", addAllin: true },
  },
});

const icmParams = (): TreeParams => ({
  ...simParams(),
  icm: { enabled: true, payoutsLiteral: "50\\n30\\n20", stacksLiteral: "2100\\n2100\\n2250" },
});

const FIXTURES: [string, () => TreeParams][] = [
  ["preflop sim", simParams],
  ["recorded hand at chipScale 10", handParams],
  ["sparse sizes", sparseParams],
  ["ICM enabled", icmParams],
];

for (const [name, make] of FIXTURES) {
  test(`split -> merge is byte-identical for ${name}`, () => {
    const params = make();
    const { view, carry } = splitTreeParams(params, FLOP);
    const back = mergeTreeParams(carry, view);

    expect(buildTreeConfigText(back.params, back.boardCards)).toBe(
      buildTreeConfigText(params, FLOP)
    );
    expect(back.boardCards).toEqual(FLOP);
  });

  test(`the chip scale survives untouched for ${name}`, () => {
    const params = make();
    const { view, carry } = splitTreeParams(params, FLOP);

    // Editing the pot must NOT move the scale: the seat stacks and the ICM
    // stacks literal were scaled with the original and are not editable here.
    const edited = { ...view, pot: String(Number(view.pot) * 3 + 7) };
    const back = mergeTreeParams(carry, edited);

    expect(back.params.chipScale).toBe(params.chipScale);
    expect(back.params.icm).toEqual(params.icm);
    expect(back.params.mergeSimilarBets).toBe(params.mergeSimilarBets);
    expect(back.params.mergeSimilarBetsThreshold).toBe(params.mergeSimilarBetsThreshold);
  });
}

test("display money round-trips through the frozen scale", () => {
  const params = handParams();
  const { view, carry } = splitTreeParams(params, FLOP);

  // 250 chips at 10 per unit is $25; 7380 is $738.
  expect(view.pot).toBe("25");
  expect(view.effectiveStacks).toBe("738");

  const back = mergeTreeParams(carry, view);
  expect(back.params.potChips).toBe(params.potChips);
  expect(back.params.effectiveStackChips).toBe(params.effectiveStackChips);
});

test("an unparseable threshold falls back to the original value", () => {
  const params = simParams();
  const { view, carry } = splitTreeParams(params, FLOP);

  const back = mergeTreeParams(carry, { ...view, allinThresholdPct: "", addAllinCapPct: "abc" });
  expect(back.params.allinThreshold).toBe(params.allinThreshold);
  expect(back.params.addAllinOnlyIfLessThanThisTimesThePot).toBe(
    params.addAllinOnlyIfLessThanThisTimesThePot
  );
});

test("a whitespace-only size is preserved, not trimmed away", () => {
  // treeConfig.ts gates each line on plain truthiness of the UNTRIMMED string,
  // so " " still emits its line. The adapter must not normalise it or the
  // emitted text would change.
  const params: TreeParams = {
    ...simParams(),
    oop: { ...cloneTreeSizes(DEFAULT_TREE_SIZES.oop), flop: { betSize: " ", addAllin: false } },
  };
  const { view, carry } = splitTreeParams(params, FLOP);
  expect(view.oop.flop.bet).toBe(" ");

  const back = mergeTreeParams(carry, view);
  expect(back.params.oop.flop.betSize).toBe(" ");
  expect(buildTreeConfigText(back.params, back.boardCards)).toBe(
    buildTreeConfigText(params, FLOP)
  );
});

test("an absent size stays absent rather than becoming an empty line", () => {
  const params = sparseParams();
  const { view, carry } = splitTreeParams(params, FLOP);

  expect(view.oop.flop.bet).toBe("");
  const back = mergeTreeParams(carry, view);
  expect(back.params.oop.flop.betSize).toBeUndefined();
  expect(buildTreeConfigText(back.params, back.boardCards)).not.toContain(
    "#FlopConfig.BetSize#"
  );
});
