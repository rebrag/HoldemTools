// src/pages/private/useSelfPlayLibrary.ts
// Provides the self-play opponent library. Resolution order:
//   1. session cache;
//   2. a precomputed file under /taiwanese-libs/ (built overnight by
//      `npm run precompute:taiwanese`, far larger than a live build);
//   3. an in-browser build over a worker pool (policy iteration, as in the
//      Node script but sized for interactive waiting).
//
// House rules settle every pair of players separately, so a hand's EV is
// exactly linear in the opponent count and the best-response policy is
// IDENTICAL for any N: house libraries are keyed by boards only. PokerNews
// winner-take-all does depend on N; precomputed files there are built at one
// representative N and reused (documented approximation), while in-browser
// builds use the requested N.
import { useEffect, useRef, useState } from "react";
import { decodeLibrary, summarizeRound } from "@/lib/taiwaneseSolver";
import type {
  BatchHandStat,
  LibraryEntry,
  LibraryFile,
  LibraryLevelStats,
  OpponentLibrary,
  TaiwaneseOut,
} from "./protocol";

const cache = new Map<string, OpponentLibrary>();
const fetchFailed = new Set<string>();

const fileKeyOf = (boards: 1 | 2, royalties: boolean) =>
  `${royalties ? "pokernews" : "house"}-${boards}b`;

const memKeyOf = (opponents: number, boards: 1 | 2, royalties: boolean) =>
  royalties ? `p|${boards}|${opponents}` : `h|${boards}`;

export function cachedLibrary(
  opponents: number,
  boards: 1 | 2,
  royalties: boolean
): OpponentLibrary | null {
  return cache.get(memKeyOf(opponents, boards, royalties)) ?? null;
}

// In-browser build sizing (the precomputed files dwarf this; see
// scripts/precompute-taiwanese.mjs). ENTRIES is the opponent-hand pool
// (accuracy ceiling), LEVELS the policy-iteration rounds, INNER_SAMPLES the
// scenarios per hand per round.
const ENTRIES = 1500;
const INNER_SAMPLES = 300;
const LEVELS = 3;

/** Exposed so the page can state the opponent pool size it is quoting. */
export const LIBRARY_ENTRIES = ENTRIES;

const MAX_WORKERS = 6;
const workerCount = () => {
  const hc = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(MAX_WORKERS, hc - 1));
};

const newWorker = () =>
  new Worker(new URL("../../workers/taiwaneseWorker.ts", import.meta.url), { type: "module" });

export function useSelfPlayLibrary() {
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState(0);
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
    setBuilding(false);
  };

  /** Resolves with the library (cached, fetched, or built), or null on error/cancel. */
  const ensure = async (
    opponents: number,
    boards: 1 | 2,
    royalties: boolean
  ): Promise<OpponentLibrary | null> => {
    const memKey = memKeyOf(opponents, boards, royalties);
    const hit = cache.get(memKey);
    if (hit) return hit;

    // Precomputed file, once per session per key.
    const fileKey = fileKeyOf(boards, royalties);
    if (!fetchFailed.has(fileKey)) {
      try {
        const res = await fetch(`/taiwanese-libs/${fileKey}.json`);
        if (res.ok) {
          const file = (await res.json()) as LibraryFile;
          const lib = decodeLibrary(file);
          cache.set(memKey, lib);
          return lib;
        }
        fetchFailed.add(fileKey);
      } catch {
        fetchFailed.add(fileKey);
      }
    }

    // In-browser build. House policy is N-independent, so build at 1 opponent
    // (cheapest); PokerNews at the requested N.
    const buildOpponents = royalties ? opponents : 1;

    cancelledRef.current = false;
    stopAll();
    setBuilding(true);
    setProgress(0);
    setError(null);

    const nWorkers = workerCount();
    const pool = Array.from({ length: nWorkers }, newWorker);
    poolRef.current = pool;

    // One fixed evaluation set, re-solved every round, so consecutive rounds'
    // policies are comparable hand by hand.
    const deck: string[] = [];
    const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
    for (const r of RANKS) for (const s of ["h", "d", "c", "s"]) deck.push(r + s);
    const hands: string[][] = [];
    for (let e = 0; e < ENTRIES; e++) {
      const a = [...deck];
      for (let t = 0; t < 7; t++) {
        const j = t + Math.floor(Math.random() * (a.length - t));
        [a[t], a[j]] = [a[j], a[t]];
      }
      hands.push(a.slice(0, 7));
    }

    // Round-robin so every worker gets a comparable slice.
    const chunks: number[][] = Array.from({ length: nWorkers }, () => []);
    hands.forEach((_, i) => chunks[i % nWorkers].push(i));

    const totalHands = ENTRIES * LEVELS;
    let doneHands = 0;

    const runChunk = (
      w: Worker,
      idxs: number[],
      library: LibraryEntry[] | undefined,
      prevIdx: number[] | undefined
    ): Promise<{ entries: LibraryEntry[]; stats: BatchHandStat[] } | null> =>
      new Promise((resolve) => {
        let lastReported = 0;
        w.onmessage = (ev: MessageEvent<TaiwaneseOut>) => {
          const m = ev.data;
          if (m.type === "progress") {
            doneHands += m.done - lastReported;
            lastReported = m.done;
            setProgress(Math.min(1, doneHands / totalHands));
          } else if (m.type === "batch-done") {
            doneHands += idxs.length - lastReported;
            setProgress(Math.min(1, doneHands / totalHands));
            resolve({ entries: m.entries, stats: m.stats });
          } else if (m.type === "error") {
            setError(m.message);
            resolve(null);
          }
        };
        w.onerror = (e) => {
          console.error(e);
          setError("Library build worker error (check console).");
          resolve(null);
        };
        w.postMessage({
          type: "solve-batch",
          payload: {
            hands: idxs.map((i) => hands[i]),
            opponents: buildOpponents,
            boards,
            royalties,
            samples: INNER_SAMPLES,
            seed: (Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) >>> 0,
            library,
            prevIdx: prevIdx ? idxs.map((i) => prevIdx[i]) : undefined,
            mixing: "mixed",
            reportEvery: 5,
          },
        });
      });

    let policy: LibraryEntry[] | undefined;
    let prevIdx: number[] | undefined;
    const stats: LibraryLevelStats[] = [];

    for (let level = 1; level <= LEVELS; level++) {
      const results = await Promise.all(
        chunks.map((idxs, k) => runChunk(pool[k], idxs, policy, prevIdx))
      );
      if (cancelledRef.current || results.some((r) => r === null)) {
        stopAll();
        setBuilding(false);
        return null;
      }
      const nextPolicy = new Array<LibraryEntry>(ENTRIES);
      const nextIdx = new Array<number>(ENTRIES);
      const orderedStats = new Array<BatchHandStat>(ENTRIES);
      chunks.forEach((idxs, k) => {
        const r = results[k]!;
        idxs.forEach((handIdx, j) => {
          nextPolicy[handIdx] = r.entries[j];
          nextIdx[handIdx] = r.stats[j].bestIdx;
          orderedStats[handIdx] = r.stats[j];
        });
      });
      stats.push(summarizeRound(level, orderedStats, prevIdx ?? null));
      policy = nextPolicy;
      prevIdx = nextIdx;
    }

    stopAll();
    setBuilding(false);
    const library: OpponentLibrary = {
      entries: policy as LibraryEntry[],
      stats,
      opponents: buildOpponents,
      boards,
      royalties,
    };
    cache.set(memKey, library);
    return library;
  };

  return { ensure, building, progress, error, cancel };
}
