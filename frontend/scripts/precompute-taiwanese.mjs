// scripts/precompute-taiwanese.mjs
// Overnight precompute of the Taiwanese self-play opponent libraries.
//
//   npm run precompute:taiwanese            full run (a few hours)
//   npm run precompute:taiwanese -- --quick tiny smoke test (~2 min)
//
// Bundles the shared solver core (src/lib/taiwaneseSolver.ts) with esbuild,
// fans each policy-iteration round out over worker_threads, and writes one
// compact JSON per settings combination to public/taiwanese-libs/, which the
// app fetches before falling back to an in-browser build. Each file is
// written as soon as its library finishes, so an interrupted run keeps its
// completed libraries.
//
// What gets built and why:
// - House rules settle pairwise, so EV is exactly linear in opponent count
//   and one library per board count serves every table size. Built big.
// - PokerNews winner-take-all does depend on the table size; one library per
//   board count is built at 3 opponents and reused as an approximation.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import os from "node:os";
import esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cacheDir = join(here, ".cache");

const QUICK = process.argv.includes("--quick");

// One-off job, for experiments on the build knobs rather than a shipping
// library: sizes come from flags, and --outdir keeps the result OUT of
// public/ so a probe library can never be served to the app by accident.
//
//   node scripts/precompute-taiwanese.mjs --custom --entries 2000 //     --samples 6000 --levels 3 --file ab-hi --outdir scripts/.cache/ab
const CUSTOM = process.argv.includes("--custom");
// Custom runs can also write a snapshot after every round, which is what
// turns "does another round help?" into a measurable curve: every snapshot
// comes from the SAME hand pool, so only the round count differs.
const DUMP_ROUNDS = process.argv.includes("--dump-rounds");
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const numArg = (name, dflt) => Number(argOf(name, dflt));

const outDir = CUSTOM
  ? join(root, argOf("outdir", "scripts/.cache/custom"))
  : join(root, "public", "taiwanese-libs");

// Budget notes (measured): the in-browser build does ~17k scenarios/s over 6
// workers; Node with more threads lands higher. The full config below is
// ~330M scenarios, roughly 2-4 hours on an 8-16 core machine, inside a
// 6-hour window with margin. INNER samples got the biggest raise: argmax
// stability on an unchanged field was measured at 55% @150, 67.5% @300,
// 77.5% @1200 samples, so per-hand split quality was the binding constraint.
const JOBS = CUSTOM
  ? [
      {
        file: argOf("file", "custom"),
        opponents: numArg("opponents", 1),
        boards: numArg("boards", 2),
        royalties: process.argv.includes("--royalties"),
        entries: numArg("entries", 2000),
        samples: numArg("samples", 3000),
        levels: numArg("levels", 3),
      },
    ]
  : QUICK
  ? [
      { file: "house-2b", opponents: 1, boards: 2, royalties: false, entries: 120, samples: 100, levels: 2 },
      { file: "house-1b", opponents: 1, boards: 1, royalties: false, entries: 120, samples: 100, levels: 2 },
      { file: "pokernews-2b", opponents: 3, boards: 2, royalties: true, entries: 80, samples: 80, levels: 2 },
      { file: "pokernews-1b", opponents: 3, boards: 1, royalties: true, entries: 80, samples: 80, levels: 2 },
    ]
  : [
      { file: "house-2b", opponents: 1, boards: 2, royalties: false, entries: 10000, samples: 3000, levels: 5 },
      { file: "house-1b", opponents: 1, boards: 1, royalties: false, entries: 10000, samples: 3000, levels: 5 },
      { file: "pokernews-2b", opponents: 3, boards: 2, royalties: true, entries: 4000, samples: 1500, levels: 4 },
      { file: "pokernews-1b", opponents: 3, boards: 1, royalties: true, entries: 4000, samples: 1500, levels: 4 },
    ];

const nThreads = Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1);

