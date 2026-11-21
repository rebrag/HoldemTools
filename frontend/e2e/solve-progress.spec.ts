// Pure-function tests for lib/solver/solveProgress.ts. No browser; same
// harness as solve-time-hint.spec.ts.
//
// A running htsolver job reports the iteration it is on and how exploitable
// the strategy still is; the pending card prints that under the elapsed time.
// These pin what is printed, and that nothing unmeasured is ever printed as a
// number.
import { test, expect } from "@playwright/test";
import {
  formatPotPct,
  formatSmallAmount,
  solveProgressText,
  solveProgressTitle,
  stoppedEarly,
  stoppedEarlyText,
  stoppedEarlyTitle,
} from "../src/lib/solver/solveProgress";

// A solve that ran out of time is published anyway, and the board says how
// far it got. These pin when the note appears and what it reads.
test.describe("stoppedEarly", () => {
  // The recorded hand that prompted this: 575 iterations in 1500 s, pot 310.
  const engine = {
    converged: false,
    exploitable_pct_pot: 0.226939,
    target_exploitable_pct: 0.2,
    exploitable: 0.703511,
  };

  test("a board that stopped short reports its accuracy, target and chips", () => {
    expect(stoppedEarly(engine)).toEqual({
      exploitablePct: 0.226939,
      targetPct: 0.2,
      exploitableChips: 0.703511,
    });
  });

  test("a board that reached its target, or does not say, shows nothing", () => {
    expect(stoppedEarly({ ...engine, converged: true })).toBeNull();
    // Every PioSOLVER board, and htsolver boards from before the keys.
    expect(stoppedEarly(null)).toBeNull();
    expect(stoppedEarly(undefined)).toBeNull();
    expect(stoppedEarly({})).toBeNull();
    expect(stoppedEarly({ ...engine, converged: null })).toBeNull();
    // A verdict with no number behind it is not shown either.
    expect(stoppedEarly({ converged: false })).toBeNull();
    expect(stoppedEarly({ converged: false, exploitable_pct_pot: Number.NaN })).toBeNull();
  });

  test("missing pieces drop out instead of printing as zero", () => {
    expect(stoppedEarly({ converged: false, exploitable_pct_pot: 0.9 })).toEqual({
      exploitablePct: 0.9,
      targetPct: null,
      exploitableChips: null,
    });
    expect(stoppedEarly({ ...engine, target_exploitable_pct: 0 })?.targetPct).toBeNull();
  });

  test("the note reads as a percent of the pot, with the amount when there is one", () => {
    const stopped = stoppedEarly(engine);
    if (!stopped) throw new Error("expected a stopped-early board");
    expect(stoppedEarlyText(stopped)).toBe("0.23% of pot");
    expect(stoppedEarlyText(stopped, "0.07 chips")).toBe("0.23% of pot · 0.07 chips");
    expect(stoppedEarlyTitle(stopped, "0.07 chips")).toBe(
      "The solver ran out of time before reaching its 0.2% accuracy target. " +
        "This strategy can still be exploited for 0.23% of the pot (0.07 chips) per player."
    );
    expect(stoppedEarlyTitle({ ...stopped, targetPct: null })).toBe(
      "The solver ran out of time before reaching its accuracy target. " +
        "This strategy can still be exploited for 0.23% of the pot per player."
    );
  });

  test("small amounts are shown to the cent, and never as a false zero", () => {
    expect(formatSmallAmount(0.0703511, "chips")).toBe("0.07 chips");
    expect(formatSmallAmount(1.5, "bb")).toBe("1.50 bb");
    expect(formatSmallAmount(0.004, "bb")).toBe("<0.01 bb");
    expect(formatSmallAmount(0, "chips")).toBe("0.00 chips");
    expect(formatSmallAmount(Number.NaN, "chips")).toBeNull();
    expect(formatSmallAmount(-1, "chips")).toBeNull();
  });
});

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
