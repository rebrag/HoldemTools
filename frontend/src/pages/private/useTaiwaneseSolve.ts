// src/pages/private/useTaiwaneseSolve.ts
// Drives taiwaneseWorker for one hand. The scenario budget is split across a
// worker pool and the per-split totals are pooled before ranking, so raising
// the sample count costs wall time only in proportion to 1/cores. Workers are
// terminated on cancel, on re-run, and on unmount.
import { useEffect, useRef, useState } from "react";
import { enumerateSplits, splitCards } from "@/lib/taiwanese";
import type { LibraryEntry, TaiwaneseOut, TaiwaneseResult, TaiwaneseSplitResult } from "./protocol";

const REPORT_EVERY = 100;
const MAX_WORKERS = 6;

const SPLITS = enumerateSplits();

const workerCount = () => {
  const hc = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(MAX_WORKERS, hc - 1));
};

export function useTaiwaneseSolve() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<TaiwaneseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poolRef = useRef<Worker[]>([]);
  const cancelledRef = useRef(false);

  const stopAll = () => {
    for (const w of poolRef.current) {
      try { w.terminate(); } catch { /* already gone */ }
    }
    poolRef.current = [];
  };

  useEffect(() => () => { cancelledRef.current = true; stopAll(); }, []);

  const cancel = () => {
    cancelledRef.current = true;
    stopAll();
    setRunning(false);
  };

  const solve = async (
    heroCards: string[],
    opponents: number,
    boards: 1 | 2,
    samples: number,
    royalties: boolean,
    library?: LibraryEntry[],
    mixing?: "pure" | "mixed"
  ) => {
    cancelledRef.current = false;
    stopAll();
    setRunning(true);
    setProgress(0);
    setError(null);

    const nWorkers = workerCount();
    const per = Math.max(1, Math.ceil(samples / nWorkers));
    const totalSamples = per * nWorkers;
    const pool = Array.from({ length: nWorkers }, () =>
      new Worker(new URL("../../workers/taiwaneseWorker.ts", import.meta.url), { type: "module" })
    );
    poolRef.current = pool;

    const doneBy = new Array<number>(nWorkers).fill(0);

    const runOne = (w: Worker, k: number): Promise<TaiwaneseResult | null> =>
      new Promise((resolve) => {
        w.onmessage = (ev: MessageEvent<TaiwaneseOut>) => {
          const m = ev.data;
          if (m.type === "progress") {
            doneBy[k] = m.done;
            const total = doneBy.reduce((a, b) => a + b, 0);
            setProgress(Math.min(1, total / totalSamples));
          } else if (m.type === "done") {
            resolve(m.result);
          } else if (m.type === "error") {
            setError(m.message);
            resolve(null);
          }
        };
        w.onerror = (e) => {
          console.error(e);
          setError("Solver worker error (check console).");
          resolve(null);
        };
        w.postMessage({
          type: "start",
          payload: {
            heroCards,
            opponents,
            boards,
            royalties,
            samples: per,
            seed: (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() + k * 2654435761)) >>> 0,
            reportEvery: REPORT_EVERY,
            library,
            mixing,
          },
        });
      });

    const parts = await Promise.all(pool.map((w, k) => runOne(w, k)));
    stopAll();
    if (cancelledRef.current || parts.some((p) => p === null)) {
      setRunning(false);
      return;
    }

    // Pool the per-split totals, then rank once. Each worker ran the same
    // splits over independent scenarios, so the sums simply add.
    const n = SPLITS.length;
    const sum = new Float64Array(n);
    const sqSum = new Float64Array(n);
    for (const p of parts) {
      const es = p!.evSum;
      const eq = p!.evSqSum;
      if (!es || !eq) continue;
      for (let i = 0; i < n; i++) { sum[i] += es[i]; sqSum[i] += eq[i]; }
    }
    const splits: TaiwaneseSplitResult[] = SPLITS.map((sp, i) => {
      const mean = sum[i] / totalSamples;
      const variance = Math.max(0, (sqSum[i] - (sum[i] * sum[i]) / totalSamples) / (totalSamples - 1));
      return {
        ...splitCards(sp, heroCards),
        evPoints: mean,
        evStdErr: Math.sqrt(variance / totalSamples),
      };
    }).sort((a, b) => b.evPoints - a.evPoints);

    setResult({
      samples: totalSamples,
      opponents,
      boards,
      royalties,
      splits,
    });
    setProgress(1);
    setRunning(false);
  };

  return { running, progress, result, error, solve, cancel };
}