async function bundleWorker() {
  mkdirSync(cacheDir, { recursive: true });
  const outfile = join(cacheDir, "precompute-worker.bundle.mjs");
  await esbuild.build({
    entryPoints: [join(here, "precompute-worker-entry.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    alias: { "@": join(root, "src") },
    logLevel: "silent",
  });
  return outfile;
}

// Import the solver's encode/summarize helpers through a second tiny bundle,
// so this script and the threads share the exact same code.
async function bundleHelpers() {
  const outfile = join(cacheDir, "precompute-helpers.bundle.mjs");
  await esbuild.build({
    stdin: {
      contents: `export { encodeLibrary, summarizeRound } from ${JSON.stringify(
        join(root, "src", "lib", "taiwaneseSolver.ts").replace(/\\/g, "/")
      )};`,
      resolveDir: root,
      loader: "ts",
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    alias: { "@": join(root, "src") },
    logLevel: "silent",
  });
  return import(`file://${outfile}?t=${Date.now()}`);
}

function deal7(deck) {
  const a = [...deck];
  for (let t = 0; t < 7; t++) {
    const j = t + Math.floor(Math.random() * (a.length - t));
    [a[t], a[j]] = [a[j], a[t]];
  }
  return a.slice(0, 7);
}

const DECK = [];
for (const r of ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"]) {
  for (const s of ["h", "d", "c", "s"]) DECK.push(r + s);
}

function runChunk(worker, payload) {
  return new Promise((resolve, reject) => {
    // Both listeners are removed on either outcome. A worker is reused for
    // every chunk of every round, so leaving them attached would pile up one
    // pair per round and trip Node's max-listeners warning.
    const cleanup = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
    };
    const onError = (e) => {
      cleanup();
      reject(e);
    };
    const onMessage = (m) => {
      if (m.type === "progress") {
        progressState.done += m.done - (progressState.chunkDone.get(worker) ?? 0);
        progressState.chunkDone.set(worker, m.done);
        printProgress();
      } else if (m.type === "batch-done") {
        progressState.done +=
          payload.hands.length - (progressState.chunkDone.get(worker) ?? 0);
        progressState.chunkDone.set(worker, 0);
        cleanup();
        resolve(m);
      }
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.postMessage(payload);
  });
}

const progressState = { done: 0, total: 0, t0: Date.now(), label: "", chunkDone: new Map() };
function printProgress() {
  const { done, total, t0, label } = progressState;
  if (total === 0) return;
  const elapsed = (Date.now() - t0) / 1000;
  const rate = done / Math.max(1, elapsed);
  const eta = rate > 0 ? Math.round((total - done) / rate) : 0;
  process.stdout.write(
    `\r${label}: ${done}/${total} hands  (${Math.round(elapsed)}s elapsed, ~${eta}s left)   `
  );
}

async function main() {
  console.log(
    `Taiwanese precompute${QUICK ? " (QUICK smoke test)" : ""}${CUSTOM ? " (CUSTOM one-off)" : ""}`
  );
  if (CUSTOM) console.log(`out dir: ${outDir}`);
  console.log(`threads: ${nThreads}`);
  const totalScenarios = JOBS.reduce((a, j) => a + j.entries * j.samples * j.levels, 0);
  console.log(`total scenario budget: ${(totalScenarios / 1e6).toFixed(0)}M\n`);

  const workerFile = await bundleWorker();
  const helpers = await bundleHelpers();
  mkdirSync(outDir, { recursive: true });

  const pool = Array.from({ length: nThreads }, () => new Worker(workerFile));

  for (const job of JOBS) {
    const jobT0 = Date.now();
    const hands = Array.from({ length: job.entries }, () => deal7(DECK));
    const chunks = Array.from({ length: nThreads }, () => []);
    hands.forEach((_, i) => chunks[i % nThreads].push(i));

    let policy = null;
    let prevIdx = null;
    const stats = [];

    for (let level = 1; level <= job.levels; level++) {
      progressState.done = 0;
      progressState.total = job.entries;
      progressState.t0 = Date.now();
      progressState.label = `${job.file} round ${level}/${job.levels}`;
      progressState.chunkDone = new Map();

      const results = await Promise.all(
        chunks.map((idxs, k) =>
          runChunk(pool[k], {
            hands: idxs.map((i) => hands[i]),
            opponents: job.opponents,
            boards: job.boards,
            royalties: job.royalties,
            samples: job.samples,
            seed: ((Math.random() * 0x7fffffff) ^ (Date.now() + level)) >>> 0,
            library: policy,
            prevIdx: prevIdx ? idxs.map((i) => prevIdx[i]) : null,
          })
        )
      );

      const nextPolicy = new Array(job.entries);
      const nextIdx = new Array(job.entries);
      const ordered = new Array(job.entries);
      chunks.forEach((idxs, k) => {
        idxs.forEach((handIdx, j) => {
          nextPolicy[handIdx] = results[k].entries[j];
          nextIdx[handIdx] = results[k].stats[j].bestIdx;
          ordered[handIdx] = results[k].stats[j];
        });
      });
      const round = helpers.summarizeRound(level, ordered, prevIdx);
      stats.push(round);
      policy = nextPolicy;
      prevIdx = nextIdx;
      if (DUMP_ROUNDS) {
        writeFileSync(
          join(outDir, `${job.file}-r${level}.json`),
          JSON.stringify(
            helpers.encodeLibrary({
              entries: policy,
              stats: [...stats],
              opponents: job.opponents,
              boards: job.boards,
              royalties: job.royalties,
            })
          )
        );
      }
      process.stdout.write(
        `\r${progressState.label}: done. gain over previous ${round.prevPolicyEvLoss.toFixed(3)} pts/deal, ` +
          `same split ${round.agreePrevPct.toFixed(0)}%${" ".repeat(20)}\n`
      );
    }

    const file = helpers.encodeLibrary({
      entries: policy,
      stats,
      opponents: job.opponents,
      boards: job.boards,
      royalties: job.royalties,
    });
    const path = join(outDir, `${job.file}.json`);
    writeFileSync(path, JSON.stringify(file));
    console.log(
      `wrote ${path} (${(JSON.stringify(file).length / 1e6).toFixed(1)}MB, ` +
        `${Math.round((Date.now() - jobT0) / 1000)}s)\n`
    );
  }

  await Promise.all(pool.map((w) => w.terminate()));
  console.log("all libraries written.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
