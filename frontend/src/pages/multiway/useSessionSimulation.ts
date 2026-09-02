// src/pages/multiway/useSessionSimulation.ts
//
// Drives the session simulator's workers: every solve in the rotation is
// dealt in fixed chunks across a pool, the chunks are joined into one pool
// of per-hand results per solve, and one worker then bootstraps the
// sessions. The task list and every chunk's seed are fixed up front, so the
// same seed gives the same numbers on a 2-core laptop and a 16-core desktop.
//
// Cancel is terminate(): the loops are synchronous and a queued message could
// never preempt them. Everything spawned is registered in a ref and
// terminated on unmount - the rule from frontend/CLAUDE.md.
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_WORKERS } from "@/lib/constants";
import { chunkSeed } from "@/lib/sessionSim/cards";
import { DEFAULT_CHECKPOINTS, DEFAULT_DD_THRESHOLDS, MAX_SESSIONS } from "@/lib/sessionSim/analyzeSessions";
import type {
  CompiledPolicy,
  PoolMeta,
  PoolStats,
  SessionAnalysis,
  SimIn,
  SimOut,
  SimulatedPool,
} from "@/lib/sessionSim/types";

export type SimPhase = "idle" | "simulating" | "analyzing" | "done" | "error";

export interface RunParams {
  handsPerSolve: number;
  handsPerSession: number;
  sessions: number;
  bankrolls: number[];
  seed: number;
}

export const MAX_HANDS_PER_SOLVE = 5_000_000;
/** Chunks per solve: enough to spread over any pool, few enough that the
 *  per-chunk fixed cost (a policy clone, ~1 MB for a team solve) stays
 *  negligible. */
const CHUNKS_PER_SOLVE = 8;
const REPORT_EVERY = 25_000;

interface Task {
  taskId: number;
  entry: number;
  hands: number;
  seed: number;
}

const spawn = () =>
  new Worker(new URL("../../workers/sessionSimWorker.ts", import.meta.url), { type: "module" });

