// src/lib/devAuth.ts
// Dev-only dummy auth for exercising the real login/logout flows without hitting
// Firebase. Gated behind the VITE_DEV_AUTH_BYPASS env flag, so production builds
// are unaffected unless the flag is explicitly set to "true" in a local .env.
//
// Unlike a static "always signed in" stub, this is a small observable store that
// starts SIGNED OUT and can be flipped at runtime:
//   - through the real UI (the login modal / navbar Login+Logout buttons drive it
//     when the bypass is on), so the actual flows are testable and screenshottable;
//   - programmatically via `window.__devAuth.signIn() / .signOut() / .toggle()`,
//     which is handy for automated/browser-driven testing.
// The signed-in flag is persisted in localStorage so it survives reloads.
import { useSyncExternalStore } from "react";
import type { User } from "firebase/auth";
import type { Tier } from "@/lib/stripe/stripeTiers";

/** When true, enable the dev dummy auth (starts signed out, toggleable). */
export const DEV_AUTH_BYPASS = import.meta.env.VITE_DEV_AUTH_BYPASS === "true";

/** Tier the mock user is treated as while signed in. Defaults to "pro". */
export const DEV_TIER: Tier = (import.meta.env.VITE_DEV_TIER as Tier) || "pro";

/**
 * A minimal stand-in for a Firebase `User`, carrying only the fields the app
 * actually reads (uid / email / displayName / emailVerified / getIdToken).
 * Cast through `unknown` since we intentionally don't implement the full type.
 */
export const mockDevUser = {
  uid: "dev-user",
  email: "dev@holdemtools.local",
  emailVerified: true,
  displayName: "Dev User",
  getIdToken: async () => "dev-token",
} as unknown as User;

const STORAGE_KEY = "ht_dev_signed_in";

function readInitial(): boolean {
  if (!DEV_AUTH_BYPASS) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

let signedIn = readInitial();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Flip the dev signed-in state (no-op unless the bypass is enabled). */
export function setDevAuthSignedIn(next: boolean): void {
  if (!DEV_AUTH_BYPASS || next === signedIn) return;
  signedIn = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
  } catch {
    /* ignore */
  }
  emit();
}

export const devAuthSignIn = () => setDevAuthSignedIn(true);
export const devAuthSignOut = () => setDevAuthSignedIn(false);

/**
 * Current dev user, or `null` when signed out / bypass disabled. Returns stable
 * references (the same `mockDevUser` object or `null`) so it's safe to use as a
 * `useSyncExternalStore` snapshot.
 */
export function devAuthUser(): User | null {
  return DEV_AUTH_BYPASS && signedIn ? mockDevUser : null;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook: re-renders the caller whenever the dev auth state flips. */
export function useDevAuthUser(): User | null {
  return useSyncExternalStore(subscribe, devAuthUser, devAuthUser);
}

// Console controls for manual toggling / automated browser testing in dev.
if (DEV_AUTH_BYPASS && typeof window !== "undefined") {
  (window as unknown as { __devAuth?: unknown }).__devAuth = {
    signIn: devAuthSignIn,
    signOut: devAuthSignOut,
    toggle: () => setDevAuthSignedIn(!signedIn),
    get signedIn() {
      return signedIn;
    },
  };
}
