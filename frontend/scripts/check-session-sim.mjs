// scripts/check-session-sim.mjs
//
// Deterministic checks for the session simulator's core (src/lib/sessionSim)
// outside the browser: the class table, a synthetic two-seat tree with
// policies whose payoffs are known exactly, and the session bootstrap on
// constant pools. Bundled with esbuild the way precompute-taiwanese.mjs
// bundles its worker, so the checked code is the shipped code. Exits
// non-zero on the first failure.
import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cacheDir = join(root, "node_modules", ".cache", "session-sim");
mkdirSync(cacheDir, { recursive: true });
const outfile = join(cacheDir, "check.bundle.mjs");

await esbuild.build({
  entryPoints: [join(here, "check-session-sim-entry.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  alias: { "@": join(root, "src") },
  logLevel: "silent",
});

const mod = await import(pathToFileURL(outfile).href);
process.exitCode = await mod.main();
