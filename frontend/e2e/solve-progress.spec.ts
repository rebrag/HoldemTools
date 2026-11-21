// Pure-function tests for lib/solver/solveProgress.ts. No browser; same
// harness as solve-time-hint.spec.ts.
//
// A running htsolver job reports the iteration it is on and how exploitable
// the strategy still is; the pending card prints that under the elapsed time.
// These pin what is printed, and that nothing unmeasured is ever printed as a
// number.
import { test, expect } from "@playwright/test";
import { formatPotPct, solveProgressText, solveProgressTitle } from "../src/lib/solver/solveProgress";

test.describe("solveProgress", () => {
  test("the measurement is printed beside the target it stops at", () => {
    expect(solveProgressText({ iteration: 150, exploitablePct: 0.45, targetPct: 0.2 })).toBe(
      "accuracy 0.45% of pot · target 0.2%"
    );
    expect(solveProgressText({ iteration: 25, exploitablePct: 4.8, targetPct: 0.2 })).toBe(
      "accuracy 4.8% of pot · target 0.2%"
    );
  });

  test("a job with no usable target still shows its measurement", () => {
    for (const targetPct of [null, undefined, 0, -1, Number.NaN]) {
      expect(solveProgressText({ iteration: 150, exploitablePct: 0.45, targetPct })).toBe(
        "accuracy 0.45% of pot"
      );
    }
  });

  test("nothing measured is no line, never a zero", () => {
    expect(solveProgressText(null)).toBeNull();
    expect(solveProgressText(undefined)).toBeNull();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0.1]) {
      expect(solveProgressText({ iteration: 150, exploitablePct: bad, targetPct: 0.2 })).toBeNull();
      expect(solveProgressTitle({ iteration: 150, exploitablePct: bad, targetPct: 0.2 })).toBeUndefined();
    }
  });

  test("precision follows the size of the number, and the moving figure keeps its width", () => {
    expect(formatPotPct(12.34)).toBe("12%");
    expect(formatPotPct(4.83)).toBe("4.8%");
    expect(formatPotPct(1)).toBe("1.0%");
    expect(formatPotPct(0.4)).toBe("0.40%");
    expect(formatPotPct(0.004)).toBe("<0.01%");
    expect(formatPotPct(0)).toBe("0.00%");
    // The target never moves, so it drops its trailing zeros.
    expect(formatPotPct(0.2, true)).toBe("0.2%");
    expect(formatPotPct(1, true)).toBe("1%");
    expect(formatPotPct(10, true)).toBe("10%");
    expect(formatPotPct(0.25, true)).toBe("0.25%");
  });

  test("the tooltip says what the numbers mean", () => {
    expect(solveProgressTitle({ iteration: 150, exploitablePct: 0.45, targetPct: 0.2 })).toBe(
      "Iteration 150: the strategy can still be exploited for 0.45% of the pot. The solve stops at 0.2%."
    );
    expect(solveProgressTitle({ iteration: 150, exploitablePct: 0.45 })).toBe(
      "Iteration 150: the strategy can still be exploited for 0.45% of the pot."
    );
  });
});
