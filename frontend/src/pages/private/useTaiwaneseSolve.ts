// src/pages/private/useTaiwaneseSolve.ts
// Drives taiwaneseWorker: one worker per solve, terminated on cancel, on
// re-run, and on unmount.
import { useEffect, useRef, useState } from "react";
import type { TaiwaneseOut, TaiwaneseResult } from "./protocol";

const REPORT_EVERY = 25;

export function useTaiwaneseSolve() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<TaiwaneseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const stop = () => {
    try { workerRef.current?.terminate(); } catch { /* already gone */ }
    workerRef.current = null;
  };

  useEffect(() => stop, []);

  const cancel = () => {
    stop();
    setRunning(false);
  };

  const solve = (heroCards: string[], opponents: number, boards: 1 | 2, samples: number) => {
    stop();
    setRunning(true);
    setProgress(0);
    setError(null);
    const w = new Worker(new URL("../../workers/taiwaneseWorker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<TaiwaneseOut>) => {
      const m = ev.data;
      if (m.type === "progress") {
        setProgress(m.done / m.total);
      } else if (m.type === "done") {
        setResult(m.result);
        setProgress(1);
        setRunning(false);
        stop();
      } else {
        setError(m.message);
        setRunning(false);
        stop();
      }
    };
    w.onerror = (e) => {
      console.error(e);
      setError("Solver worker error (check console).");
      setRunning(false);
      stop();
    };
    const seed = (Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) >>> 0;
    w.postMessage({
      type: "start",
      payload: { heroCards, opponents, boards, samples, seed, reportEvery: REPORT_EVERY },
    });
  };

  return { running, progress, result, error, solve, cancel };
}
