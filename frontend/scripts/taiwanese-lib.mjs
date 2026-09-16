// scripts/taiwanese-lib.mjs
// Node-side plumbing shared by the Taiwanese precompute and its check
// script: bundle the solver core once, fan a best-response pass out over
// worker_threads, and measure a finished policy. One implementation, so the
// build and the check price a policy with the same code.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { Worker } from "node:worker_threads";
import os from "node:os";
import esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, "..");
const cacheDir = join(here, ".cache");

export const DECK = [];
for (const r of ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"]) {
  for (const s of ["h", "d", "c", "s"]) DECK.push(r + s);
}

export function deal7() {
  const a = [...DECK];
  for (let t = 0; t < 7; t++) {
    const j = t + Math.floor(Math.random() * (a.length - t));
    [a[t], a[j]] = [a[j], a[t]];
  }
  return a.slice(0, 7);
}

export const threadCount = () =>
  Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1);

const buildOpts = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  alias: { "@": join(root, "src") },
  logLevel: "silent",
};

/**
 * Bundle the worker entry and a helpers module from the same source, so the
 * threads and the host share the exact same solver code. Returns the worker
 * file path and the imported helpers (encode/decode/merge/summarize).
 */
export async function bundleSolver() {
  mkdirSync(cacheDir, { recursive: true });
  const workerFile = join(cacheDir, "precompute-worker.bundle.mjs");
  await esbuild.build({ ...buildOpts, entryPoints: [join(here, "precompute-worker-entry.ts")], outfile: workerFile });
  const helpersFile = join(cacheDir, "precompute-helpers.bundle.mjs");
  await esbuild.build({
    ...buildOpts,
    stdin: {
      contents: `export { encodeLibrary, decodeLibrary, mergeRound, summarizeRound } from ${JSON.stringify(
        join(root, "src", "lib", "taiwaneseSolver.ts").replace(/\\/g, "/")
      )};`,
      resolveDir: root,
      loader: "ts",
    },
    outfile: helpersFile,
  });
  const helpers = await import(`${pathToFileURL(helpersFile).href}?t=${Date.now()}`);
  return { workerFile, helpers };
}

export const createPool = (workerFile, n = threadCount()) =>
  Array.from({ length: n }, () => new Worker(workerFile));

const seed = (salt) => ((Math.random() * 0x7fffffff) ^ (Date.now() + salt)) >>> 0;

/**
 * One best-response pass over `hands` against `library` (null = the
 * heuristic), pricing `prevPolicy[i]` (the hand's current policy, or absent)
 * on the same scenarios. Round-robin over the pool; results in hand order.
 * `onProgress(done)` is called as hands finish.
 */
export function runPass(pool, { hands, opponents, boards, royalties, samples, library, prevPolicy, mixing, onProgress }) {
  const chunks = Array.from({ length: pool.length }, () => []);
  hands.forEach((_, i) => chunks[i % pool.length].push(i));
  const chunkDone = new Map();
  const total = () => [...chunkDone.values()].reduce((a, b) => a + b, 0);
  return Promise.all(
    chunks.map((idxs, k) => {
      if (idxs.length === 0) return Promise.resolve({ entries: [], stats: [] });
      const worker = pool[k];
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          worker.off("message", onMessage);
          worker.off("error", onError);
        };
        const onError = (e) => { cleanup(); reject(e); };
        const onMessage = (m) => {
          if (m.type === "progress") {
            chunkDone.set(k, m.done);
            onProgress?.(total());
          } else if (m.type === "batch-done") {
            chunkDone.set(k, idxs.length);
            onProgress?.(total());
            cleanup();
            resolve(m);
          }
        };
        worker.on("message", onMessage);
        worker.on("error", onError);
        worker.postMessage({
          hands: idxs.map((i) => hands[i]),
          opponents,
          boards,
          royalties,
          samples,
          seed: seed(k),
          library,
          prevPolicy: prevPolicy ? idxs.map((i) => prevPolicy[i]) : null,
          mixing,
        });
      });
    })
  ).then((results) => {
    const entries = new Array(hands.length);
    const stats = new Array(hands.length);
    chunks.forEach((idxs, k) => {
      idxs.forEach((handIdx, j) => {
        entries[handIdx] = results[k].entries[j];
        stats[handIdx] = results[k].stats[j];
      });
    });
    return { entries, stats };
  });
}

/**
 * Measure a finished policy: best-respond a random slice of its own hands
 * against it and price each hand's policy on the same scenarios. The policy
 * against itself averages exactly zero, so the paired gain is its
 * exploitability, precise even where the per-hand EVs are noisy. `level` is
 * how many rounds the policy absorbed, for the stats row.
 */
export async function calibrate(pool, helpers, lib, { level, hands, samples, mixing = "pure", onProgress }) {
  const picks = [...lib.entries].sort(() => Math.random() - 0.5).slice(0, hands);
  const { stats } = await runPass(pool, {
    hands: picks.map((e) => e.cards),
    opponents: lib.opponents,
    boards: lib.boards,
    royalties: lib.royalties,
    samples,
    library: lib.entries,
    prevPolicy: picks.map((e) => e.policy),
    mixing,
    onProgress,
  });
  return helpers.summarizeRound(level, stats);
}
