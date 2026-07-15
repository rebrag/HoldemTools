//hooks/useEquitySimluation.ts
/* eslint-disable no-empty */
import { useRef, useState } from "react";
import { buildDeck, tokenize } from "../lib/cards"; 
import { gameLabel, GameType } from "../lib/types";
import { wilsonHalf } from "../lib/stats";
import {
  DEFAULT_CI_PCT, DEFAULT_Z, MAX_PREFLOP_SAMPLES, MIN_PREFLOP_SAMPLES,
  REPORT_EVERY, MAX_WORKERS
} from "../lib/constants";
import { RANK_IDX, SUIT_IDX } from "../lib/cards";

// Updated Result type for N players
export type EquityResult = {
  wins: number[]; // Array of win counts for each seat
  ties: number;   // Total ties
  total: number;
  game: GameType;
};

type ComputeOptions = { dead?: string[] };

const workerCount = () => {
  const hc = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency || 4) : 4;
  return Math.max(1, Math.min(MAX_WORKERS, hc));
};

export function useEquitySimulation() {
  const [status, setStatus] = useState("");
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [samples, setSamples] = useState(0);
  const [result, setResult] = useState<EquityResult | null>(null);

  const poolRef = useRef<Worker[]>([]);
  const stoppedRef = useRef(false);

  const cancelAll = () => {
    stoppedRef.current = true;
    setComputing(false);
    setStatus("Simulation canceled.");
    const pool = poolRef.current;
    poolRef.current = [];
    for (const w of pool) {
      try { w.postMessage({ type: "cancel" as const }); } catch {}
      try { w.terminate(); } catch {}
    }
  };

  const validate = (
    board: string, hands: string[]
  ): { ok: boolean; msg?: string; game?: GameType } => {
    const b = tokenize(board);
    const tokensList = hands.map(h => tokenize(h));

    if (!(b.length === 0 || b.length === 3 || b.length === 4 || b.length === 5)) {
      return { ok: false, msg: "Board must have 0, 3, 4, or 5 cards." };
    }
    
    // Check all hands are same length and valid length
    const lens = tokensList.map(t => t.length);
    const firstLen = lens[0];
    
    // Check if lengths are uniform (except for empty seats if we allowed them, but here we expect full seats)
    if (!lens.every(l => l === firstLen)) {
        return { ok: false, msg: "All hands must be the same size." };
    }

    if (![2, 4, 5].includes(firstLen)) {
       return { ok: false, msg: "Hands must have 2, 4, or 5 cards." };
    }

    const all = [...b, ...tokensList.flat()];
    const set = new Set(all);
    if (set.size !== all.length) return { ok: false, msg: "Duplicate cards detected." };
    
    for (const c of all) {
      const r = c[0].toUpperCase();
      const s = c[1].toLowerCase();
      if (
        !Object.prototype.hasOwnProperty.call(RANK_IDX, r) ||
        !Object.prototype.hasOwnProperty.call(SUIT_IDX, s)
      ) {
        return { ok: false, msg: `Invalid card: ${c}` };
      }
    }

    const game: GameType = firstLen === 2 ? "texas-holdem" : firstLen === 4 ? "omaha4" : "omaha5";
    return { ok: true, game };
  };

  const exactPostflop = async (game: GameType, b: string[], hands: string[][], dead?: string[]) => {
    const deck = buildDeck();
    const used = new Set<string>([...b, ...hands.flat(), ...(dead ?? [])]);
    const avail = deck.filter((c) => !used.has(c));

    // Worker Message: Expects "wins" array instead of w1, w2
    type ExactMsg =
      | { type: "progress"; wins: number[]; t: number; n: number }
      | { type: "done"; wins: number[]; t: number; n: number };

    setStatus("Enumerating postflop runouts…");
    const w = new Worker(new URL("../workers/pheEquityWorker.ts", import.meta.url), { type: "module" });

    w.onmessage = (ev: MessageEvent<ExactMsg>) => {
      const m = ev.data;
      setResult({ wins: m.wins, ties: m.t, total: m.n, game });
      setSamples(m.n);
      if (m.type === "done") {
        const label = b.length === 3 ? "from the flop" : b.length === 4 ? "from the turn" : "on the river";
        setStatus(`Exact enumeration complete ${label} (${gameLabel[game]}).`);
        try { w.terminate(); } catch {}
      }
    };

    w.onerror = (e) => {
      console.error(e);
      setStatus("Postflop worker error.");
      try { w.terminate(); } catch {}
    };

    w.postMessage({ type: "start-exact", payload: { game, hands, board: b, avail } });
  };

  const compute = async (board: string, hands: string[], opts?: ComputeOptions) => {
    if (computing) return;
    setStatus("");

    const v = validate(board, hands);
    if (!v.ok) { setStatus(v.msg || "Invalid input."); return; }
    const game = v.game as GameType;

    const b = tokenize(board);
    const tokensList = hands.map(h => tokenize(h));

    // POSTFLOP PATH
    if (b.length > 0) {
      setComputing(true);
      await exactPostflop(game, b, tokensList, opts?.dead);
      setComputing(false);
      return;
    }

    // PREFLOP PATH
    setComputing(true);
    setProgress(0);
    setSamples(0);
    setStatus(`Simulating preflop ${gameLabel[game]} with ${workerCount()} workers…`);
    stoppedRef.current = false;

    // Aggregators
    const nPlayers = hands.length;
    const agg = { wins: new Array(nPlayers).fill(0), t: 0, n: 0, finished: 0 };
    
    const nWorkers = workerCount();
    const perMax = Math.ceil(MAX_PREFLOP_SAMPLES / nWorkers);
    const workers: Worker[] = [];
    poolRef.current = workers;

    const broadcastCancel = () => {
      for (const w of workers) {
        try { w.postMessage({ type: "cancel" as const }); } catch {}
      }
    };

    const finalize = (reason: "converged" | "cap" | "canceled") => {
      setComputing(false);
      const n = agg.n;
      // Use max CI half-width of any player
      let worst = 0;
      if (n > 0) {
          for (const w of agg.wins) {
              const p = (w + 0.5 * agg.t) / n;
              worst = Math.max(worst, wilsonHalf(p, n, DEFAULT_Z));
          }
      } else {
          worst = 1;
      }

      if (reason === "converged") {
        setStatus(`Precision target reached (worst CI ±${(worst * 100).toFixed(3)}%).`);
      } else if (reason === "cap") {
        setStatus(`Max samples reached (worst CI ±${(worst * 100).toFixed(3)}%).`);
      } else {
        setStatus("Simulation canceled.");
      }

      for (const w of workers) { try { w.terminate(); } catch {} }
      poolRef.current = [];
    };

    for (let i = 0; i < nWorkers; i++) {
      const w = new Worker(new URL("../workers/pheEquityWorker.ts", import.meta.url), { type: "module" });
      const seed = (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() + i * 1013904223)) >>> 0;

      // Worker Message: Expects "wins" array
      type IncMsg =
        | { type: "progress"; dwins: number[]; dt: number; dn: number }
        | { type: "done";     dwins: number[]; dt: number; dn: number };

      w.onmessage = (ev: MessageEvent<IncMsg>) => {
        if (stoppedRef.current) return;
        const m = ev.data;

        // Accumulate wins per player
        m.dwins.forEach((val, idx) => {
            agg.wins[idx] += val;
        });
        agg.t  += m.dt;
        agg.n  += m.dn;

        setSamples(agg.n);
        setResult({ wins: [...agg.wins], ties: agg.t, total: agg.n, game });
        setProgress(Math.min(1, agg.n / MAX_PREFLOP_SAMPLES));

        const n = agg.n;
        if (n > 0) {
          let worst = 0;
          for (const val of agg.wins) {
              const p = (val + 0.5 * agg.t) / n;
              worst = Math.max(worst, wilsonHalf(p, n, DEFAULT_Z));
          }
          
          setStatus(`Running… CI ±${(worst * 100).toFixed(3)}%`);

          if (n >= MIN_PREFLOP_SAMPLES && worst <= (DEFAULT_CI_PCT / 100)) {
            stoppedRef.current = true;
            broadcastCancel();
            finalize("converged");
            return;
          }
        }

        if (m.type === "done") {
          agg.finished += 1;
          if (agg.n >= MAX_PREFLOP_SAMPLES || agg.finished === workers.length) {
            stoppedRef.current = true;
            broadcastCancel();
            finalize("cap");
          }
        }
      };

      w.onerror = (e) => {
        console.error(e);
        if (!stoppedRef.current) {
          stoppedRef.current = true;
          broadcastCancel();
          setStatus("Worker error (check console).");
          setComputing(false);
        }
        try { w.terminate(); } catch {}
      };

      // PASS ARRAY OF HANDS
      w.postMessage({
        type: "start-preflop",
        payload: { 
            game, 
            hands: tokensList, // Changed from h1, h2
            seed, 
            reportEvery: REPORT_EVERY, 
            maxSamples: perMax, 
            dead: opts?.dead ?? [] 
        }
      });

      workers.push(w);
    }
  };

  return {
    computing, status, progress, samples, result,
    compute, cancelAll,
    workerCount
  };
}