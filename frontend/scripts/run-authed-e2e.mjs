#!/usr/bin/env node
/**
 * Launcher for the authed E2E lane (playwright.authed.config.ts).
 *
 * Reads E2E_EMAIL / E2E_PASSWORD from ~/.holdemtools/env/e2e.env (same
 * outside-the-repo home as frontend.env; HOLDEMTOOLS_ENV_DIR overrides the
 * directory) and injects them into the Playwright child process.
 *
 * When the file or the keys are absent it exits 0 with a note instead of
 * failing - so an environment without credentials (CI, a fresh machine)
 * skips the lane instead of breaking. The credentials are deliberately not
 * VITE_-prefixed and never written anywhere inside the repo: a VITE_ var
 * would be inlined into the client bundle.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const dir = process.env.HOLDEMTOOLS_ENV_DIR || path.join(homedir(), ".holdemtools", "env");
const file = path.join(dir, "e2e.env");
const creds = existsSync(file) ? dotenv.parse(readFileSync(file, "utf8")) : {};

if (!creds.E2E_EMAIL || !creds.E2E_PASSWORD) {
  console.log(`[authed-e2e] Skipping: no credentials at ${file}`);
  console.log("[authed-e2e] To enable, create that file containing:");
  console.log("[authed-e2e]   E2E_EMAIL=<account email>");
  console.log("[authed-e2e]   E2E_PASSWORD=<account password>");
  process.exit(0);
}

const result = spawnSync(
  "npx",
  ["playwright", "test", "--config", "playwright.authed.config.ts", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    shell: true, // npx is npx.cmd on Windows
    env: { ...process.env, E2E_EMAIL: creds.E2E_EMAIL, E2E_PASSWORD: creds.E2E_PASSWORD },
  },
);
process.exit(result.status ?? 1);
