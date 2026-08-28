// Pure-function tests for the action palette. No browser, same harness as
// money-units.spec.ts.
//
// The properties pinned here are the ones a user actually reads off the
// matrix, and each of them was broken or unenforced before:
//   - a bigger bet is always darker
//   - bet sizes that appear together at one node are tellable apart
//   - all-in is darker than any ordinary bet, preflop and postflop alike
//   - the legend, the cells and the line strips agree, because they all build
//     the palette from the same option list
import { test, expect } from "@playwright/test";
import {
  buildActionPalette,
  getColorForAction,
  hexToRgb,
  parseBetSize,
} from "../src/lib/solver/utils";

/* These run once, not per browser project. */
test.skip(({ isMobile }) => !!isMobile, "pure logic - desktop project only");

/** Perceived lightness, 0..255. The ramp darkens as bets grow, so this is the
 *  single number every ordering assertion below is phrased in. */
const luminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** How far apart two colours are in straight RGB distance. */
const distance = (a: string, b: string): number => {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
};

/** Comfortably above "these look the same" at a glance. */
const CLEARLY_DIFFERENT = 18;

test("a bet label is read with its unit, not as a bare number", () => {
  expect(parseBetSize("Raise 54%")).toEqual({ value: 54, unit: "pct" });
  expect(parseBetSize("Raise 3bb")).toEqual({ value: 3, unit: "bb" });
  expect(parseBetSize("Raise to 20bb")).toEqual({ value: 20, unit: "bb" });
  expect(parseBetSize("Bet 1.8bb")).toEqual({ value: 1.8, unit: "bb" });
  // A bare number is the hand's own money; sizeRef turns it into big blinds.
  expect(parseBetSize("Bet 50", 5)).toEqual({ value: 10, unit: "bb" });
  // Non-bets have no size at all.
  expect(parseBetSize("Fold")).toBeNull();
  expect(parseBetSize("Call")).toBeNull();
  expect(parseBetSize("ALLIN")).toBeNull();
});

test("a bare number reads as percent-of-pot when unitMode is 'pct'", () => {
  // /compare's own labels ("Bet 50") are always bare - it has no big blind to
  // suffix them with. sizeRef there is the pot facing the bet, in the same
  // chips as the label, so "Bet 50" against a 100-chip pot is 50%.
  expect(parseBetSize("Bet 50", 100, "pct")).toEqual({ value: 50, unit: "pct" });
  expect(parseBetSize("Raise to 300", 100, "pct")).toEqual({ value: 300, unit: "pct" });
  // The default stays "bb" - every call site that predates this change (every
  // /solver view) passes no third argument and must read exactly as before.
  expect(parseBetSize("Bet 50", 100)).toEqual({ value: 0.5, unit: "bb" });
  // A "%"-suffixed label is unambiguous either way; unitMode never overrides it.
  expect(parseBetSize("Bet 50%", 100, "pct")).toEqual({ value: 50, unit: "pct" });
});

test("/compare's chip-denominated bets ramp on percent of pot, and land where an explicit '%' label would", () => {
  // The regression this exists for: /compare labels stay in chips ("Bet 33"),
  // but the ramp has to read them as if they were "Bet 33%" - not as 33 big
  // blinds, which is what happened before and pinned every bet to the darkest
  // shade the ramp has (33 blew past BB_MAX=60... at chip_scale=100 it did not
  // even reach that far, which was the OTHER half of the bug: a page whose
  // sizeRef was accidentally too generous for its numbers).
  const pot = 100;
  const chipPalette = buildActionPalette(["Bet 33", "Bet 75", "Bet 200", "Fold"], pot, "pct");
  const pctPalette = buildActionPalette(["Bet 33%", "Bet 75%", "Bet 200%", "Fold"]);

  expect(chipPalette["Bet 33"]).toBe(pctPalette["Bet 33%"]);
  expect(chipPalette["Bet 75"]).toBe(pctPalette["Bet 75%"]);
  expect(chipPalette["Bet 200"]).toBe(pctPalette["Bet 200%"]);

  // Darker is bigger, same as every other ramp.
  expect(luminance(chipPalette["Bet 33"])).toBeGreaterThan(luminance(chipPalette["Bet 75"]));
  expect(luminance(chipPalette["Bet 75"])).toBeGreaterThan(luminance(chipPalette["Bet 200"]));
  // And tellable apart, which is the whole point of buildActionPalette over
  // the single-label fallback.
  expect(distance(chipPalette["Bet 33"], chipPalette["Bet 75"])).toBeGreaterThan(CLEARLY_DIFFERENT);
  expect(distance(chipPalette["Bet 75"], chipPalette["Bet 200"])).toBeGreaterThan(CLEARLY_DIFFERENT);
});

test("percent-of-pot mode still reads the pot GROWING down a line the same way", () => {
  // A turn bet of 100 against a 300-chip pot (grown from a flop bet-call) is a
  // third-pot bet, not the "100% of the 100-chip ROOT pot" a flat page-wide
  // reference would have read it as - which is why /compare recomputes the
  // pot at every node rather than reusing one constant for the whole line.
  const turnPalette = buildActionPalette(["Bet 100", "Check"], 300, "pct");
  const explicitThird = buildActionPalette(["Bet 33.3%", "Check"]);
  expect(turnPalette["Bet 100"]).toBe(explicitThird["Bet 33.3%"]);
});

