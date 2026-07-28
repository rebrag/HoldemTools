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
const BASE_URL = `http://localhost:${DEV_PORT}`;

export default defineConfig({
  testDir: "./e2e",
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
    /* Specs that need a signed-in user (the postflop library is auth-gated)
       drive the dev auth store via localStorage, which only exists when the
       bypass is compiled in. Setting it here rather than in a local .env keeps
       the suite reproducible on any checkout and in CI. The store still starts
       SIGNED OUT, so specs that do not opt in are unaffected. */
    env: { VITE_DEV_AUTH_BYPASS: "true" },
  },
});
