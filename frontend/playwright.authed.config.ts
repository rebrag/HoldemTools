import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

/**
 * The AUTHED lane: runs against the checkout's REAL dev server (no
 * VITE_DEV_AUTH_BYPASS) signed in as a real Firebase account, so specs see
 * the account's actual hand histories and solutions from the deployed API.
 *
 * Never invoked by `npm run test:e2e` (that is the mocked lane on its own
 * port - see playwright.config.ts). Run it with `npm run test:e2e:authed`,
 * which loads E2E_EMAIL / E2E_PASSWORD from ~/.holdemtools/env/e2e.env and
 * skips cleanly when they are absent - so CI never needs credentials.
 */

const DEV_PORT = Number(loadEnv("development", process.cwd(), "").VITE_DEV_PORT) || 5173;
const BASE_URL = `http://localhost:${DEV_PORT}`;

/* Snapshot of the signed-in session (IndexedDB included - Firebase persists
   there, not in cookies/localStorage). Contains a live refresh token, hence
   gitignored. Recreated by the setup project on every run. */
export const AUTH_FILE = "e2e/.auth/user.json";

export default defineConfig({
  testDir: "./e2e/authed",
  outputDir: "./test-results-authed",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  /* Modest cap: these workers all hit the real deployed API. */
  workers: 4,
  reporter: [["list"]],
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: "off",
    screenshot: "only-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },

  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      /* Credentials pass through page.evaluate here - keep every artifact
         channel off so they can never land in a trace or screenshot. */
      use: { trace: "off", screenshot: "off", video: "off" },
    },
    {
      name: "authed-desktop",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        storageState: AUTH_FILE,
      },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    /* Attaching to an already-running dev server is the point of this lane -
       it is the same server the developer is looking at. auth.setup.ts guards
       against the one bad case (a server built with the dev-auth bypass). */
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      /* Force the bypass OFF if this config has to start the server itself,
         even if a stray shell export or .env re-enables it. */
      VITE_DEV_AUTH_BYPASS: "",
      VITE_POSTFLOP_ENABLED: "true",
    },
  },
});
