// src/pages/multiway/compareJob.ts
//
// One push/fold job as GET /api/enginecompare returns it, and the few
// readings of a row that every surface on /multiway shares: the page's
// Recent strip, the Solves drawer, and the session simulator all decide
// "can this be opened?" and "is this finished?" the same way, so the
// answers live here rather than being re-derived three times.

export type JobStatus =
  | "Queued"
  | "Claimed"
  | "Running"
  | "Uploading"
  | "Done"
  | "Failed"
  | "Cancelled";

/** The spot a job solved, parsed server-side out of its stored config.
 *  Everything a person needs to tell one "4-way · Done" row from another. */
export interface JobSpot {
  players: number;
  /** Seat labels in seat order. */
  seats: string[];
  /** Starting stacks in chips, seat order. */
  stacks: number[];
  smallBlind: number;
  bigBlind: number;
  ante: number;
  button: number;
  /** The hand-sharing pair's seat indices, or null for a no-team solve. */
  teamSeats: number[] | null;
  /** "aware" or "unaware"; null without a team. */
  awareness: string | null;
  requestedIterations: number | null;
}

export interface CompareJob {
  id: string;
  mode?: string;
  board?: string | null;
  status: JobStatus;
  error?: string | null;
  hasHtResult?: boolean;
  createdAtUtc?: string;
  completedAtUtc?: string | null;
  /* Set the moment Stop is pressed, while the job is still active. The solve
   * does not end here - the watcher asks the engine to stop cleanly and the
   * partial result is still uploaded - so this is what "Stopping" is read
   * from, and the row keeps its real status until that lands. */
  cancelRequestedAtUtc?: string | null;
  /* The result's lineage and how far it got, as the watcher reported it (or
   * as the page backfilled it from the artifact). What lets a lineage be
   * opened by id - a team's baseline, say - without queueing anything. */
  solveId?: string | null;
  solveKey?: string | null;
  iterations?: number | null;
  /** Null for a row whose config the server could not read. */
  spot?: JobSpot | null;
}

export const ago = (iso?: string | null): string => {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
};

/** When the row's result landed, or when it was queued while it has not. */
export const jobTime = (j: CompareJob): string | undefined =>
  j.completedAtUtc ?? j.createdAtUtc;

export const STATUS_TONE: Record<JobStatus, string> = {
  Queued: "text-slate-400",
  Claimed: "text-slate-300",
  Running: "text-sky-300",
  Uploading: "text-sky-300",
  Done: "text-emerald-400",
  Failed: "text-red-400",
  /* Amber, not red: a stopped solve normally still has a chart to open, and
   * colouring it like a failure would say the opposite. */
  Cancelled: "text-amber-300",
};

export const TERMINAL: JobStatus[] = ["Done", "Failed", "Cancelled"];
/* A stopped solve keeps whatever it had solved, so these open like any other
 * result. Failed is the only status with nothing behind it. */
export const HAS_RESULT: JobStatus[] = ["Done", "Cancelled"];

export const isFinished = (j: CompareJob): boolean => TERMINAL.includes(j.status);
export const isOpenable = (j: CompareJob): boolean =>
  HAS_RESULT.includes(j.status) && j.hasHtResult !== false;
