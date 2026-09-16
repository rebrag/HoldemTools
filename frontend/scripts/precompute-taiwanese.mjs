// scripts/precompute-taiwanese.mjs
// Overnight precompute of the Taiwanese self-play opponent libraries.
//
//   npm run precompute:taiwanese                 full run (a few hours)
//   npm run precompute:taiwanese -- --quick      tiny smoke test (~2 min)
//   npm run precompute:taiwanese -- --mid --out <dir> --dynamic replace
//                                                mid-size experiment (minutes),
//                                                written outside public/
//
// Bundles the shared solver core (src/lib/taiwaneseSolver.ts) with esbuild,
// fans each round out over worker_threads (scripts/taiwanese-lib.mjs), and
// writes one compact JSON per settings combination to public/taiwanese-libs/,
// which the app fetches before falling back to an in-browser build. Each
// file is written as soon as its library finishes, so an interrupted run
// keeps its completed libraries.
//
// The dynamic is fictitious play: round k best-responds to the linearly
// weighted average of rounds 1..k-1 (mergeRound), and the shipped policy is
// that average. Plain best-response replacement (--dynamic replace, kept
// for comparison) can cycle and measurably stalled ~0.2 pts/deal short of
// equilibrium. Every round's pass reports the exploitability of the policy
// it faced, and a final measuring pass reports the shipped policy's.
//
// What gets built and why:
// - House rules settle pairwise, so EV is exactly linear in opponent count
//   and one library per board count serves every table size. Built big.
// - PokerNews winner-take-all does depend on the table size; one library per
//   board count is built at 3 opponents and reused as an approximation.
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { bundleSolver, calibrate, createPool, deal7, root, runPass } from "./taiwanese-lib.mjs";

const argv = process.argv.slice(2);
const QUICK = argv.includes("--quick");
const MID = argv.includes("--mid");
const DYNAMIC = argv.includes("--dynamic") ? argv[argv.indexOf("--dynamic") + 1] : "average";
if (DYNAMIC !== "average" && DYNAMIC !== "replace") throw new Error(`--dynamic must be average or replace, got ${DYNAMIC}`);
const outDir = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : join(root, "public", "taiwanese-libs");
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",") : null;

// Budget notes (measured): Node does ~25k scenarios/s on 15 threads, so the
// full config below (~340M scenarios including the measuring passes) is
// about 4 hours. Rounds are the lever under fictitious play: at mid size
// (2000 x 1000) exploitability fell 1.22, 0.38, 0.19, 0.13, 0.10, 0.08,
// 0.07 over six rounds, while the replacement dynamic ended at 0.23 on the
// same budget. Inner samples only have to pick each hand's best response
// (argmax stability on an unchanged field: 55% @150, 67.5% @300,
// 77.5% @1200), and the averaging absorbs the per-round noise.
const JOBS = QUICK
  ? [
      { file: "house-2b", opponents: 1, boards: 2, royalties: false, entries: 120, samples: 100, levels: 2, calibration: 60 },
      { file: "house-1b", opponents: 1, boards: 1, royalties: false, entries: 120, samples: 100, levels: 2, calibration: 60 },
      { file: "pokernews-2b", opponents: 3, boards: 2, royalties: true, entries: 80, samples: 80, levels: 2, calibration: 40 },
      { file: "pokernews-1b", opponents: 3, boards: 1, royalties: true, entries: 80, samples: 80, levels: 2, calibration: 40 },
    ]
  : MID
    ? [{ file: "house-2b", opponents: 1, boards: 2, royalties: false, entries: 2000, samples: 1000, levels: 6, calibration: 1000 }]
    : [
        { file: "house-2b", opponents: 1, boards: 2, royalties: false, entries: 10000, samples: 2000, levels: 7, calibration: 2000 },
        { file: "house-1b", opponents: 1, boards: 1, royalties: false, entries: 10000, samples: 2000, levels: 7, calibration: 2000 },
        { file: "pokernews-2b", opponents: 3, boards: 2, royalties: true, entries: 4000, samples: 1500, levels: 5, calibration: 2000 },
        { file: "pokernews-1b", opponents: 3, boards: 1, royalties: true, entries: 4000, samples: 1500, levels: 5, calibration: 2000 },
      ];

