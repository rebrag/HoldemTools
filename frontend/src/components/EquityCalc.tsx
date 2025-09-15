// src/components/EquityCalc.tsx
import React, { useEffect, useState } from "react";
import Layout from "./Layout";
import RandomizeButton from "./RandomizeButton";
import { Hand } from "pokersolver";

/** ---------- config ---------- */
const PREFLOP_SAMPLES = 50_000; // increase for more precision if desired

/** ---------- card helpers ---------- */
const RANKS = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"]; // high → low
const SUITS = ["h","d","c","s"]; // tie-breaker order for display
const RANK_IDX: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const SUIT_IDX: Record<string, number> = Object.fromEntries(SUITS.map((s, i) => [s, i]));

const norm = (t: string) =>
  t && t.length >= 2 ? t[0].toUpperCase() + t[1].toLowerCase() : "";

// Extract tokens like Ah,Kh,Qd even if user types "AhKhQd" or "Ah Kh Qd"
const tokenize = (s: string): string[] =>
  (s.match(/([2-9TJQKA][hdcs])/gi) || []).map(norm);

// Sort cards high → low (rank, then suit for stable order)
const sortCardsDesc = (cards: string[]): string[] =>
  cards.slice().sort((a, b) => {
    const ra = RANK_IDX[a[0].toUpperCase()] ?? 999;
    const rb = RANK_IDX[b[0].toUpperCase()] ?? 999;
    if (ra !== rb) return ra - rb; // lower index = higher rank
    const sa = SUIT_IDX[a[1].toLowerCase()] ?? 999;
    const sb = SUIT_IDX[b[1].toLowerCase()] ?? 999;
    return sa - sb;
  });

// Build 52-card deck
const buildDeck = (): string[] => {
  const deck: string[] = [];
  for (const r of RANKS) for (const su of SUITS) deck.push(r + su);
  return deck;
};

// Sample N distinct cards from available (partial Fisher–Yates)
const sampleN = (avail: string[], n: number): string[] => {
  const a = avail.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
};

