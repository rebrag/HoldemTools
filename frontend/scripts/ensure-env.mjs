#!/usr/bin/env node
/**
 * Materializes frontend/.env from the one canonical copy that lives outside the
 * repo, then checks it against the committed .env.example.
 *
 * Why this exists
 * ---------------
 * frontend/.env is gitignored, so it does NOT travel to a `git worktree`: a new
 * worktree starts without it, every `import.meta.env.VITE_*` reads `undefined`,
 * and Firebase either throws on initializeApp or half-initializes silently.
 * Copying the file by hand fixes that once and then rots - N worktrees means N
 * divergent copies, and a key added in one is silently absent in the others.
 *
 * So there is exactly one editable copy:
 *
 *     ~/.holdemtools/env/frontend.env      (HOLDEMTOOLS_ENV_DIR overrides the dir)
 *
 * and this script overwrites frontend/.env from it on every dev/build. Drift is
 * structurally impossible because the in-repo file is derived, never authored.
 * .env.example is the committed manifest of what the app needs; because it IS
 * tracked it reaches every worktree for free, which is what lets a missing key
 * fail loudly here instead of turning into an `undefined` at runtime.
 *
 * Run directly with `npm run env:check`; wired to predev / prebuild / pretest:e2e.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = path.join(FRONTEND, ".env");
const EXAMPLE = path.join(FRONTEND, ".env.example");
const BACKUP = path.join(FRONTEND, ".env.bak");

const CANONICAL_DIR =
  process.env.HOLDEMTOOLS_ENV_DIR || path.join(homedir(), ".holdemtools", "env");
const CANONICAL = path.join(CANONICAL_DIR, "frontend.env");

const log = (msg) => console.error(`[ensure-env] ${msg}`);

function fail(lines) {
  console.error("");
  for (const line of lines) console.error(`[ensure-env] ${line}`);
  console.error("");
  process.exit(1);
}

/**
 * Minimal .env reader. Returns the keys assigned on live lines and the keys
 * assigned on commented-out lines, kept separate because .env.example uses that
 * distinction to mean required vs optional. Prose comments never match, since
 * the pattern demands an identifier immediately followed by `=`.
 */
function parseKeys(text) {
  const live = new Set();
  const commented = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const isComment = line.startsWith("#");
    const body = isComment ? line.replace(/^#+\s*/, "") : line;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(body);
    if (!match) continue;
    (isComment ? commented : live).add(match[1]);
  }
  return { live, commented };
}

if (!existsSync(EXAMPLE)) {
  fail([
    `Missing ${path.relative(FRONTEND, EXAMPLE)}, which is committed and should always be present.`,
    "Restore it with: git checkout -- frontend/.env.example",
  ]);
}

const example = parseKeys(readFileSync(EXAMPLE, "utf8"));
const required = [...example.live];

// The emulator suite supplies its own offline config and deliberately ignores
// .env entirely (see "Firebase emulators" in the root CLAUDE.md), so there is
// nothing to materialize.
if (process.env.USE_FIREBASE_EMULATOR === "true") {
  log("USE_FIREBASE_EMULATOR=true - skipping (.env is unused in emulator mode).");
  process.exit(0);
}

// Managed builds (Vercel, CI) inject the variables into the process directly and
// never have a .env on disk. Detected by the variables themselves rather than by
// vendor flags, so it holds for any host. A partially-configured CI still falls
// through and fails below, which is what you want.
if (required.every((key) => process.env[key])) {
  log("All required variables already present in the environment - skipping.");
  process.exit(0);
}

if (!existsSync(CANONICAL)) {
  fail([
    `No canonical env file at ${CANONICAL}`,
    "",
    "This machine has never been set up, or HOLDEMTOOLS_ENV_DIR points somewhere else.",
    "Create it by copying the template and filling in the real values:",
    "",
    `  mkdir -p "${CANONICAL_DIR}"`,
    `  cp "${path.relative(process.cwd(), EXAMPLE) || EXAMPLE}" "${CANONICAL}"`,
    "",
    `Values come from the Firebase and Stripe consoles; ${path.basename(EXAMPLE)} says which.`,
    "No credentials to hand? Run against the emulators instead: USE_FIREBASE_EMULATOR=true",
  ]);
}

const canonicalText = readFileSync(CANONICAL, "utf8");
const canonical = parseKeys(canonicalText);

// Validate before writing, so a canonical file that is missing keys leaves the
// existing frontend/.env untouched rather than replacing it with a broken one.
const missing = required.filter((key) => !canonical.live.has(key));

if (missing.length > 0) {
  fail([
    `${missing.length} required variable(s) missing from ${CANONICAL}:`,
    "",
    ...missing.map((key) => `  ${key}`),
    "",
    `.env.example lists them as required. Add them there, or comment the key out`,
    "in .env.example if it is genuinely optional.",
    "",
    "frontend/.env was left unchanged.",
  ]);
}

// The in-repo copy is derived, so it is safe to clobber - but someone who edited
// it by habit would lose that work silently, so keep a recoverable copy once.
if (existsSync(TARGET) && readFileSync(TARGET, "utf8") !== canonicalText) {
  copyFileSync(TARGET, BACKUP);
  log(`frontend/.env differed from the canonical file; previous contents saved to .env.bak.`);
  log(`Edit ${CANONICAL} instead - frontend/.env is overwritten on every run.`);
}

writeFileSync(TARGET, canonicalText);

const undocumented = [...canonical.live].filter(
  (key) => !example.live.has(key) && !example.commented.has(key),
);

if (undocumented.length > 0) {
  log(
    `Not documented in .env.example: ${undocumented.join(", ")}. ` +
      "Add them so other checkouts know they exist.",
  );
}

log(`frontend/.env written from ${CANONICAL} (${required.length} required vars present).`);
