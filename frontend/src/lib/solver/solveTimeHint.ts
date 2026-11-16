// src/lib/solver/solveTimeHint.ts
// The time promise shown beside a pending solve. Its own module, with no
// imports beyond a type, so the pure-logic spec can load it without the API
// client (and Firebase) behind solveJobs.ts.
import type { SolverKind } from "./uploadGameTree";

/**
 * What to say before the API has any history to measure (fewer than three
 * completed solves of this solver and kind). These are MEASURED figures, not
 * hopes, and they are only the fallback: once solves exist the API's
 * `typicalSeconds` replaces them, so the promise follows the machine that is
 * actually doing the work.
 *
 * pio: watcher/watcher.out.log on recorded hand-history spots, 28-48 s of
 * solve plus about 9 s of extraction.
 * htsolver: engine/configs/bench/hh_*.json on a 9800X3D at 16 threads to the
 * same 0.2%-of-pot target, 2026-11-16: 95 s end to end on a recorded hand's
 * own ranges, 5.8 and 11.6 min on the two wide-range spots.
 * Change a figure only with a measurement behind it.
 */
const SOLVE_TIME_FALLBACK: Record<SolverKind, string> = {
  pio: "usually about a minute",
  htsolver: "usually 2-12 min",
};

/** "about a minute" / "about 4 min", from a measured number of seconds.
 *  Nothing is promised to finer than a minute: a median of other trees does
 *  not know this one to the second. */
export function formatTypicalSolveTime(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes <= 1 ? "about a minute" : `about ${minutes} min`;
}

/**
 * The time promise shown beside a pending solve. With `typicalSeconds` (the
 * API's measurement over recent solves of this solver and kind) it is that
 * measurement; without one it is the solver's measured fallback. `solver` is
 * what the API said it queued; unknown (an older API) reads as Pio, which is
 * what such an API always queues.
 */
export const solveTimeHint = (solver?: SolverKind, typicalSeconds?: number | null): string =>
  typeof typicalSeconds === "number" && Number.isFinite(typicalSeconds) && typicalSeconds > 0
    ? `recent solves took ${formatTypicalSolveTime(typicalSeconds)}`
    : (SOLVE_TIME_FALLBACK[solver ?? "pio"] ?? SOLVE_TIME_FALLBACK.pio);