test("the preflop percent raises are four distinct colours", () => {
  // The regression this whole change exists for: read as bare numbers, 54/75/
  // 100/125 all blew past a 40bb ceiling and rendered the identical darkest
  // red - four different sizings that looked like one.
  const actions = ["Raise 54%", "Raise 75%", "Raise 100%", "Raise 125%"];
  const palette = buildActionPalette(actions);
  const colors = actions.map((a) => palette[a]);

  expect(new Set(colors).size).toBe(4);
  for (let i = 1; i < colors.length; i++) {
    expect(distance(colors[i - 1], colors[i])).toBeGreaterThan(CLEARLY_DIFFERENT);
  }
});

test("a close preflop open family is still tellable apart", () => {
  // 2 / 2.5 / 3bb spanned ~4% of the gradient on the old absolute ramp.
  const actions = ["Raise 2bb", "Raise 2.5bb", "Raise 3bb"];
  const palette = buildActionPalette(actions);
  const colors = actions.map((a) => palette[a]);

  expect(new Set(colors).size).toBe(3);
  for (let i = 1; i < colors.length; i++) {
    expect(distance(colors[i - 1], colors[i])).toBeGreaterThan(CLEARLY_DIFFERENT);
  }
});

test("darker always means bigger", () => {
  for (const actions of [
    ["Bet 25%", "Bet 50%", "Bet 75%", "Bet 125%", "Bet 250%"],
    ["Raise 2bb", "Raise 3bb", "Raise 4bb", "Raise 9bb", "Raise 22bb"],
  ]) {
    const palette = buildActionPalette(actions);
    const lums = actions.map((a) => luminance(palette[a]));
    for (let i = 1; i < lums.length; i++) {
      expect(lums[i]).toBeLessThan(lums[i - 1]);
    }
  }
});

test("all-in is darker than any ordinary bet, and the ramp never reaches it", () => {
  const actions = ["ALLIN", "Bet 25%", "Bet 100%", "Bet 300%", "Bet 900%"];
  const palette = buildActionPalette(actions);
  const allin = luminance(palette.ALLIN);

  for (const action of actions.filter((a) => a !== "ALLIN")) {
    expect(allin).toBeLessThan(luminance(palette[action]));
    expect(distance(palette.ALLIN, palette[action])).toBeGreaterThan(CLEARLY_DIFFERENT);
  }
});

test("all-in is the same colour preflop and postflop", () => {
  // Preflop plates carry a literal "ALLIN" key; postflop, formatPioAction
  // rewrites a stack-committing bet to the same label. Both must land on the
  // same colour, whatever else is at the node and whatever the money unit.
  const preflop = buildActionPalette(["ALLIN", "Min", "Call", "Fold"]);
  const postflop = buildActionPalette(["ALLIN", "Bet 120", "Call", "Fold"], 10);

  expect(preflop.ALLIN).toBe(postflop.ALLIN);
  expect(preflop.ALLIN).toBe(getColorForAction("ALLIN"));
  // Casing and spelling variants reach the same place.
  expect(getColorForAction("all-in")).toBe(preflop.ALLIN);
  expect(getColorForAction("All In")).toBe(preflop.ALLIN);
});

test("the categorical colours are untouched by the node's bet sizes", () => {
  const sparse = buildActionPalette(["Call", "Fold"]);
  const busy = buildActionPalette(["Call", "Fold", "Bet 33%", "Bet 75%", "ALLIN"]);

  expect(sparse.Call).toBe(busy.Call);
  expect(sparse.Fold).toBe(busy.Fold);
  expect(sparse.Call).toBe(getColorForAction("Call"));
  expect(sparse.Fold).toBe(getColorForAction("Fold"));
});

test("two labels for the same size share a shade", () => {
  // A bet and a raise to the same amount are the same aggression; forcing them
  // apart would imply a difference that isn't there.
  const palette = buildActionPalette(["Bet 50%", "Raise 50%", "Bet 100%"]);
  expect(palette["Bet 50%"]).toBe(palette["Raise 50%"]);
  expect(palette["Bet 50%"]).not.toBe(palette["Bet 100%"]);
});

test("many sizes at one node still order correctly", () => {
  // More sizes than MIN_BET_GAP can separate: the gap shrinks to an even split
  // rather than clipping the big ones together at the dark end.
  const actions = [
    "Bet 20%", "Bet 33%", "Bet 50%", "Bet 66%",
    "Bet 100%", "Bet 150%", "Bet 200%", "Bet 300%",
  ];
  const palette = buildActionPalette(actions);
  const lums = actions.map((a) => luminance(palette[a]));

  expect(new Set(actions.map((a) => palette[a])).size).toBe(actions.length);
  for (let i = 1; i < lums.length; i++) {
    expect(lums[i]).toBeLessThan(lums[i - 1]);
  }
});

test("a recorded hand's money is normalised by sizeRef", () => {
  // "Bet 50" in a $5 game is 10bb. Without sizeRef every bet at a real stake
  // ran off the end of the ramp and rendered one shade.
  const palette = buildActionPalette(["Bet 25", "Bet 50", "Bet 150"], 5);
  const lums = ["Bet 25", "Bet 50", "Bet 150"].map((a) => luminance(palette[a]));
  expect(lums[1]).toBeLessThan(lums[0]);
  expect(lums[2]).toBeLessThan(lums[1]);
});

test("an unparseable bet still gets a bet colour, not the fallback", () => {
  const palette = buildActionPalette(["Bet", "Fold"]);
  expect(palette.Bet).not.toBe(palette.Fold);
  expect(palette.Bet).toBe(getColorForAction("Bet"));
});
