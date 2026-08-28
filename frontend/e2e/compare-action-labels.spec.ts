// Pure-function tests for /compare's action-label formatter and its line
// walker. No browser, same harness as tree-config-text.spec.ts.
//
// These exist because the two things they pin are invisible in a payload
// written before the fix and expensive to reproduce by hand: an ALLIN label
// needs `effective_stack` in the .htc spot (added to engine_compare.py's spot
// block), and prior-street netting only shows up on a multi-street tree. Both
// were shipped as COLOUR bugs rather than text bugs, which is exactly the kind
// of thing a golden catches and an eyeball does not:
//
//   - "ALLIN" is the only string solver/utils' isAllin matches, and it is what
//     moves a jam out of the bet ramp into its flat dark red. Because
//     spreadRamp's gap is min(0.19, 1/(n-1)), leaving the jam IN the ramp also
//     re-shades every other bet at that node.
//   - bNNN is hand-cumulative, so without netting a river bet reads as the
//     whole hand's commitment and lands far too dark.
import { test, expect } from "@playwright/test";
import { displayLabelWith } from "../src/pages/compare/actionLabels";
import { buildCompareLine, buildChildIndex } from "../src/pages/compare/compareLineNodes";

/* These run once, not per browser project. */
test.skip(({ isMobile }) => !!isMobile, "pure logic - desktop project only");

/** The turn benchmark's shape: pot 100, stacks 400, bets 50/400, raise 1000. */
const label = displayLabelWith(400);
/** A payload written before engine_compare.py carried the stack. */
const labelNoStack = displayLabelWith(undefined);

test("a bet that commits the effective stack is ALLIN", () => {
  expect(label("b400", "r:0")).toBe("ALLIN");
  // One chip of tolerance, the smallest amount a solve can express.
  expect(label("b399", "r:0")).toBe("ALLIN");
  expect(label("b398", "r:0")).toBe("Bet 398");
});

test("without an effective stack nothing is ALLIN - the old behaviour", () => {
  expect(labelNoStack("b400", "r:0")).toBe("Bet 400");
});

test("check vs call, and bet vs raise, follow the STREET not the last segment", () => {
  expect(label("c", "r:0")).toBe("Check");
  expect(label("c", "r:0:b50")).toBe("Call");
  expect(label("b50", "r:0")).toBe("Bet 50");
  expect(label("b250", "r:0:b50")).toBe("Raise to 250");
  // After a deal the new street opens with nobody facing anything, even though
  // the path is full of bets. A last-segment test gets the card right by luck;
  // this one is right by construction.
  expect(label("c", "r:0:b50:c:2c")).toBe("Check");
  expect(label("b150", "r:0:b50:c:2c")).toBe("Bet 100");
});

test("prior-street commitment is netted out", () => {
  // Flop bet 50 called, then a turn bet to a cumulative 150 is a bet of 100.
  expect(label("b150", "r:0:b50:c:2c")).toBe("Bet 100");
  // Two completed streets: 50 then 150 matched, so a river bet to 300 is 150.
  expect(label("b300", "r:0:b50:c:2c:b150:c:7h")).toBe("Bet 150");
  // A checked-through street adds nothing and the carry persists.
  expect(label("b150", "r:0:b50:c:2c:c:c:7h")).toBe("Bet 100");
});

test("fold is fold wherever it appears", () => {
  expect(label("f", "r:0:b50")).toBe("Fold");
  expect(label("f", "r:0:b50:c:2c:b150")).toBe("Fold");
});

test("the line walker carries the pot as it stood at each dealt card", () => {
  // A minimal flop-rooted directory: root, the check-check pair, and the turn
  // node the deal leads to. The chance node r:0:c:c has no row of its own,
  // which is the whole reason the walker recognises card segments.
  const nodes = [
    { id: "r:0", position: "OOP", actions: ["c", "b50"] },
    { id: "r:0:c", position: "IP", actions: ["c", "b50"] },
    { id: "r:0:c:c:2c", position: "OOP", actions: ["c", "b50"] },
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const line = buildCompareLine("r:0:c:c:2c", byId, label, 100);

  expect(line.dealtCards).toEqual(["2c"]);
  const card = line.lineNodes.find((n) => n.kind === "card");
  expect(card).toBeTruthy();
  // Checked through, so the pot is untouched.
  expect(card && card.kind === "card" && card.potMoney).toBe(100);
});

test("a bet-call before the deal puts BOTH seats' chips in the pot", () => {
  const nodes = [
    { id: "r:0", position: "OOP", actions: ["c", "b50"] },
    { id: "r:0:b50", position: "IP", actions: ["f", "c"] },
    { id: "r:0:b50:c:2c", position: "OOP", actions: ["c", "b50"] },
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const line = buildCompareLine("r:0:b50:c:2c", byId, label, 100);
  const card = line.lineNodes.find((n) => n.kind === "card");
  // 100 + 50 from each seat.
  expect(card && card.kind === "card" && card.potMoney).toBe(200);
});

test("the child index sees a chance node's runouts, which have rows of their own", () => {
  const nodes = [
    { id: "r:0", position: "OOP", actions: ["c"] },
    { id: "r:0:c", position: "IP", actions: ["c"] },
    { id: "r:0:c:c:2c", position: "OOP", actions: ["c"] },
    { id: "r:0:c:c:6d", position: "OOP", actions: ["c"] },
    { id: "r:0:c:c:Th", position: "OOP", actions: ["c"] },
  ];
  const children = buildChildIndex(nodes);
  // The chance node itself is absent from the directory, but its deals are
  // present - which is what the runout picker offers.
  expect(children.get("r:0:c:c")?.sort()).toEqual(["2c", "6d", "Th"]);
});
