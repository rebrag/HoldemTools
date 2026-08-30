// scripts/taiwanese-ev-audit.mjs
// Measures what the Taiwanese advisor's headline number actually means, by
// driving the same solver core the page's worker drives
// (src/lib/taiwaneseSolver.ts, solveHand) against the same precomputed policy
// the page fetches (public/taiwanese-libs/), fanned over worker_threads.
//
//   npm run audit:taiwanese                      # avg mode, 1000 hands
//   npm run audit:taiwanese -- --mode mirror     # symmetry check
//   npm run audit:taiwanese -- --mode bias       # argmax bias, split-sample
//
// Flags: --hands N --samples N --seed N --boards 1|2 --opponents N --royalties
//        --mixing pure|mixed
//
// The three modes answer three different questions:
//
// - avg    What the tool reports: the mean of the #1 split's EV over random
//          hands. This is an IN-SAMPLE maximum over 105 noisy estimates, so
//          it is biased upward - `bias` measures by how much.
// - mirror The zero-sum sanity check. Hero is dealt a library hand and plays
//          the library's own choice for it, so hero and opponent run the
//          SAME strategy. House scoring is pairwise and antisymmetric, so
//          the mean must be 0 up to Monte Carlo noise. If it is not, either
//          scoring or the harness is wrong, and every other number here is
//          worthless.
// - bias   Splits the estimate in two: pick the best split on one set of
//          scenarios, then score THAT split on an independent set. The
//          out-of-sample value is unbiased for the split the tool actually
//          recommends; in-sample minus out-of-sample is the winner's-curse
//          bias of taking a max over 105 correlated noisy estimates.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import os from "node:os";
import esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cacheDir = join(here, ".cache");

const flag = (name) => process.argv.includes(`--${name}`);
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const numArg = (name, dflt) => Number(argOf(name, dflt));

const MODE = argOf("mode", "avg");
if (!["avg", "mirror", "bias"].includes(MODE)) {
  console.error(`unknown --mode ${MODE} (expected avg | mirror | bias)`);
  process.exit(1);
}

// Defaults mirror the advisor tab's own: 1 opponent, double board, royalties
// off, 20k samples, self-play opponents playing their best split.
const HANDS = numArg("hands", MODE === "avg" ? 1000 : 300);
const SAMPLES = numArg("samples", 20_000);
const SEED = numArg("seed", 20260830);
const OPPONENTS = numArg("opponents", 1);
const BOARDS = numArg("boards", 2);
const ROYALTIES = flag("royalties");
const MIXING = argOf("mixing", "pure");

const nThreads = Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1);

// One solve per (hand, seed). `heroIdx` present = also report that split's
// value under THIS seed's scenarios, which is what makes the bias mode's
// second pass out-of-sample.
const WORKER_SRC = `
import { parentPort } from "node:worker_threads";
import { solveHand, seedLCG, SPLITS } from "./src/lib/taiwaneseSolver";

const port = parentPort;
port.on("message", (msg) => {
  const out = [];
  for (let h = 0; h < msg.jobs.length; h++) {
    const job = msg.jobs[h];
    seedLCG(job.seed);
    const ev = solveHand({
      heroCards: job.hand,
      opponents: msg.opponents,
      boards: msg.boards,
      royalties: msg.royalties,
      samples: msg.samples,
      library: msg.library,
      mixing: msg.mixing,
    });
    let bestIdx = 0;
    for (let i = 1; i < SPLITS.length; i++) if (ev[i] > ev[bestIdx]) bestIdx = i;
    out.push({
      bestIdx,
      best: ev[bestIdx] / msg.samples,
      probe: job.heroIdx == null ? null : ev[job.heroIdx] / msg.samples,
    });
    if ((h + 1) % 5 === 0) port.postMessage({ type: "progress", done: h + 1 });
  }
  port.postMessage({ type: "done", out });
});
`;

const HELPERS_SRC = `export { decodeLibrary, ALL_CARDS } from "./src/lib/taiwaneseSolver";`;

