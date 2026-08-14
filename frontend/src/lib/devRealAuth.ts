// Dev-only auto-sign-in as the developer's real account. Loaded exclusively
// via the guarded dynamic import in lib/firebase.ts, so production builds
// tree-shake this module away entirely.
//
// The credentials come from the dev server's /__dev/real-auth-creds endpoint
// (see devRealAuth in vite.config.ts), which reads ~/.holdemtools/env/e2e.env
// and answers loopback requests only. This module never logs them.
import type { Auth } from "firebase/auth";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";

/**
 * Runs once per page load: waits for the persisted session to resolve, and
 * only if the app is signed OUT fetches the dev credentials and signs in.
 * An explicit logout therefore sticks until the next reload; to work
 * signed-out across reloads, start the server with DEV_REAL_AUTH=false.
 */
export function autoSignIn(auth: Auth): void {
  const unsub = onAuthStateChanged(auth, (user) => {
    unsub();
    if (user) return;
    void (async () => {
      try {
        const res = await fetch("/__dev/real-auth-creds", {
          headers: { Accept: "application/json" },
        });
        // 404 = feature off (no e2e.env, DEV_REAL_AUTH=false, emulator mode).
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) return;
        const { email, password } = (await res.json()) as { email?: string; password?: string };
        if (!email || !password) return;
        await signInWithEmailAndPassword(auth, email, password);
        console.info(
          `[devRealAuth] dev-only auto sign-in as ${email} ` +
          "(from ~/.holdemtools/env/e2e.env; disable with DEV_REAL_AUTH=false)",
        );
      } catch (err) {
        console.warn("[devRealAuth] auto sign-in failed:", err);
      }
    })();
  });
}
