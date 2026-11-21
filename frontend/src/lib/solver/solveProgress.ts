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

/**
 * The accuracy keys of `manifest.engine` (watcher/ht_bundles.py
 * `solve_accuracy`). A solve that ran out of time is published all the same,
 * and these are what make that honest: `converged` is false and
 * `exploitable_pct_pot` is the accuracy it actually reached. Absent on every
 * PioSOLVER board and on htsolver boards from before the keys, where nothing
 * is claimed either way.
 */
export type EngineAccuracy = {
  converged?: boolean | null;
  /** How exploitable the published strategy is, as a percent of the pot. */
  exploitable_pct_pot?: number | null;
  /** The accuracy the solve was asked to reach, in the same unit. */
  target_exploitable_pct?: number | null;
  /** The same shortfall in solver chips (per player, Pio's "exploitable for"). */
  exploitable?: number | null;
};

export type StoppedEarly = {
  exploitablePct: number;
  targetPct: number | null;
  /** Solver chips; divide by the board's chip scale for display money. */
  exploitableChips: number | null;
};

/**
 * What to say about a board whose solve stopped short of its target, or null
 * for one that reached it and for one that does not say. Only an explicit
 * `converged: false` WITH a measurement counts: a missing key is not a
 * verdict, and a label with no number behind it would only worry people.
 */
export function stoppedEarly(engine?: EngineAccuracy | null): StoppedEarly | null {
  if (!engine || engine.converged !== false) return null;
  const pct = engine.exploitable_pct_pot;
  if (!isMeasurement(pct)) return null;
  const target = engine.target_exploitable_pct;
  const chips = engine.exploitable;
  return {
    exploitablePct: pct,
    targetPct: isMeasurement(target) && target > 0 ? target : null,
    exploitableChips: isMeasurement(chips) ? chips : null,
  };
}

/** A small amount to the cent, "0.07 chips" / "0.02 bb"; null when it is not
 *  an amount. Anything real but under half a cent says so rather than "0.00". */
export function formatSmallAmount(amount: number, unit: "chips" | "bb"): string | null {
  if (!isMeasurement(amount)) return null;
  if (amount > 0 && amount < 0.005) return `<0.01 ${unit}`;
  return `${amount.toFixed(2)} ${unit}`;
}

/** "0.23% of pot · 0.07 chips": the accuracy a stopped solve reached. */
export function stoppedEarlyText(s: StoppedEarly, amount?: string | null): string {
  const pct = `${formatPotPct(s.exploitablePct)} of pot`;
  return amount ? `${pct} · ${amount}` : pct;
}

/** The sentence behind the note, for its tooltip. */
export function stoppedEarlyTitle(s: StoppedEarly, amount?: string | null): string {
  const why =
    s.targetPct != null
      ? `The solver ran out of time before reaching its ${formatPotPct(s.targetPct, true)} accuracy target.`
      : "The solver ran out of time before reaching its accuracy target.";
  const size = `${formatPotPct(s.exploitablePct)} of the pot${amount ? ` (${amount})` : ""}`;
  return `${why} This strategy can still be exploited for ${size} per player.`;
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
