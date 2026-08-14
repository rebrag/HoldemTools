import { test as setup, expect } from "@playwright/test";
import { AUTH_FILE } from "../../playwright.authed.config";

/**
 * Signs in as the real account once per run and snapshots the session for
 * every authed spec. The sign-in goes through the app's OWN firebase module
 * (imported off the Vite dev server), so it uses the same singleton `auth`
 * the UI uses and lands in the same IndexedDB persistence - no UI driving,
 * no hand-rolled IndexedDB writes against Firebase's internal schema.
 */
setup("sign in as the real e2e account", async ({ page, context }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_EMAIL / E2E_PASSWORD not set. Run this lane via `npm run test:e2e:authed`, " +
      "which loads them from ~/.holdemtools/env/e2e.env.",
    );
  }

  await page.goto("/");

  /* A server built with VITE_DEV_AUTH_BYPASS=true actively signs real users
     OUT (App.tsx onAuthStateChanged) - signing in against it would silently
     un-happen. __devAuth only exists on bypass builds. */
  if (await page.evaluate(() => "__devAuth" in window)) {
    throw new Error(
      "The dev server on this port was built with VITE_DEV_AUTH_BYPASS=true, " +
      "which force-signs-out real accounts. Restart it without the flag " +
      "(it is unset in the canonical env by default) and rerun.",
    );
  }

  await page.evaluate(
    async ([em, pw]) => {
      /* new Function keeps the dynamic import out of any transpiler's reach,
         so it resolves against the dev server at runtime. */
      const mod = await new Function('return import("/src/lib/firebase.ts")')();
      await mod.signInWithEmailAndPassword(mod.auth, em, pw);
    },
    [email, password] as const,
  );

  /* Reload before snapshotting: proves the session round-trips through
     IndexedDB persistence, which is exactly what storageState will capture. */
  await page.reload();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const mod = await new Function('return import("/src/lib/firebase.ts")')();
          return mod.auth.currentUser?.email ?? null;
        }),
      { timeout: 20_000 },
    )
    .toBe(email);

  await context.storageState({ path: AUTH_FILE, indexedDB: true });
});
