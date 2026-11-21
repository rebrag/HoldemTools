// src/lib/solver/solveJobs.ts
// Client for the SolveJobs queue: cheap status polling for a pending solve,
// replacing blind manifest-existence polling. GET /api/solvejobs/{id} is two
// counts and a 20-row read, so a 2s cadence is fine.
import { authedFetch } from "@/lib/api";
import type { SolverKind } from "./uploadGameTree";

import type { SolveJobProgress } from "./solveProgress";

export { formatTypicalSolveTime, solveTimeHint } from "./solveTimeHint";
export { solveProgressText, solveProgressTitle, type SolveJobProgress } from "./solveProgress";

export type SolveJobStatus =
  | "Queued"
  | "Claimed"
  | "Solving"
  | "Extracting"
  | "Uploading"
  | "Done"
  | "Failed";

export type SolveJobDto = {
  id: string;
  status: SolveJobStatus;
  board: string | null;
  folder: string;
  lineKey: string;
  actingPos: string;
  isIcm: boolean;
  /** 1-based place in the queue; null unless status is Queued. */
  queuePosition: number | null;
  /** Jobs a watcher is actively working (0 or 1 with a single watcher). */
  activeAhead: number | null;
  error: string | null;
  attemptCount: number;
  resultStacks: string | null;
  resultNodeName: string | null;
  createdAtUtc: string;
  claimedAtUtc: string | null;
  completedAtUtc: string | null;
  lastHeartbeatUtc: string | null;
  /** The solver the job is queued for. Absent from an API older than solver
   *  routing, where every job is Pio's. */
  solver?: SolverKind;
  /** The saved hand the solve came from, when it came from one. */
  handHistoryId?: number | null;
  /** Median claim-to-Done seconds of recent solves of this solver and kind,
   *  measured by the API from the queue's own history. Null when there is no
   *  history yet or the job is finished; absent from an older API. */
  typicalSeconds?: number | null;
  /** The solver's last measurement of the running solve. Null until it has
   *  measured once (and for PioSOLVER, which reports none); absent from an
   *  older API. */
  progress?: SolveJobProgress | null;
};

const TERMINAL: ReadonlySet<SolveJobStatus> = new Set(["Done", "Failed"]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchSolveJob(id: string): Promise<SolveJobDto | null> {
  const res = await authedFetch(`/api/solvejobs/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} for /api/solvejobs/${id}`);
  return (await res.json()) as SolveJobDto;
}

/**
 * Poll a solve job until it reaches Done or Failed. `onUpdate` fires on every
 * successful fetch so the caller can render stage + queue position. Returns
 * null when cancelled via `shouldStop` or when the window runs out (solves cap
 * at 15 min but the queue in front can be deep, hence ~45 min).
 */
export async function pollSolveJob(
  id: string,
  options?: {
    intervalMs?: number;
    maxAttempts?: number;
    shouldStop?: () => boolean;
    onUpdate?: (job: SolveJobDto) => void;
  }
): Promise<SolveJobDto | null> {
  const intervalMs = options?.intervalMs ?? 2000;
  const maxAttempts = options?.maxAttempts ?? 1350; // ~45 min at 2s
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options?.shouldStop?.()) return null;
    try {
      const job = await fetchSolveJob(id);
      if (job) {
        options?.onUpdate?.(job);
        if (TERMINAL.has(job.status)) return job;
      } else {
        console.warn(`Solve job ${id} not found (attempt ${attempt})`);
      }
    } catch (err) {
      console.warn(`Error polling solve job ${id} (attempt ${attempt})`, err);
    }
    await sleep(intervalMs);
  }
  console.warn(`Gave up waiting on solve job ${id}`);
  return null;
}
