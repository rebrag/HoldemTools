/* eslint-disable no-empty */
import { useEffect, useRef, useState } from "react";
import { buildDeck, tokenize  } from "../lib/cards"; //sortCardsDesc
import { gameLabel, GameType, EquityResult } from "../lib/types";
import { wilsonHalf } from "../lib/stats";
import {
  DEFAULT_CI_PCT, DEFAULT_Z, MAX_PREFLOP_SAMPLES, MIN_PREFLOP_SAMPLES,
  REPORT_EVERY, MAX_WORKERS
} from "../lib/constants";
import { RANK_IDX, SUIT_IDX } from "../lib/cards";


type BarPct = { p1: number; tie: number; p2: number };

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
  const [barPct, setBarPct] = useState<BarPct>({ p1: 0, tie: 0, p2: 0 });

  const poolRef = useRef<Worker[]>([]);
  const stoppedRef = useRef(false);

  // update bar on result
  useEffect(() => {
    if (!result) return;
    const p1v = (100 * result.p1Win) / result.total;
    const tiev = (100 * result.ties) / result.total;
    const p2v = (100 * result.p2Win) / result.total;
    setBarPct({ p1: p1v, tie: tiev, p2: p2v });
  }, [result]);

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

  const validate = (board: string, p1: string, p2: string):
    { ok: boolean; msg?: string; game?: GameType } => {
    const b = tokenize(board);
    const h1 = tokenize(p1);
    const h2 = tokenize(p2);

    if (!(b.length === 0 || b.length === 3 || b.length === 4 || b.length === 5)) {
      return { ok: false, msg: "Board must have 0, 3, 4, or 5 cards." };
    }
    const both2 = h1.length === 2 && h2.length === 2;
    const both4 = h1.length === 4 && h2.length === 4;
    const both5 = h1.length === 5 && h2.length === 5;
    if (!(both2 || both4 || both5)) {
      return { ok: false, msg: "Both hands must have 2 (NLH), 4 (PLO4), or 5 (PLO5) cards." };
    }
    const all = [...b, ...h1, ...h2];
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

    const game: GameType = both2 ? "texas-holdem" : both4 ? "omaha4" : "omaha5";
    return { ok: true, game };
  };

  const exactPostflop = async (game: GameType, b: string[], h1: string[], h2: string[]) => {
    const deck = buildDeck();
    const used = new Set<string>([...b, ...h1, ...h2]);
    const avail = deck.filter((c) => !used.has(c));

    type ExactMsg =
      | { type: "progress"; w1: number; w2: number; t: number; n: number }
      | { type: "done"; w1: number; w2: number; t: number; n: number };

    setStatus("Enumerating postflop runouts…");
    const w = new Worker(new URL("../workers/pheEquityWorker.ts", import.meta.url), { type: "module" });

    w.onmessage = (ev: MessageEvent<ExactMsg>) => {
      const m = ev.data;
      setResult({ p1Win: m.w1, p2Win: m.w2, ties: m.t, total: m.n, game });
      setSamples(m.n);
      if (m.type === "done") {
        const label = b.length === 3 ? "from the flop" : b.length === 4 ? "from the turn" : "on the river";
        // No explicit counts in status to avoid showing runouts
        setStatus(`Exact enumeration complete ${label} (${gameLabel[game]}).`);
        try { w.terminate(); } catch {}
      }
    };

    w.onerror = (e) => {
      console.error(e);
      setStatus("Postflop worker error.");
      try { w.terminate(); } catch {}
    };

    w.postMessage({ type: "start-exact", payload: { game, h1, h2, board: b, avail } });
  };

  const compute = async (board: string, p1: string, p2: string) => {
    if (computing) return;
    setStatus("");
    // setResult(null);

    const v = validate(board, p1, p2);
    if (!v.ok) { setStatus(v.msg || "Invalid input."); return; }
    const game = v.game as GameType;

    const b = tokenize(board);
    const h1 = tokenize(p1);
    const h2 = tokenize(p2);

    if (b.length > 0) {
      setComputing(true);
      await exactPostflop(game, b, h1, h2);
      setComputing(false);
      return;
    }

    // Preflop Monte Carlo
    setComputing(true);
    setProgress(0);
    setSamples(0);
    setStatus(`Simulating preflop ${gameLabel[game]} with ${workerCount()} workers…`);
    stoppedRef.current = false;

    const agg = { w1: 0, w2: 0, t: 0, n: 0, finished: 0 };
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
      const p1p = n ? (agg.w1 + 0.5 * agg.t) / n : 0;
      const p2p = n ? (agg.w2 + 0.5 * agg.t) / n : 0;
      const worst = n ? Math.max(wilsonHalf(p1p, n, DEFAULT_Z), wilsonHalf(p2p, n, DEFAULT_Z)) : 1;

      if (reason === "converged") {
        setStatus(`Precision target reached (worst CI half-width ${(worst*100).toFixed(3)}%).`);
      } else if (reason === "cap") {
        setStatus(`Max samples reached (worst CI half-width ${(worst*100).toFixed(3)}%).`);
      } else {
        setStatus("Simulation canceled.");
      }

      for (const w of workers) { try { w.terminate(); } catch {} }
      poolRef.current = [];
    };

    for (let i = 0; i < nWorkers; i++) {
      const w = new Worker(new URL("../workers/pheEquityWorker.ts", import.meta.url), { type: "module" });
      const seed = (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() + i * 1013904223)) >>> 0;

      type IncMsg =
        | { type: "progress"; dw1: number; dw2: number; dt: number; dn: number }
        | { type: "done";     dw1: number; dw2: number; dt: number; dn: number };

      w.onmessage = (ev: MessageEvent<IncMsg>) => {
        if (stoppedRef.current) return;
        const m = ev.data;

        agg.w1 += m.dw1;
        agg.w2 += m.dw2;
        agg.t  += m.dt;
        agg.n  += m.dn;

        setSamples(agg.n);
        setResult({ p1Win: agg.w1, p2Win: agg.w2, ties: agg.t, total: agg.n, game });
        setProgress(Math.min(1, agg.n / MAX_PREFLOP_SAMPLES));

        const n = agg.n;
        if (n > 0) {
          const p1p = (agg.w1 + 0.5 * agg.t) / n;
          const p2p = (agg.w2 + 0.5 * agg.t) / n;
          const worst = Math.max(wilsonHalf(p1p, n, DEFAULT_Z), wilsonHalf(p2p, n, DEFAULT_Z));
          // Keep status generic—no sample counts shown
          setStatus(`Running… current worst CI half-width ${(worst*100).toFixed(3)}%`);

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

      w.postMessage({
        type: "start-preflop",
        payload: { game, h1, h2, seed, reportEvery: REPORT_EVERY, maxSamples: perMax }
      });

      workers.push(w);
    }
  };

  return {
    computing, status, progress, samples, result, barPct,
    compute, cancelAll,
    workerCount
  };
}
