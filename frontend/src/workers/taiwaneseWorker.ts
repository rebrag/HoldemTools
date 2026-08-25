/// <reference lib="webworker" />
// A Vite module worker. No DOM APIs here.
// Thin messaging shim over the shared solver core in lib/taiwaneseSolver
// (the Node precompute script drives the same core). Two operations:
//
//   "start" - rank all 105 splits of one hand by pre-board EV.
//   "solve-batch" - one slice of a policy-iteration round (see the core).
//
// Cancellation is by worker.terminate() from the host.
import { splitCards } from "../lib/taiwanese";
import { SPLITS, runBatch, seedLCG, solveHand } from "../lib/taiwaneseSolver";
import type {
  TaiwaneseIn,
  TaiwaneseOut,
  TaiwaneseParams,
  TaiwaneseSplitResult,
  SolveBatchParams,
} from "../pages/private/protocol";

const post = (m: TaiwaneseOut) => self.postMessage(m);

self.onmessage = (ev: MessageEvent<TaiwaneseIn>) => {
  const msg = ev.data;
  try {
    if (msg.type === "start") runSolve(msg.payload);
    else if (msg.type === "solve-batch") runSolveBatch(msg.payload);
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};

function runSolve(p: TaiwaneseParams) {
  if (p.heroCards.length !== 7) throw new Error("heroCards must have exactly 7 cards");
  seedLCG(p.seed);
  const sq = new Float64Array(SPLITS.length);
  const ev = solveHand({
    heroCards: p.heroCards,
    opponents: p.opponents,
    boards: p.boards,
    royalties: p.royalties,
    samples: p.samples,
    library: p.library ?? null,
    mixing: p.mixing ?? "pure",
    sqOut: sq,
    onScenario: (done) => {
      if (done % p.reportEvery === 0) post({ type: "progress", done, total: p.samples });
    },
  });

  const results: TaiwaneseSplitResult[] = SPLITS
    .map((sp, si) => ({ ...splitCards(sp, p.heroCards), evPoints: ev[si] / p.samples }))
    .sort((a, b) => b.evPoints - a.evPoints);

  post({
    type: "done",
    result: {
      samples: p.samples,
      opponents: p.opponents,
      boards: p.boards,
      royalties: p.royalties,
      splits: results,
      evSum: Array.from(ev),
      evSqSum: Array.from(sq),
    },
  });
}

function runSolveBatch(p: SolveBatchParams) {
  seedLCG(p.seed);
  const { entries, stats } = runBatch({
    hands: p.hands,
    opponents: p.opponents,
    boards: p.boards,
    royalties: p.royalties,
    samples: p.samples,
    library: p.library ?? null,
    prevIdx: p.prevIdx ?? null,
    mixing: p.mixing ?? "mixed",
    onHand: (done) => {
      if (done % p.reportEvery === 0) post({ type: "progress", done, total: p.hands.length });
    },
  });
  post({ type: "batch-done", entries, stats });
}