const progress = { t0: Date.now(), label: "", total: 0 };
function printProgress(done) {
  const elapsed = (Date.now() - progress.t0) / 1000;
  const rate = done / Math.max(1, elapsed);
  const eta = rate > 0 ? Math.round((progress.total - done) / rate) : 0;
  process.stdout.write(
    `\r${progress.label}: ${done}/${progress.total} hands  (${Math.round(elapsed)}s elapsed, ~${eta}s left)   `
  );
}
const startPass = (label, total) => {
  progress.t0 = Date.now();
  progress.label = label;
  progress.total = total;
};
const fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(3);
const describe = (s) =>
  `exploitable by ${fmt(s.exploitability)} pts/deal, self-play mean ${fmt(s.selfMeanEv)}, ` +
  `self-play +EV ${s.selfPositivePct.toFixed(1)}%, best-split +EV ${s.bestPositivePct.toFixed(1)}%, ` +
  `same split ${s.agreePrevPct.toFixed(0)}%`;

async function main() {
  const jobs = ONLY ? JOBS.filter((j) => ONLY.includes(j.file)) : JOBS;
  console.log(`Taiwanese precompute${QUICK ? " (QUICK smoke test)" : MID ? " (MID experiment)" : ""}, dynamic: ${DYNAMIC}`);
  const totalScenarios = jobs.reduce((a, j) => a + (j.entries * j.levels + j.calibration) * j.samples, 0);
  console.log(`total scenario budget: ${(totalScenarios / 1e6).toFixed(0)}M, output: ${outDir}\n`);

  const { workerFile, helpers } = await bundleSolver();
  mkdirSync(outDir, { recursive: true });
  const pool = createPool(workerFile);
  console.log(`threads: ${pool.length}\n`);

  for (const job of jobs) {
    const jobT0 = Date.now();
    const hands = Array.from({ length: job.entries }, () => deal7());
    let policy = null;
    const stats = [];

    for (let level = 1; level <= job.levels; level++) {
      startPass(`${job.file} round ${level}/${job.levels}`, job.entries);
      const { entries, stats: handStats } = await runPass(pool, {
        hands,
        opponents: job.opponents,
        boards: job.boards,
        royalties: job.royalties,
        samples: job.samples,
        library: policy,
        prevPolicy: policy ? policy.map((e) => e.policy) : null,
        // Fictitious play fields the averaged policy itself; replacement
        // fields the previous round's best response, softened, as the
        // pre-2026-09-15 builds did.
        mixing: DYNAMIC === "average" ? "pure" : "mixed",
        onProgress: printProgress,
      });
      const round = helpers.summarizeRound(level - 1, handStats);
      stats.push(round);
      policy = entries.map((solved, i) =>
        DYNAMIC === "average"
          ? helpers.mergeRound(policy ? policy[i] : null, solved, level)
          : { ...solved, policy: [{ ...solved.alts[0], weight: 1 }] }
      );
      process.stdout.write(`\r${progress.label}: done. policy after ${level - 1} rounds ${describe(round)}${" ".repeat(8)}\n`);
    }

    const lib = { entries: policy, stats, opponents: job.opponents, boards: job.boards, royalties: job.royalties };
    startPass(`${job.file} measuring final policy`, job.calibration);
    const final = await calibrate(pool, helpers, lib, {
      level: job.levels,
      hands: job.calibration,
      samples: job.samples,
      onProgress: printProgress,
    });
    stats.push(final);
    process.stdout.write(`\r${progress.label}: done. shipped policy ${describe(final)}${" ".repeat(8)}\n`);

    const file = helpers.encodeLibrary(lib);
    const path = join(outDir, `${job.file}.json`);
    const json = JSON.stringify(file);
    writeFileSync(path, json);
    console.log(`wrote ${path} (${(json.length / 1e6).toFixed(1)}MB, ${Math.round((Date.now() - jobT0) / 1000)}s)\n`);
  }

  await Promise.all(pool.map((w) => w.terminate()));
  console.log("all libraries written.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
