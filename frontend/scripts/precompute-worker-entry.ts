// scripts/precompute-worker-entry.ts
// Node worker_threads entry for the Taiwanese precompute. Bundled by
// precompute-taiwanese.mjs with esbuild, then spawned once per thread; each
// message is one slice of a policy-iteration round, answered with the solved
// entries and stats. Mirrors the browser worker's "solve-batch" op, driving
// the same core in src/lib/taiwaneseSolver.
import { parentPort } from "node:worker_threads";
import { runBatch, seedLCG } from "../src/lib/taiwaneseSolver";
import type { LibraryEntry } from "../src/pages/private/protocol";

interface BatchMsg {
  hands: string[][];
  opponents: number;
  boards: number;
  royalties: boolean;
  samples: number;
  seed: number;
  library: LibraryEntry[] | null;
  prevIdx: number[] | null;
}

if (!parentPort) throw new Error("must run as a worker thread");
const port = parentPort;

port.on("message", (msg: BatchMsg) => {
  seedLCG(msg.seed);
  let lastReport = 0;
  const result = runBatch({
    hands: msg.hands,
    opponents: msg.opponents,
    boards: msg.boards,
    royalties: msg.royalties,
    samples: msg.samples,
    library: msg.library,
    prevIdx: msg.prevIdx,
    mixing: "mixed", // smoothed policy iteration, as in the browser build
    onHand: (done) => {
      if (done - lastReport >= 5) {
        lastReport = done;
        port.postMessage({ type: "progress", done });
      }
    },
  });
  port.postMessage({ type: "batch-done", entries: result.entries, stats: result.stats });
});