export function useSessionSimulation() {
  const [phase, setPhase] = useState<SimPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SessionAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poolRef = useRef<Worker[]>([]);
  /* Bumped on every run and cancel: a message from a pool that has since
   * been replaced is ignored rather than mixed into the new run. */
  const generation = useRef(0);

  const stopAll = useCallback(() => {
    for (const w of poolRef.current) w.terminate();
    poolRef.current = [];
  }, []);

  useEffect(() => stopAll, [stopAll]);

  const cancel = useCallback(() => {
    generation.current++;
    stopAll();
    setPhase("idle");
    setProgress(0);
  }, [stopAll]);

  const run = useCallback(
    (policies: CompiledPolicy[], params: RunParams) => {
      generation.current++;
      const gen = generation.current;
      stopAll();
      setError(null);
      setResult(null);
      setPhase("simulating");
      setProgress(0);

      const handsPerSolve = Math.max(1, Math.min(MAX_HANDS_PER_SOLVE, Math.floor(params.handsPerSolve)));
      const tasks: Task[] = [];
      policies.forEach((_, entry) => {
        const base = Math.floor(handsPerSolve / CHUNKS_PER_SOLVE);
        for (let c = 0; c < CHUNKS_PER_SOLVE; c++) {
          const hands = c === CHUNKS_PER_SOLVE - 1 ? handsPerSolve - base * (CHUNKS_PER_SOLVE - 1) : base;
          if (hands > 0) {
            tasks.push({ taskId: tasks.length, entry, hands, seed: chunkSeed(params.seed, entry, c) });
          }
        }
      });
      const totalHands = tasks.reduce((acc, t) => acc + t.hands, 0);
      const chunks = new Map<number, SimulatedPool>();
      const doneBy = new Array<number>(tasks.length).fill(0);
      const sessions = Math.max(1, Math.min(MAX_SESSIONS, Math.floor(params.sessions)));

      const analyze = (worker: Worker) => {
        setPhase("analyzing");
        setProgress(0.7);
        const pools: Float32Array[] = [];
        const poolStats: PoolStats[] = [];
        const poolMeta: PoolMeta[] = [];
        policies.forEach((p, entry) => {
          const parts = tasks.filter((t) => t.entry === entry).map((t) => chunks.get(t.taskId)!);
          const n = parts.reduce((acc, part) => acc + part.results.length, 0);
          const results = new Float32Array(n);
          let at = 0;
          let sum = 0;
          let sumSq = 0;
          let showdowns = 0;
          for (const part of parts) {
            results.set(part.results, at);
            at += part.results.length;
            sum += part.sum;
            sumSq += part.sumSq;
            showdowns += part.showdowns;
          }
          pools.push(results);
          poolStats.push({
            hands: n,
            mean: sum / n,
            variance: Math.max(0, (sumSq - (sum * sum) / n) / Math.max(1, n - 1)),
            showdowns,
          });
          poolMeta.push({
            solveId: p.meta.solveId,
            iterations: p.meta.iterations,
            pairingLabel: p.meta.pairingLabel,
            artifactEvChips: p.meta.artifactEvChips,
          });
        });
        const msg: SimIn = {
          type: "analyze",
          pools,
          poolStats,
          poolMeta,
          chipScale: policies[0].chipScale,
          params: {
            handsPerSession: Math.max(1, Math.floor(params.handsPerSession)),
            sessions,
            bankrolls: params.bankrolls,
            ddThresholds: DEFAULT_DD_THRESHOLDS,
            checkpoints: DEFAULT_CHECKPOINTS,
          },
          seed: chunkSeed(params.seed, 0xffff, 0),
        };
        worker.onmessage = (ev: MessageEvent<SimOut>) => {
          if (generation.current !== gen) return;
          const m = ev.data;
          if (m.type === "progress") {
            setProgress(0.7 + 0.3 * Math.min(1, m.done / sessions));
          } else if (m.type === "analysis") {
            stopAll();
            setResult(m.result);
            setProgress(1);
            setPhase("done");
          } else if (m.type === "error") {
            stopAll();
            setError(m.message);
            setPhase("error");
          }
        };
        worker.postMessage(
          msg,
          pools.map((p) => p.buffer)
        );
      };

      const nWorkers = Math.max(
        1,
        Math.min(MAX_WORKERS, navigator.hardwareConcurrency || 2, tasks.length)
      );
      const workers = Array.from({ length: nWorkers }, spawn);
      poolRef.current = workers;
      let nextTask = 0;
      let finished = 0;

      const assign = (worker: Worker, index: number) => {
        if (nextTask >= tasks.length) {
          // Nothing left for this worker. The first to run dry that is
          // not worker 0 is released; worker 0 stays for the analysis.
          if (index !== 0) {
            worker.terminate();
            poolRef.current = poolRef.current.filter((w) => w !== worker);
          }
          return;
        }
        const task = tasks[nextTask++];
        const msg: SimIn = {
          type: "simulate",
          taskId: task.taskId,
          policy: policies[task.entry],
          hands: task.hands,
          seed: task.seed,
          reportEvery: REPORT_EVERY,
        };
        worker.postMessage(msg);
      };

      workers.forEach((worker, index) => {
        worker.onmessage = (ev: MessageEvent<SimOut>) => {
          if (generation.current !== gen) return;
          const m = ev.data;
          if (m.type === "progress") {
            doneBy[m.taskId] = m.done;
            const done = doneBy.reduce((acc, d) => acc + d, 0);
            setProgress(0.7 * Math.min(1, done / totalHands));
          } else if (m.type === "simulated") {
            chunks.set(m.taskId, m.pool);
            doneBy[m.taskId] = m.pool.results.length;
            finished++;
            if (finished === tasks.length) {
              analyze(workers[0]);
            } else {
              assign(worker, index);
            }
          } else if (m.type === "error") {
            stopAll();
            setError(m.message);
            setPhase("error");
          }
        };
        worker.onerror = (e) => {
          if (generation.current !== gen) return;
          console.error(e);
          stopAll();
          setError("Simulation worker error (check the console).");
          setPhase("error");
        };
        assign(worker, index);
      });
    },
    [stopAll]
  );

  return { phase, progress, result, error, run, cancel };
}
