// src/pages/private/useAdvancedSolves.ts
// Runs the Taiwanese advisor worker once per player, sequentially, to get
// every player's pre-board split ranking. Each solve sees only that player's
// 7 cards: opponents and boards are sampled from that player's remaining 45,
// exactly as when a player sets their hand knowing nothing else. One worker
// at a time, terminated between runs, on cancel, and on unmount.
import { useEffect, useRef, useState } from "react";
import type { LibraryEntry, TaiwaneseOut, TaiwaneseSplitResult } from "./protocol";

export interface PlayerRanking {
  cards: string[];
  /** All 105 splits sorted by pre-board EV descending; [0] is the pick. */
  splits: TaiwaneseSplitResult[];
}

export function useAdvancedSolves() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const cancelledRef = useRef(false);

  const stop = () => {
    try { workerRef.current?.terminate(); } catch { /* already gone */ }
    workerRef.current = null;
  };

  useEffect(() => () => {
    cancelledRef.current = true;
    stop();
  }, []);

  const cancel = () => {
    cancelledRef.current = true;
    stop();
    setRunning(false);
  };

  const run = (
    hands: string[][],
    opponents: number,
    boards: 1 | 2,
    samples: number,
    royalties: boolean,
    library: LibraryEntry[] | undefined,
    mixing: "pure" | "mixed",
    onDone: (rankings: PlayerRanking[]) => void
  ) => {
    stop();
    cancelledRef.current = false;
    setRunning(true);
    setProgress(0);
    setError(null);
    const rankings: PlayerRanking[] = [];
    const n = hands.length;

    const solveOne = (idx: number) => {
      if (cancelledRef.current) return;
      if (idx >= n) {
        setProgress(1);
        setRunning(false);
        onDone(rankings);
        return;
      }
      const w = new Worker(new URL("../../workers/taiwaneseWorker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = w;
      w.onmessage = (ev: MessageEvent<TaiwaneseOut>) => {
        const m = ev.data;
        if (m.type === "progress") {
          setProgress((idx + m.done / m.total) / n);
        } else if (m.type === "done") {
          rankings.push({ cards: hands[idx], splits: m.result.splits });
          stop();
          solveOne(idx + 1);
        } else if (m.type === "error") {
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
      const seed = (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() + idx)) >>> 0;
      w.postMessage({
        type: "start",
        payload: {
          heroCards: hands[idx],
          opponents,
          boards,
          royalties,
          samples,
          seed,
          reportEvery: 25,
          library,
          mixing,
        },
      });
    };

    solveOne(0);
  };

  return { running, progress, error, run, cancel };
}
