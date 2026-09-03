// scripts/check-line-model.mjs
//
// Deterministic checks for the /multiway line adapter
// (src/pages/multiway/lineModel.ts) outside the browser: a synthetic
// three-seat jam/fold tree walked every way the Line, the Plate and the
// table can walk it. Bundled with esbuild the way check-session-sim.mjs is,
// so the checked code is the shipped code. Exits non-zero on the first
// failure.
import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cacheDir = join(root, "node_modules", ".cache", "line-model");
mkdirSync(cacheDir, { recursive: true });
const outfile = join(cacheDir, "check.bundle.mjs");

await esbuild.build({
  entryPoints: [join(here, "check-line-model-entry.ts")],
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
