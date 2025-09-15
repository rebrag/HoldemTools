import React, { useEffect, useRef, useState } from "react";
import Layout from "./Layout";
import RandomizeButton from "./RandomizeButton";

// ---------- Config ----------
const DEFAULT_Z = 1.96;          // ≈95% confidence
const DEFAULT_CI_PCT = 0.5;      // stop when half-width ≤ 0.5%
const MIN_PREFLOP_SAMPLES = 4000;
const MAX_PREFLOP_SAMPLES = 200_000;
const REPORT_EVERY = 2000;

// ---------- Cards & helpers ----------
const RANKS = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"];
const SUITS = ["h","d","c","s"];
const RANK_IDX: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const SUIT_IDX: Record<string, number> = Object.fromEntries(SUITS.map((s, i) => [s, i]));

const norm = (t: string) => (t && t.length >= 2 ? t[0].toUpperCase() + t[1].toLowerCase() : "");
const tokenize = (s: string): string[] => (s.match(/([2-9TJQKA][hdcs])/gi) || []).map(norm);
const sortCardsDesc = (cards: string[]): string[] =>
  cards.slice().sort((a, b) => {
    const ra = RANK_IDX[a[0].toUpperCase()] ?? 999;
    const rb = RANK_IDX[b[0].toUpperCase()] ?? 999;
    if (ra !== rb) return ra - rb;
    const sa = SUIT_IDX[a[1].toLowerCase()] ?? 999;
    const sb = SUIT_IDX[b[1].toLowerCase()] ?? 999;
    return sa - sb;
  });

const buildDeck = (): string[] => {
  const deck: string[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
};

const sampleN = (avail: string[], n: number): string[] => {
  const a = avail.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
};

// ---------- Game types ----------
type GameType = "texas-holdem" | "omaha4" | "omaha5";
const gameLabel: Record<GameType, string> = {
  "texas-holdem": "NLH",
  "omaha4": "PLO4",
  "omaha5": "PLO5",
};

// ---------- Evaluator: use 'phe' 5-card rank ----------
import * as PHE from "phe";

// Try to locate an evaluateCards(cards: string[]) => number function in 'phe'
type Eval5 = (cards: string[]) => number;
function resolveEval5(): Eval5 {
  const mod = PHE as Record<string, unknown>;
  const cand1 = mod.evaluateCards;
  if (typeof cand1 === "function") return cand1 as Eval5;
  const cand2 = mod.evaluate;
  if (typeof cand2 === "function") return cand2 as Eval5;
  throw new Error(
    "Could not find evaluateCards(cards) in 'phe'. Try: import * as PHE from 'phe'; and use PHE.evaluateCards."
  );
}
const eval5: Eval5 = resolveEval5();

// Compare two 5-card ranks. Most PHE-style libs: **lower is stronger**.
// If you discover it's inverted, flip the signs here in one place.
const better = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);

// Best-of-7 (2 hole + 5 board) for NLH via 5-card evaluator.
function bestHoldem(board5: string[], hole2: string[]): number {
  const seven = [hole2[0], hole2[1], ...board5]; // indices 0..6
  let best = Number.POSITIVE_INFINITY;
  // choose 5 of 7 = exclude 2 indices
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 7; j++) {
      const hand5: string[] = [];
      for (let k = 0; k < 7; k++) {
        if (k !== i && k !== j) hand5.push(seven[k]);
      }
      const v = eval5(hand5);
      if (v < best) best = v;
    }
  }
  return best;
}

// Best-of-5 using Omaha rule (exactly 2 from hole, exactly 3 from board)
function bestOmaha(board5: string[], hole: string[]): number {
  const k = hole.length; // 4 or 5
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < k - 1; i++) {
    for (let j = i + 1; j < k; j++) {
      const h0 = hole[i], h1 = hole[j];
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 4; b++) {
          for (let c = b + 1; c < 5; c++) {
            const v = eval5([h0, h1, board5[a], board5[b], board5[c]]);
            if (v < best) best = v;
          }
        }
      }
    }
  }
  return best;
}

