// scripts/precompute-worker-entry.ts
// Node worker_threads entry for the Taiwanese precompute and check scripts.
// Bundled by scripts/taiwanese-lib.mjs with esbuild, then spawned once per
// thread; each message is one slice of a best-response pass, answered with
// the solved entries and stats. Mirrors the browser worker's "solve-batch"
// op, driving the same core in src/lib/taiwaneseSolver.
import { parentPort } from "node:worker_threads";
import { runBatch, seedLCG, type Mixing } from "../src/lib/taiwaneseSolver";
import type { LibraryEntry, PolicyAtom } from "../src/pages/private/protocol";

interface BatchMsg {
  hands: string[][];
  opponents: number;
  boards: number;
  royalties: boolean;
  samples: number;
  seed: number;
  library: LibraryEntry[] | null;
  prevPolicy: PolicyAtom[][] | null;
  mixing: Mixing;
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
    prevPolicy: msg.prevPolicy,
    mixing: msg.mixing,
    onHand: (done) => {
      if (done - lastReport >= 5) {
        lastReport = done;
        port.postMessage({ type: "progress", done });
      }
    },
  });
  port.postMessage({ type: "batch-done", entries: result.entries, stats: result.stats });
});