const EquityCalc: React.FC = () => {
  // match PlateGrid’s portrait/landscape feel for the rail
  const [vw, setVw] = useState<number>(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [vh, setVh] = useState<number>(typeof window !== "undefined" ? window.innerHeight : 800);
  useEffect(() => {
    const onResize = () => { setVw(window.innerWidth); setVh(window.innerHeight); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const railPortrait = vw * 1.3 < vh;

  // inputs
  const [board, setBoard] = useState<string>("");
  const [p1, setP1] = useState<string>("");
  const [p2, setP2] = useState<string>("");

  // randomize btn animation flag (not logic)
  const [randFlag, setRandFlag] = useState<boolean>(false);

  // results + status
  const [status, setStatus] = useState<string>("");
  const [result, setResult] = useState<{
    p1Win: number;
    p2Win: number;
    ties: number;
    total: number;
  } | null>(null);

  // Animated bar % (P1 | Tie | P2)
  const [barPct, setBarPct] = useState<{ p1: number; tie: number; p2: number }>({ p1: 0, tie: 0, p2: 0 });

  // helpers to avoid duplicate cards across fields
  const usedSetFrom = (includeBoard: boolean, includeP1: boolean, includeP2: boolean) => {
    const used = new Set<string>();
    if (includeBoard) tokenize(board).forEach((c) => used.add(c));
    if (includeP1) tokenize(p1).forEach((c) => used.add(c));
    if (includeP2) tokenize(p2).forEach((c) => used.add(c));
    return used;
  };

  // Randomizers (sorted high → low)
  const randomizeBoard = () => {
    const deck = buildDeck();
    const used = usedSetFrom(false, true, true);
    const avail = deck.filter((c) => !used.has(c));
    const want = (() => {
      const len = tokenize(board).length;
      return len === 4 ? 4 : 3; // if user is in "turn mode", generate 4; else 3 (flop)
    })();
    const boardSorted = sortCardsDesc(sampleN(avail, want));
    setBoard(boardSorted.join(" "));
    setRandFlag((f) => !f);
  };
  const randomizeP1 = () => {
    const deck = buildDeck();
    const used = usedSetFrom(true, false, true);
    const avail = deck.filter((c) => !used.has(c));
    const handSorted = sortCardsDesc(sampleN(avail, 2));
    setP1(handSorted.join(" "));
    setRandFlag((f) => !f);
  };
  const randomizeP2 = () => {
    const deck = buildDeck();
    const used = usedSetFrom(true, true, false);
    const avail = deck.filter((c) => !used.has(c));
    const handSorted = sortCardsDesc(sampleN(avail, 2));
    setP2(handSorted.join(" "));
    setRandFlag((f) => !f);
  };

  // validation (accept 0, 3, 4, or 5 board cards)
  const validate = (): { ok: boolean; msg?: string } => {
    const b = tokenize(board);
    const h1 = tokenize(p1);
    const h2 = tokenize(p2);
    if (!(b.length === 0 || b.length === 3 || b.length === 4 || b.length === 5)) {
      return { ok: false, msg: "Board must have 0 (preflop), 3 (flop), 4 (turn), or 5 (river) cards." };
    }
    if (h1.length !== 2) return { ok: false, msg: "Player 1 must have exactly 2 cards." };
    if (h2.length !== 2) return { ok: false, msg: "Player 2 must have exactly 2 cards." };
    const all = [...b, ...h1, ...h2];
    const set = new Set(all);
    if (set.size !== all.length) return { ok: false, msg: "Duplicate cards detected across inputs." };
    // keep classic hasOwnProperty.call as requested
    for (const c of all) {
      const r = c[0].toUpperCase(), s = c[1].toLowerCase();
      if (
        !Object.prototype.hasOwnProperty.call(RANK_IDX, r) ||
        !Object.prototype.hasOwnProperty.call(SUIT_IDX, s)
      ) {
        return { ok: false, msg: `Invalid card: ${c}` };
      }
    }
    return { ok: true };
  };

  // exact equities (flop/turn/river) or Monte Carlo (preflop)
  const computeEquity = () => {
    setStatus("");
    setResult(null);

    const v = validate();
    if (!v.ok) {
      setStatus(v.msg || "Invalid input.");
      return;
    }

    const b = tokenize(board);
    const h1 = tokenize(p1);
    const h2 = tokenize(p2);

    const deck = buildDeck();
    const used = new Set<string>([...b, ...h1, ...h2]);
    const avail = deck.filter((c) => !used.has(c));

    let p1Win = 0, p2Win = 0, ties = 0, tot = 0;

    if (b.length === 0) {
      // PREFLOP: Monte Carlo N random 5-card boards
      for (let k = 0; k < PREFLOP_SAMPLES; k++) {
        const board5 = sampleN(avail, 5);
        tot++;
        const hand1 = Hand.solve([...h1, ...board5], "texas-holdem");
        const hand2 = Hand.solve([...h2, ...board5], "texas-holdem");
        const winners = Hand.winners([hand1, hand2]);
        if (winners.length === 2) ties++;
        else if (winners[0] === hand1) p1Win++;
        else p2Win++;
      }
      setStatus(`Simulated ${tot.toLocaleString()} random boards (preflop Monte Carlo).`);
    } else if (b.length === 3) {
      // FLOP: choose 2 cards (order doesn't matter)
      for (let i = 0; i < avail.length; i++) {
        const turn = avail[i];
        for (let j = i + 1; j < avail.length; j++) {
          const river = avail[j];
          tot++;
          const board7 = [...b, turn, river];
          const hand1 = Hand.solve([...h1, ...board7], "texas-holdem");
          const hand2 = Hand.solve([...h2, ...board7], "texas-holdem");
          const winners = Hand.winners([hand1, hand2]);
          if (winners.length === 2) ties++;
          else if (winners[0] === hand1) p1Win++;
          else p2Win++;
        }
      }
      setStatus(`Enumerated ${tot.toLocaleString()} runouts from the flop.`);
    } else if (b.length === 4) {
      // TURN: choose 1 river
      for (let i = 0; i < avail.length; i++) {
        const river = avail[i];
        tot++;
        const board7 = [...b, river]; // b already has 4
        const hand1 = Hand.solve([...h1, ...board7], "texas-holdem");
        const hand2 = Hand.solve([...h2, ...board7], "texas-holdem");
        const winners = Hand.winners([hand1, hand2]);
        if (winners.length === 2) ties++;
        else if (winners[0] === hand1) p1Win++;
        else p2Win++;
      }
      setStatus(`Enumerated ${tot.toLocaleString()} runouts from the turn.`);
    } else {
      // RIVER: evaluate directly
      tot = 1;
      const hand1 = Hand.solve([...h1, ...b], "texas-holdem");
      const hand2 = Hand.solve([...h2, ...b], "texas-holdem");
      const winners = Hand.winners([hand1, hand2]);
      if (winners.length === 2) ties = 1;
      else if (winners[0] === hand1) p1Win = 1;
      else p2Win = 1;
      setStatus(`Evaluated final board.`);
    }

    setResult({ p1Win, p2Win, ties, total: tot });
  };

  // Animate the bar when result updates
  useEffect(() => {
    if (!result) return;
    const p1 = (100 * result.p1Win) / result.total;
    const tie = (100 * result.ties) / result.total;
    const p2 = (100 * result.p2Win) / result.total;
    setBarPct({ p1, tie, p2 });
  }, [result]);

  // Always display sorted cards in the results panel
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

        {/* Foreground card */}
        <div className="relative z-10 w-full max-w-3xl px-4">
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-4 sm:p-6">
            <h1 className="text-xl sm:text-2xl font-bold mb-4">Equity Calculator</h1>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Inputs */}
              <div className="space-y-3">
                {/* Board */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Board (Preflop / Flop / Turn / River)</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={board}
                      onChange={(e) => setBoard(e.target.value)}
                      placeholder="Preflop: leave empty · Flop: Ah Kh Qd · Turn: Ah Kh Qd 2c · River: Ah Kh Qd 2c 9h"
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Player 1</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={p1}
                      onChange={(e) => setP1(e.target.value)}
                      placeholder="e.g. As Kd"
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Player 2</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={p2}
                      onChange={(e) => setP2(e.target.value)}
                      placeholder="e.g. Qc Jh"
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <RandomizeButton
                      randomFillEnabled={randFlag}
                      setRandomFillEnabled={randomizeP2}
                      animationSpeed={0.5}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBoard(""); setP1(""); setP2("");
                      setResult(null); setStatus(""); setBarPct({ p1: 0, tie: 0, p2: 0 });
                    }}
                    className="rounded-lg px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={computeEquity}
                    className="rounded-lg px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    Compute
                  </button>
                </div>

                {status && <p className="text-xs text-gray-500">{status}</p>}
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
                      {/* Compact rows: Win% for each hand + Tie% */}
                      <div className="flex items-center justify-between">
                        <span className="text-gray-700">{p1SortedStr || "Hand 1"}</span>
                        <span className="font-medium">{pct(result.p1Win, result.total)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-700">{p2SortedStr || "Hand 2"}</span>
                        <span className="font-medium">{pct(result.p2Win, result.total)}</span>
                      </div>
                      <div className="flex items-center justify-between text-gray-600">
                        <span>Tie</span>
                        <span>{pct(result.ties, result.total)}</span>
                      </div>

                      {/* Animated stacked bar (P1 win | Tie | P2 win) */}
                      <div className="mt-2">
                        <div
                          className="relative flex h-3 w-full overflow-hidden rounded-full bg-gray-200"
                          aria-label="Win percentage bar"
                          role="img"
                        >
                          <div
                            className="h-full flex-none bg-emerald-600 transition-all duration-700 ease-out"
                            style={{ width: `${barPct.p1}%` }}
                            title={`Hand 1 wins: ${barPct.p1.toFixed(2)}%`}
                          />
                          <div
                            className="h-full flex-none bg-gray-300 transition-all duration-700 ease-out"
                            style={{ width: `${barPct.tie}%` }}
                            title={`Tie: ${barPct.tie.toFixed(2)}%`}
                          />
                          <div
                            className="h-full flex-none bg-indigo-600 transition-all duration-700 ease-out"
                            style={{ width: `${barPct.p2}%` }}
                            title={`Hand 2 wins: ${barPct.p2.toFixed(2)}%`}
                          />
                        </div>
                        {/* Legend */}
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
                    <p className="text-gray-500">Preflop: leave board empty · Flop: 3 cards · Turn: 4 cards · River: 5 cards.</p>
                  )}
                </div>
              </div>
            </div>

            <p className="mt-4 text-xs text-gray-500">
              Preflop uses Monte Carlo sampling ({PREFLOP_SAMPLES.toLocaleString()} boards). Flop/Turn are exact; River is direct.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default EquityCalc;
