// src/lib/solver/solveProgress.ts
// How far a running solve has got, as the line shown under the time on the
// pending card. Its own module with no imports, so the pure-logic spec can
// load it without the API client (and Firebase) behind solveJobs.ts.

/**
 * The solver's last measurement of the job it is working on, from
 * GET /api/solvejobs/{id}. Both percentages are of the pot: how much the
 * strategy could still be exploited for at that iteration, and the accuracy
 * the solve stops at. Null until the worker has measured once, and always for
 * a solver that reports none (PioSOLVER).
 */
export type SolveJobProgress = {
  iteration: number;
  exploitablePct: number;
  targetPct?: number | null;
};

const isMeasurement = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * A percent of the pot at the precision it is worth reading: "12%", "4.8%",
 * "0.45%". Decimals are fixed within a band so the figure does not change
 * width every time it ticks down; `trim` drops trailing zeros, for a number
 * that never moves (the target: "0.2%", not "0.20%").
 */
export function formatPotPct(pct: number, trim = false): string {
  if (pct > 0 && pct < 0.01) return "<0.01%";
  const text = pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct.toFixed(2);
  return `${trim && text.includes(".") ? text.replace(/\.?0+$/, "") : text}%`;
}

/**
 * The progress line, or null when there is nothing measured to show. These
 * are the solver's own numbers and nothing else: no bar and no time-to-finish,
 * because accuracy falls fast at first and slowly at the end, and a bar drawn
 * from it would promise a finish it cannot know.
 */
export function solveProgressText(progress?: SolveJobProgress | null): string | null {
  if (!progress || !isMeasurement(progress.exploitablePct)) return null;
  const now = `accuracy ${formatPotPct(progress.exploitablePct)} of pot`;
  const target = progress.targetPct;
  return isMeasurement(target) && target > 0 ? `${now} · target ${formatPotPct(target, true)}` : now;
}

/** The longer explanation behind the line, for its tooltip. */
export function solveProgressTitle(progress?: SolveJobProgress | null): string | undefined {
  if (!progress || !isMeasurement(progress.exploitablePct)) return undefined;
  const at = isMeasurement(progress.iteration) ? `Iteration ${progress.iteration}: the` : "The";
  const now = `${at} strategy can still be exploited for ${formatPotPct(progress.exploitablePct)} of the pot.`;
  const target = progress.targetPct;
  return isMeasurement(target) && target > 0
    ? `${now} The solve stops at ${formatPotPct(target, true)}.`
    : now;
}
