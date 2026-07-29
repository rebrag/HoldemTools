import { test, expect } from "@playwright/test";
import { buildNodeStats } from "../src/lib/solver/nodeStats";
import type { PioSolutionDoc } from "../src/lib/solver/postflopClient";

/**
 * Pure-function cover for the seat stats derivation. It runs here rather than
 * behind the UI because the case that matters most - an ICM solve, whose EV is
 * in tournament-equity units - is awkward to reach through a fixture, and the
 * unit handling is exactly the part that would silently produce numbers that
 * look plausible and are wrong by two orders of magnitude.
 *
 * Numbers below are real, taken from boards in the library.
 */

const SEATS = { oop: "SB", ip: "BB" };
const doc = (oop: [number, number, number], ip: [number, number, number]) =>
  ({
    seat_stats: {
      oop: { ev: oop[0], equity: oop[1], combos: oop[2] },
      ip: { ev: ip[0], equity: ip[1], combos: ip[2] },
    },
  }) as unknown as PioSolutionDoc;

/* Ts8d2h r:0 - a chip solve: the two EVs sum to about the 700-chip pot. */
const CHIP = doc([382.386, 0.543843, 280.099], [320.275, 0.456157, 687.425]);
/* QsKh3c r:0 - ICM, so EV is tournament equity and sums to 3.93, not 550. */
const ICM = doc([1.07, 0.368, 734.94], [2.863, 0.632, 352.665]);

test("chip solves convert EV to bb", () => {
  const s = buildNodeStats(CHIP, SEATS, 700)!;
  expect(s.chipEv).toBe(true);
  expect(s.oop.evMoney).toBeCloseTo(3.82, 2);
  expect(s.ip.evMoney).toBeCloseTo(3.2, 2);
  expect(s.oop.seat).toBe("SB");
});

test("ICM solves report no bb, because EV is not chips", () => {
  const s = buildNodeStats(ICM, SEATS, 550)!;
  expect(s.chipEv).toBe(false);
  expect(s.oop.evMoney).toBeNull();
  expect(s.ip.evMoney).toBeNull();
  // The raw value is still carried, so the panel can show it unitless.
  expect(s.oop.ev).toBeCloseTo(1.07, 2);
});

test("missing or partial stats degrade to nulls, not NaN", () => {
  expect(buildNodeStats(null, SEATS, 700)).toBeNull();
  expect(buildNodeStats({} as PioSolutionDoc, SEATS, 700)).toBeNull();

  // A seat that cannot reach the node has zero equity rather than NaN.
  const oneSided = doc([554.41, 0, 100], [0, 0, 0]);
  const s = buildNodeStats(oneSided, SEATS, 550)!;
  expect(s.oop.equity).toBe(0);
  expect(Number.isNaN(s.oop.evMoney ?? 0)).toBe(false);
});
