// import React, { useState } from "react";
// import { ensureWasmReady, evalHoldem7 } from "../lib/wasmEval";

// const RANKS = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"];
// const SUITS = ["h","d","c","s"];

// const deck52 = () => {
//   const out: string[] = [];
//   for (const r of RANKS) for (const s of SUITS) out.push(r + s);
//   return out;
// };

// const sample5NoReplace = (avail: string[]) => {
//   const a = avail.slice();
//   for (let i = 0; i < 5; i++) {
//     const j = i + Math.floor(Math.random() * (a.length - i));
//     [a[i], a[j]] = [a[j], a[i]];
//   }
//   return a.slice(0, 5);
// };

// function tokenize2(s: string): string[] {
//   return (s.match(/([2-9TJQKA][hdcs])/gi) || []).map(t => t[0].toUpperCase() + t[1].toLowerCase()).slice(0, 2);
// }

// const WasmProbe: React.FC = () => {
//   const [p1, setP1] = useState("As Kd");
//   const [p2, setP2] = useState("Qh Js");
//   const [running, setRunning] = useState(false);
//   const [status, setStatus] = useState("");
//   const [result, setResult] = useState<{p1: number; p2: number; tie: number; total: number} | null>(null);

//   const run = async () => {
//     const h1 = tokenize2(p1);
//     const h2 = tokenize2(p2);
//     if (h1.length !== 2 || h2.length !== 2) {
//       setStatus("Enter exactly 2 cards per player (e.g., 'As Kd').");
//       return;
//     }
//     const used = new Set([...h1, ...h2]);
//     if (used.size !== 4) { setStatus("Duplicate cards detected."); return; }

//     setRunning(true);
//     setStatus("Loading WASM…");
//     try {
//       await ensureWasmReady();
//     } catch (e) {
//       setRunning(false);
//       setStatus("Failed to load WASM (see console).");
//       console.error(e);
//       return;
//     }

//     setStatus("Simulating 20,000 random boards (WASM) …");
//     let p1W = 0, p2W = 0, ties = 0, tot = 0;

//     const deck = deck52().filter(c => !used.has(c));
//     const SAMPLES = 20_000;

//     for (let i = 0; i < SAMPLES; i++) {
//       const board5 = sample5NoReplace(deck);
//       const a = evalHoldem7(board5, h1);
//       const b = evalHoldem7(board5, h2);
//       if (a.value === b.value) ties++;
//       else if (a.value < b.value) p1W++;
//       else p2W++;
//       tot++;
//       if (i % 2000 === 0) setStatus(`Simulating… ${i.toLocaleString()}/${SAMPLES.toLocaleString()}`);
//     }

//     setResult({ p1: p1W, p2: p2W, tie: ties, total: tot });
//     setRunning(false);
//     setStatus("Done.");
//   };

//   const pct = (n: number, d: number) => d ? ((100*n)/d).toFixed(2) + "%" : "—";

//   return (
//     <div className="max-w-md mx-auto bg-white/90 rounded-xl p-4 shadow">
//       <h2 className="font-semibold text-lg mb-2">WASM Probe — Preflop NLH</h2>
//       <div className="space-y-2">
//         <div className="flex gap-2">
//           <input className="flex-1 border rounded px-2 py-1" value={p1} onChange={(e)=>setP1(e.target.value)} />
//           <input className="flex-1 border rounded px-2 py-1" value={p2} onChange={(e)=>setP2(e.target.value)} />
//         </div>
//         <button
//           disabled={running}
//           onClick={run}
//           className={`px-3 py-2 rounded text-white ${running ? "bg-gray-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
//         >
//           {running ? "Running…" : "Run 20k boards (WASM)"}
//         </button>
//         <p className="text-xs text-gray-600">{status}</p>

//         {result && (
//           <div className="mt-2 text-sm">
//             <div className="flex justify-between"><span>P1 win</span><span>{pct(result.p1, result.total)}</span></div>
//             <div className="flex justify-between"><span>P2 win</span><span>{pct(result.p2, result.total)}</span></div>
//             <div className="flex justify-between"><span>Tie</span><span>{pct(result.tie, result.total)}</span></div>
//             <div className="text-xs text-gray-500 mt-1">Samples: {result.total.toLocaleString()}</div>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default WasmProbe;
