// src/pages/private/useRankingsSim.ts
// Drives privateRankingsWorker: one worker per run, terminated on cancel, on
// re-run, and on unmount (frontend rule: workers must never outlive their page).
import { useEffect, useRef, useState } from "react";
import type { RankingsMode, RankingsOut, RankingsResult } from "./protocol";

const REPORT_EVERY = 25_000;

export function useRankingsSim() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<RankingsResult | null>(null);
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

  const run = (
    mode: RankingsMode,
    numHands: number,
    percents: number[],
    opponents: number,
    draws: number
  ) => {
    stop();
    setRunning(true);
    setProgress(0);
    setError(null);
    const w = new Worker(new URL("../../workers/privateRankingsWorker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<RankingsOut>) => {
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
      setError("Simulation worker error (check console).");
      setRunning(false);
      stop();
    };
    const seed = (Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) >>> 0;
    w.postMessage({
      type: "start",
      payload: { mode, numHands, percents, seed, reportEvery: REPORT_EVERY, opponents, draws },
    });
  };

  return { running, progress, result, error, run, cancel };
}
