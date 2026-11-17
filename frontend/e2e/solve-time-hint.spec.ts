// Pure-function tests for lib/solver/solveTimeHint.ts. No browser; same
// harness as engine-tree.spec.ts.
//
// The notice beside a pending solve used to be a fixed "usually 2-10 min"
// that nothing ever checked. It is now the API's measurement over recent
// solves (typicalSeconds), with a measured per-solver fallback for when there
// is no history yet. These pin which of the two is shown, and how.
import { test, expect } from "@playwright/test";
import { formatTypicalSolveTime, solveTimeHint } from "../src/lib/solver/solveTimeHint";

test.describe("solveTimeHint", () => {
  test("a measured figure wins over the fallback, for either solver", () => {
    expect(solveTimeHint("htsolver", 240)).toBe("recent solves took about 4 min");
    expect(solveTimeHint("pio", 240)).toBe("recent solves took about 4 min");
    expect(solveTimeHint(undefined, 47)).toBe("recent solves took about a minute");
  });

  test("no measurement falls back to the solver's own measured figure", () => {
    expect(solveTimeHint("pio")).toBe("usually about a minute");
    expect(solveTimeHint("pio", null)).toBe("usually about a minute");
    expect(solveTimeHint("htsolver", null)).toBe("usually 2-12 min");
    // An API older than solver routing names no solver and queues Pio.
    expect(solveTimeHint(undefined, undefined)).toBe("usually about a minute");
  });

  test("a zero, negative or non-finite figure is not a measurement", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(solveTimeHint("htsolver", bad)).toBe("usually 2-12 min");
    }
  });

  test("nothing is promised to finer than a minute", () => {
    expect(formatTypicalSolveTime(20)).toBe("about a minute");
    expect(formatTypicalSolveTime(89)).toBe("about a minute");
    expect(formatTypicalSolveTime(95)).toBe("about 2 min");
    expect(formatTypicalSolveTime(694)).toBe("about 12 min");
  });
});
