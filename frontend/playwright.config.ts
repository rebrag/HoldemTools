import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

/**
 * Playwright drives its own Chromium, so it composites frames and can take
 * real screenshots regardless of whether any editor preview pane is open.
 *
 * Deliberately NOT wired into `npm run build` - Vercel should never pay for
 * a browser download or a test run on deploy. Run it locally with
 * `npm run test:e2e`, or in CI where the browsers are installed explicitly.
 */

/* Resolved exactly the way vite.config.ts resolves it, so a worktree running on
   a bumped VITE_DEV_PORT tests ITS OWN dev server. Hardcoding 5173 here was a
   silent cross-worktree hazard: combined with reuseExistingServer below, a
   second checkout would attach to the first checkout's server and report
   passing results for code it never loaded. */
const DEV_PORT = Number(loadEnv("development", process.cwd(), "").VITE_DEV_PORT) || 5173;

/* The mocked suite gets its own port, offset from the checkout's dev port.
   The suite compiles in VITE_DEV_AUTH_BYPASS and stubs every API route, so
   letting reuseExistingServer attach to a developer's real-auth server on
   DEV_PORT meant specs silently ran against a build with none of those
   assumptions (and the developer's browser session got a bypass server on
   the next restart). On its own port the only thing the suite can ever
   reuse is a previous mock-lane server with identical env. The injected
   VITE_DEV_PORT wins over the generated .env because Vite's loadEnv applies
   process.env last. The real-account lane (playwright.authed.config.ts)
   keeps targeting DEV_PORT. */
const MOCK_PORT = DEV_PORT + 100;
const BASE_URL = `http://localhost:${MOCK_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  /* Authed specs run against the REAL dev server and real account via
     playwright.authed.config.ts - never as part of the mocked suite. */
  testIgnore: "**/authed/**",
  outputDir: "./test-results",
  snapshotDir: "./e2e/__screenshots__",
  /* Baselines are per-platform on purpose: text antialiasing differs enough
     between Windows (DirectWrite) and Linux (FreeType) to blow past any sane
     diff threshold on a table this text-dense. Keeping them in separate
     folders means moving CI to a Linux runner is a regeneration, not a
     silent mismatch against someone else's baseline. */
  snapshotPathTemplate:
    "{snapshotDir}/{testFileName}/{platform}/{arg}-{projectName}{ext}",

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  /* Above Playwright's 5s default. The suite is fullyParallel against a DEV
     server, so a route's first paint pays for on-demand transforms of the
     bundle it needs while every other worker is asking for its own - /solutions
     lands in ~1.3s serially and had been blowing past 5s under an 8-worker run.
     This only bounds how long a FAILING assertion waits; a passing one still
     resolves as soon as the condition holds. */
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    /* The dropdown's entrance animation is driven by framer-motion, which
       honours this via useReducedMotion - without it every screenshot races
       a 160ms transform and geometry assertions read scaled values.
       This has to sit under contextOptions; as a bare `use` key it is
       silently ignored, which is precisely what `typecheck:e2e` caught. */
    contextOptions: { reducedMotion: "reduce" },
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    /* The suite supplies its own feature flags rather than inheriting whatever
       .env a checkout happens to have, so it behaves the same locally and in
       CI (which ships no .env at all - see .github/workflows/frontend-ci.yml).

       DEV_AUTH_BYPASS: the postflop library is auth-gated, and specs flip the
       dev auth store through localStorage, which only exists when the bypass
       is compiled in. The store still starts SIGNED OUT, so specs that do not
       opt in are unaffected.

       POSTFLOP_ENABLED: gates the solved-flops library button. Without it the
       postflop specs have no way into a board at all. */
    env: {
      VITE_DEV_PORT: String(MOCK_PORT),
      VITE_DEV_AUTH_BYPASS: "true",
      VITE_POSTFLOP_ENABLED: "true",
    },
  },
});