async function bundle(contents, name) {
  mkdirSync(cacheDir, { recursive: true });
  const outfile = join(cacheDir, name);
  await esbuild.build({
    stdin: { contents, resolveDir: root, loader: "ts" },
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

// Deterministic draw, so a run reproduces from --seed alone.
let lcg = SEED >>> 0;
const rand = () => {
  lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
  return lcg / 4294967296;
};
const dealHand = (deck) => {
  const a = deck.slice();
  for (let i = 0; i < 7; i++) {
    const j = i + Math.floor(rand() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, 7);
};

const stats = (xs) => {
  const n = xs.length;
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  return { n, mean, sd, sem: sd / Math.sqrt(n) };
};
const pm = (s) => `${s.mean.toFixed(4)} +/- ${(1.96 * s.sem).toFixed(4)}`;

/** Run one solve per job across the thread pool, in job order. */
async function runJobs(jobs, library, label) {
  const t0 = Date.now();
  const slices = Array.from({ length: nThreads }, () => []);
  const order = Array.from({ length: nThreads }, () => []);
  jobs.forEach((j, i) => {
    slices[i % nThreads].push(j);
    order[i % nThreads].push(i);
  });

  let done = 0;
  const results = new Array(jobs.length);
  await Promise.all(
    slices.map(
      (slice, k) =>
        new Promise((resolve, reject) => {
          if (!slice.length) return resolve();
          const w = new Worker(workerFile);
          w.on("message", (m) => {
            if (m.type === "progress") {
              const total = done + m.done;
              if (total % 50 < 5) {
                process.stdout.write(
                  `\r  ${label}: ~${total}/${jobs.length}, ` +
                    `${((Date.now() - t0) / 1000).toFixed(0)}s   `
                );
              }
            } else {
              done += slice.length;
              m.out.forEach((r, i) => (results[order[k][i]] = r));
              w.terminate();
              resolve();
            }
          });
          w.on("error", reject);
          w.postMessage({
            jobs: slice,
            opponents: OPPONENTS,
            boards: BOARDS,
            royalties: ROYALTIES,
            samples: SAMPLES,
            library,
            mixing: MIXING,
          });
        })
    )
  );
  process.stdout.write(`\r  ${label}: ${jobs.length} solves in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  return results;
}

const workerFile = await bundle(WORKER_SRC, "audit-worker.bundle.mjs");
const helpersFile = await bundle(HELPERS_SRC, "audit-helpers.bundle.mjs");
const { decodeLibrary, ALL_CARDS } = await import(`file://${helpersFile.replace(/\\/g, "/")}`);

// The exact policy file the page fetches for these settings.
const fileKey = `${ROYALTIES ? "pokernews" : "house"}-${BOARDS}b`;
const library = decodeLibrary(
  JSON.parse(readFileSync(join(root, "public", "taiwanese-libs", `${fileKey}.json`), "utf8"))
);

console.log(
  `mode ${MODE} | ${OPPONENTS} opp, ${BOARDS === 1 ? "single" : "double"} board, ` +
    `royalties ${ROYALTIES ? "on" : "off"}, ${SAMPLES.toLocaleString("en-US")} samples, ${MIXING}`
);
console.log(
  `policy ${fileKey}.json: ${library.entries.length} hands, ` +
    `${library.stats.length} rounds of best response`
);
console.log(`${HANDS} hands over ${nThreads} threads\n`);

const seedFor = (h, pass) => (SEED + h * 2654435761 + pass * 40503) >>> 0;

if (MODE === "avg") {
  const jobs = Array.from({ length: HANDS }, (_, h) => ({
    hand: dealHand(ALL_CARDS),
    seed: seedFor(h, 0),
  }));
  const res = await runJobs(jobs, library.entries, "solve");
  const tops = res.map((r) => r.best);
  const s = stats(tops);
  const sorted = tops.slice().sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(s.n - 1, Math.floor(p * s.n))];

  console.log(`\nmean #1 EV       ${pm(s)} pts/deal (95%)`);
  console.log(`sd across hands  ${s.sd.toFixed(4)}`);
  console.log(`min / max        ${sorted[0].toFixed(2)} / ${sorted[s.n - 1].toFixed(2)}`);
  console.log(
    `p10 p25 med p75 p90  ${[0.1, 0.25, 0.5, 0.75, 0.9].map((p) => q(p).toFixed(2)).join("  ")}`
  );
  console.log(`share negative   ${((sorted.filter((v) => v < 0).length / s.n) * 100).toFixed(1)}%`);
} else if (MODE === "mirror") {
  // Hero is dealt library hands and plays the library's own choice, so both
  // seats run the same strategy. Antisymmetric pairwise scoring => mean 0.
  const picked = Array.from({ length: HANDS }, () => {
    const e = library.entries[Math.floor(rand() * library.entries.length)];
    return e;
  });
  const jobs = picked.map((e, h) => ({
    hand: e.cards,
    seed: seedFor(h, 0),
    heroIdx: e.alts[0].idx,
  }));
  const res = await runJobs(jobs, library.entries, "solve");
  const mirrored = stats(res.map((r) => r.probe));
  const best = stats(res.map((r) => r.best));

  console.log(`\nhero plays the SAME policy as the opponent`);
  console.log(`  mean EV        ${pm(mirrored)} pts/deal (95%)  <- must bracket 0`);
  console.log(`  sd             ${mirrored.sd.toFixed(4)}`);
  console.log(`\nsame hands, hero best-responding instead (in-sample max)`);
  console.log(`  mean #1 EV     ${pm(best)} pts/deal (95%)`);
} else {
  // Split-sample: choose on pass 0, score the chosen split on pass 1.
  const hands = Array.from({ length: HANDS }, () => dealHand(ALL_CARDS));
  const pass0 = await runJobs(
    hands.map((hand, h) => ({ hand, seed: seedFor(h, 0) })),
    library.entries,
    "choose"
  );
  const pass1 = await runJobs(
    hands.map((hand, h) => ({ hand, seed: seedFor(h, 1), heroIdx: pass0[h].bestIdx })),
    library.entries,
    "verify"
  );

  const inSample = stats(pass0.map((r) => r.best));
  const outSample = stats(pass1.map((r) => r.probe));
  const bias = stats(pass0.map((r, h) => r.best - pass1[h].probe));
  const agree = pass0.filter((r, h) => r.bestIdx === pass1[h].bestIdx).length / HANDS;

  console.log(`\nin-sample  #1 EV   ${pm(inSample)} pts/deal (95%)  <- what the UI prints`);
  console.log(`out-of-sample EV   ${pm(outSample)} pts/deal (95%)  <- honest value of that split`);
  console.log(`argmax bias        ${pm(bias)} pts/deal (95%)`);
  console.log(`same split chosen on both passes: ${(agree * 100).toFixed(1)}%`);
}
