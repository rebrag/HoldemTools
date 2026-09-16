// scripts/check-taiwanese-calibration.mjs
//
// Measure the Taiwanese self-play libraries the advisor solves against:
//
//   npm run check:taiwanese                       every file in public/taiwanese-libs
//   npm run check:taiwanese -- house-2b            one file (name or path)
//   npm run check:taiwanese -- --hands 800 --samples 2000 --mixed --max 0.15
//
// For each library it best-responds a random slice of the library's own
// hands against the policy and prices each hand's policy on the same
// scenarios. A policy against itself averages exactly zero, so the paired
// gain ("exploitable by") is how hot the advisor's EVs run on average, and
// the self-play mean is a sanity check that should sit near zero. --mixed
// also measures the "Human mix" field. --max exits non-zero when any
// library's exploitability under pure play exceeds it.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { bundleSolver, calibrate, createPool, root } from "./taiwanese-lib.mjs";

let HANDS = 800;
let SAMPLES = 2000;
let MIXED = false;
let MAX = null;
const named = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--hands") HANDS = Number(process.argv[++i]);
  else if (a === "--samples") SAMPLES = Number(process.argv[++i]);
  else if (a === "--max") MAX = Number(process.argv[++i]);
  else if (a === "--mixed") MIXED = true;
  else named.push(a);
}

const libDir = join(root, "public", "taiwanese-libs");
const files = named.length
  ? named.map((n) => (existsSync(n) ? resolve(n) : join(libDir, n.endsWith(".json") ? n : `${n}.json`)))
  : readdirSync(libDir).filter((f) => f.endsWith(".json")).sort().map((f) => join(libDir, f));

const { workerFile, helpers } = await bundleSolver();
const pool = createPool(workerFile);
console.log(`threads ${pool.length}, ${HANDS} hands x ${SAMPLES} scenarios per measurement\n`);

const fmt = (x, d = 3) => (x >= 0 ? "+" : "") + x.toFixed(d);
let worst = 0;
for (const file of files) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const lib = helpers.decodeLibrary(raw);
  const label = basename(file, ".json");
  const shipped = lib.stats[lib.stats.length - 1];
  // A v2 file's last row already measured the shipped policy; a v1 file's
  // last row measured the round before it.
  const level = shipped == null ? 0 : shipped.selfPositivePct != null ? shipped.level : shipped.level + 1;
  const t0 = Date.now();
  process.stdout.write(`${label}: v${raw.v}, ${lib.entries.length} hands, ${lib.stats.length} stats rows`);
  if (shipped?.exploitability != null) process.stdout.write(`, file says ${fmt(shipped.exploitability)} at level ${shipped.level}`);
  process.stdout.write("\n");

  const pure = await calibrate(pool, helpers, lib, { level, hands: HANDS, samples: SAMPLES, mixing: "pure" });
  console.log(
    `  pure       exploitable by ${fmt(pure.exploitability)} pts/deal` +
      `  self-play mean ${fmt(pure.selfMeanEv)} (expect ~0), +EV ${pure.selfPositivePct.toFixed(1)}%` +
      `  best-split +EV ${pure.bestPositivePct.toFixed(1)}%  same split ${pure.agreePrevPct.toFixed(0)}%`
  );
  worst = Math.max(worst, pure.exploitability);
  if (MIXED) {
    // Hero plays the policy against a softened field, so there is no zero
    // baseline here: report what a best split averages against that field.
    const mixed = await calibrate(pool, helpers, lib, { level, hands: HANDS, samples: SAMPLES, mixing: "mixed" });
    console.log(
      `  human mix  best split averages ${fmt(mixed.selfMeanEv + mixed.exploitability)} pts/deal` +
        `  (policy itself ${fmt(mixed.selfMeanEv)})  best-split +EV ${mixed.bestPositivePct.toFixed(1)}%`
    );
  }
  console.log(`  (${Math.round((Date.now() - t0) / 1000)}s)\n`);
}
await Promise.all(pool.map((w) => w.terminate()));

if (MAX != null && worst > MAX) {
  console.error(`FAIL: worst exploitability ${fmt(worst)} exceeds --max ${MAX}`);
  process.exit(1);
}