function evalPair(game: GameType, board5: string[], h1: string[], h2: string[]) {
  const v1 =
    game === "texas-holdem" ? bestHoldem(board5, h1) : bestOmaha(board5, h1);
  const v2 =
    game === "texas-holdem" ? bestHoldem(board5, h2) : bestOmaha(board5, h2);
  const cmp = better(v1, v2);
  if (cmp === 0) return { w1: 0, w2: 0, t: 1 };
  if (cmp < 0) return { w1: 1, w2: 0, t: 0 };
  return { w1: 0, w2: 1, t: 0 };
}

// Wilson half-width for a single proportion

// ---------- Component ----------
const EquityCalc: React.FC = () => {
  // Background sizing to match your table rail
  const [vw, setVw] = useState<number>(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [vh, setVh] = useState<number>(typeof window !== "undefined" ? window.innerHeight : 800);
  useEffect(() => {
    const onResize = () => { setVw(window.innerWidth); setVh(window.innerHeight); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const railPortrait = vw * 1.3 < vh;

  // Inputs
  const [board, setBoard] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");

  // Randomize animation coupling
  const [randFlag, setRandFlag] = useState(false);

  // Monte-Carlo controls
  const [ciTargetPct, setCiTargetPct] = useState<number>(DEFAULT_CI_PCT);
  const [zScore, setZScore] = useState<number>(DEFAULT_Z);

  // Status/results/progress
  const [status, setStatus] = useState("");
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 for preflop (based on max cap)
  const [samples, setSamples] = useState(0);

  const [result, setResult] = useState<{
    p1Win: number;
    p2Win: number;
    ties: number;
    total: number;
    game: GameType;
  } | null>(null);

  // Animated stacked bar
  const [barPct, setBarPct] = useState<{ p1: number; tie: number; p2: number }>({ p1: 0, tie: 0, p2: 0 });
  useEffect(() => {
  if (!result) return;
  const p1 = (100 * result.p1Win) / result.total;
  const tie = (100 * result.ties) / result.total;
  const p2 = (100 * result.p2Win) / result.total;
  setBarPct({ p1, tie, p2 });
}, [result]);


  // Worker pool (we’ll use a single worker by default; easy to extend)
  const workerRef = useRef<Worker | null>(null);
  const abortRef = useRef(false);

  // Helpers
  const usedSetFrom = (includeBoard: boolean, includeP1: boolean, includeP2: boolean) => {
    const used = new Set<string>();
    if (includeBoard) tokenize(board).forEach((c) => used.add(c));
    if (includeP1) tokenize(p1).forEach((c) => used.add(c));
    if (includeP2) tokenize(p2).forEach((c) => used.add(c));
    return used;
  };

  const randomizeBoard = () => {
    const deck = buildDeck();
    const used = usedSetFrom(false, true, true);
    const avail = deck.filter((c) => !used.has(c));
    const len = tokenize(board).length;
    const want = len === 4 ? 4 : len === 5 ? 5 : 3; // default flop; keep 4/5 if already
    const boardSorted = sortCardsDesc(sampleN(avail, want));
    setBoard(boardSorted.join(" "));
    setRandFlag((f) => !f);
  };
  const randomizeP1 = () => {
    const deck = buildDeck();
    const used = usedSetFrom(true, false, true);
    const avail = deck.filter((c) => !used.has(c));
    const cur = tokenize(p1).length;
    const want = cur >= 4 ? 5 : cur >= 3 ? 4 : 2; // escalate to 5 for PLO5
    const handSorted = sortCardsDesc(sampleN(avail, want));
    setP1(handSorted.join(" "));
    setRandFlag((f) => !f);
  };
  const randomizeP2 = () => {
    const deck = buildDeck();
    const used = usedSetFrom(true, true, false);
    const avail = deck.filter((c) => !used.has(c));
    const cur = tokenize(p2).length;
    const want = cur >= 4 ? 5 : cur >= 3 ? 4 : 2;
    const handSorted = sortCardsDesc(sampleN(avail, want));
    setP2(handSorted.join(" "));
    setRandFlag((f) => !f);
  };

  const validate = (): { ok: boolean; msg?: string; game?: GameType } => {
    const b = tokenize(board);
    const h1 = tokenize(p1);
    const h2 = tokenize(p2);

    if (!(b.length === 0 || b.length === 3 || b.length === 4 || b.length === 5)) {
      return { ok: false, msg: "Board must have 0 (pre), 3 (flop), 4 (turn), or 5 (river) cards." };
    }
    const both2 = h1.length === 2 && h2.length === 2;
    const both4 = h1.length === 4 && h2.length === 4;
    const both5 = h1.length === 5 && h2.length === 5;
    if (!(both2 || both4 || both5)) {
      return { ok: false, msg: "Both hands must have 2 (NLH) or 4 (PLO4) or 5 (PLO5) cards." };
    }

    const all = [...b, ...h1, ...h2];
    const set = new Set(all);
    if (set.size !== all.length) return { ok: false, msg: "Duplicate cards detected." };
    for (const c of all) {
      const r = c[0].toUpperCase(), s = c[1].toLowerCase();
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

  // Exact postflop enumeration on main thread
  const exactPostflop = async (game: GameType, b: string[], h1: string[], h2: string[]) => {
    const deck = buildDeck();
    const used = new Set<string>([...b, ...h1, ...h2]);
    const avail = deck.filter((c) => !used.has(c));

    let w1 = 0, w2 = 0, t = 0, tot = 0;

    const tally = (board5: string[]) => {
      const { w1: a, w2: b, t: tt } = evalPair(game, board5, h1, h2);
      w1 += a; w2 += b; t += tt; tot += 1;
    };

    if (b.length === 3) {
      // flop: choose 2 from avail for turn+river (unordered)
      for (let i = 0; i < avail.length; i++) {
        for (let j = i + 1; j < avail.length; j++) {
          tally([...b, avail[i], avail[j]]);
        }
      }
      setStatus(`Enumerated ${tot.toLocaleString()} runouts from the flop (${gameLabel[game]}).`);
    } else if (b.length === 4) {
      for (let i = 0; i < avail.length; i++) {
        tally([...b, avail[i]]);
      }
      setStatus(`Enumerated ${tot.toLocaleString()} runouts from the turn (${gameLabel[game]}).`);
    } else {
      tally(b);
      setStatus(`Evaluated final board (${gameLabel[game]}).`);
    }
    setResult({ p1Win: w1, p2Win: w2, ties: t, total: tot, game });
  };

  const cancelCompute = () => {
    abortRef.current = true;
    setComputing(false);
    setStatus("Simulation canceled.");
    setProgress(0);
    setSamples(0);
    const w = workerRef.current;
    if (w) {
      try { w.postMessage({ type: "cancel" as const }); } catch { /* ignore */ }
      try { w.terminate(); } catch { /* ignore */ }
      workerRef.current = null;
    }
  };

  const compute = async () => {
    if (computing) return;
    setStatus("");
    setResult(null);

    const v = validate();
    if (!v.ok) { setStatus(v.msg || "Invalid input."); return; }
    const game = v.game as GameType;

    const b = tokenize(board);
    const h1 = tokenize(p1);
    const h2 = tokenize(p2);

    // Postflop: exact enumeration on main thread
    if (b.length > 0) {
      setComputing(true);
      await exactPostflop(game, b, h1, h2);
      setComputing(false);
      return;
    }

    // Preflop: Monte-Carlo in worker with Wilson CI stop
    setComputing(true);
    setStatus(`Simulating preflop ${gameLabel[game]} (Wilson CI target ±${ciTargetPct}%, ${zScore === 1.96 ? "95%" : zScore === 1.645 ? "90%" : zScore === 2.576 ? "99%" : "custom"}).`);
    setProgress(0);
    setSamples(0);
    abortRef.current = false;

    // Spin up worker
    const worker = new Worker(new URL("../workers/pheEquityWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    type ProgressMsg = {
      type: "progress" | "done";
      w1: number; w2: number; t: number; n: number;
      estP1: number; estP2: number; estTie: number;
      half: number; // worst half-width
    };

    worker.onmessage = (ev: MessageEvent<ProgressMsg>) => {
      const msg = ev.data;
      // live bar + counts
      setSamples(msg.n);
      setResult({
        p1Win: msg.w1,
        p2Win: msg.w2,
        ties: msg.t,
        total: msg.n,
        game
      });
      setStatus(`Samples: ${msg.n.toLocaleString()}  ·  worst CI half-width: ${(msg.half*100).toFixed(3)}%`);
      setProgress(Math.min(1, msg.n / MAX_PREFLOP_SAMPLES));

      if (msg.type === "done") {
        setComputing(false);
        setStatus(`Converged at ${msg.n.toLocaleString()} samples (worst CI half-width ${(msg.half*100).toFixed(3)}%).`);
        try { worker.terminate(); } catch { /* ignore */ }
        workerRef.current = null;
      }
    };

    worker.onerror = (e) => {
      setComputing(false);
      setStatus("Worker error (see console).");
      console.error(e);
      try { worker.terminate(); } catch { /* ignore */ }
      workerRef.current = null;
    };

    worker.postMessage({
      type: "start",
      payload: {
        game,
        h1,
        h2,
        z: zScore,
        eps: ciTargetPct / 100,
        minSamples: MIN_PREFLOP_SAMPLES,
        maxSamples: MAX_PREFLOP_SAMPLES,
        reportEvery: REPORT_EVERY,
      }
    });
  };

  // Display strings
  const boardSortedStr = sortCardsDesc(tokenize(board)).join(" ");
  const p1SortedStr = sortCardsDesc(tokenize(p1)).join(" ");
  const p2SortedStr = sortCardsDesc(tokenize(p2)).join(" ");
  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(2) + "%" : "—");

  return (
    <Layout>
      <div className="relative flex items-center justify-center py-6 min-h-[70vh]">
        {/* Poker table background */}
        <div className="poker-table-bg pointer-events-none absolute inset-0 flex justify-center items-center z-0">
          <div className={`poker-rail ${railPortrait ? "portrait" : ""} overflow-hidden relative`}>
            <div className="poker-felt" />
          </div>
        </div>

        {/* Foreground */}
        <div className="relative z-10 w-full max-w-3xl px-4">
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-xl sm:text-2xl font-bold">Equity Calculator</h1>
              <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                Mode:&nbsp;
                {(() => {
                  const k = tokenize(p1).length;
                  return k >= 5 ? "PLO5" : k >= 4 ? "PLO4" : "NLH";
                })()}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Inputs */}
              <div className="space-y-3">
                {/* Board */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Board (Preflop / Flop / Turn / River)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      value={board}
                      onChange={(e) => setBoard(e.target.value)}
                      placeholder="Flop: Ah Kh Qd · Turn: +2c · River: +9h · Preflop: leave empty"
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <RandomizeButton
                      randomFillEnabled={randFlag}
                      setRandomFillEnabled={randomizeBoard}
                      animationSpeed={0.5}
                    />
                  </div>
                </div>

                {/* Player 1 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Player 1 (2 = NLH, 4 = PLO4, 5 = PLO5)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      value={p1}
                      onChange={(e) => setP1(e.target.value)}
                      placeholder="NLH: As Kd · PLO4: As Kd Qh Tc · PLO5: add one more"
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <RandomizeButton
                      randomFillEnabled={randFlag}
                      setRandomFillEnabled={randomizeP1}
                      animationSpeed={0.5}
                    />
                  </div>
                </div>

                {/* Player 2 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Player 2 (2 = NLH, 4 = PLO4, 5 = PLO5)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      value={p2}
                      onChange={(e) => setP2(e.target.value)}
                      placeholder="NLH: Qc Jh · PLO4/5: add 2/3 more"
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <RandomizeButton
                      randomFillEnabled={randFlag}
                      setRandomFillEnabled={randomizeP2}
                      animationSpeed={0.5}
                    />
                  </div>
                </div>

                {/* Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      cancelCompute();
                      setBoard(""); setP1(""); setP2("");
                      setResult(null); setStatus("");
                      setProgress(0); setSamples(0);
                      setBarPct({ p1:0, tie:0, p2:0 });
                    }}
                    className="rounded-lg px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800"
                  >
                    Clear
                  </button>
                  {!computing ? (
                    <button
                      type="button"
                      onClick={compute}
                      className="rounded-lg px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      Compute
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={cancelCompute}
                      className="rounded-lg px-3 py-2 bg-red-600 hover:bg-red-700 text-white"
                    >
                      Cancel
                    </button>
                  )}

                  {/* CI inputs */}
                  <div className="ml-auto flex items-center gap-2 text-sm">
                    <label className="text-gray-600">CI target</label>
                    <input
                      type="number"
                      min={0.05} step={0.05}
                      value={ciTargetPct}
                      onChange={(e) => setCiTargetPct(Math.max(0.01, Number(e.target.value)))}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1"
                    />
                    <span className="text-gray-600">%</span>

                    <label className="text-gray-600 ml-3">z</label>
                    <select
                      value={String(zScore)}
                      onChange={(e) => setZScore(Number(e.target.value))}
                      className="rounded-md border border-gray-300 px-2 py-1"
                    >
                      <option value="1.645">1.645 (90%)</option>
                      <option value="1.96">1.96 (95%)</option>
                      <option value="2.576">2.576 (99%)</option>
                    </select>
                  </div>
                </div>

                {/* Status + progress */}
                {(computing || status) && (
                  <div className="space-y-1">
                    {status && <p className="text-xs text-gray-600">{status}</p>}
                    {computing && (
                      <div className="mt-1">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                          <div
                            className="h-full bg-emerald-600 transition-all duration-200"
                            style={{ width: `${Math.round(progress * 100)}%` }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-gray-600">
                          <span>{samples.toLocaleString()} / {MAX_PREFLOP_SAMPLES.toLocaleString()} samples</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Results */}
              <div className="rounded-xl bg-white p-4 border border-gray-100">
                <h2 className="font-semibold mb-2">Results</h2>
                <div className="text-sm space-y-2">
                  <div>
                    <span className="font-medium">Board:</span>{" "}
                    {boardSortedStr || <em className="text-gray-400">— (preflop)</em>}
                  </div>
                  <div>
                    <span className="font-medium">Hand 1:</span>{" "}
                    {p1SortedStr || <em className="text-gray-400">—</em>}
                  </div>
                  <div>
                    <span className="font-medium">Hand 2:</span>{" "}
                    {p2SortedStr || <em className="text-gray-400">—</em>}
                  </div>

                  <hr className="my-2" />

                  {result ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-700">{p1SortedStr || "Hand 1"}</span>
                        <span className="font-medium">
                          {pct(result.p1Win, result.total)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-700">{p2SortedStr || "Hand 2"}</span>
                        <span className="font-medium">
                          {pct(result.p2Win, result.total)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-gray-600">
                        <span>Tie</span>
                        <span>{pct(result.ties, result.total)}</span>
                      </div>

                      {/* Animated stacked bar */}
                      <div className="mt-2">
                        <div
                          className="relative flex h-3 w-full overflow-hidden rounded-full bg-gray-200"
                          aria-label="Win percentage bar"
                          role="img"
                        >
                          <div
                            className="h-full flex-none bg-emerald-600 transition-all duration-300 ease-out"
                            style={{ width: `${barPct.p1}%` }}
                            title={`Hand 1: ${barPct.p1.toFixed(2)}%`}
                          />
                          <div
                            className="h-full flex-none bg-gray-300 transition-all duration-300 ease-out"
                            style={{ width: `${barPct.tie}%` }}
                            title={`Tie: ${barPct.tie.toFixed(2)}%`}
                          />
                          <div
                            className="h-full flex-none bg-indigo-600 transition-all duration-300 ease-out"
                            style={{ width: `${barPct.p2}%` }}
                            title={`Hand 2: ${barPct.p2.toFixed(2)}%`}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-gray-600">
                          <div className="flex items-center gap-1">
                            <span className="inline-block h-2 w-2 rounded-sm bg-emerald-600" />
                            <span>Hand 1</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="inline-block h-2 w-2 rounded-sm bg-gray-300" />
                            <span>Tie</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="inline-block h-2 w-2 rounded-sm bg-indigo-600" />
                            <span>Hand 2</span>
                          </div>
                        </div>
                      </div>

                      <p className="mt-2 text-xs text-gray-500">
                        Total runouts: {result.total.toLocaleString()}
                      </p>
                    </>
                  ) : (
                    <p className="text-gray-500">
                      Preflop Monte-Carlo stops automatically when the Wilson CI half-width
                      falls below your target.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <p className="mt-4 text-xs text-gray-500">
              Postflop results are exact. Preflop uses a streaming worker with a Wilson confidence interval stopper.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default EquityCalc;
