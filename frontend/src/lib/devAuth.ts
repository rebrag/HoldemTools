// src/lib/devAuth.ts
// Dev-only bypass for auth + tier gating. Everything here is gated behind the
// VITE_DEV_AUTH_BYPASS env flag, so production builds are unaffected unless the
// flag is explicitly set to "true" in a local .env.
import type { User } from "firebase/auth";
import type { Tier } from "@/lib/stripe/stripeTiers";

/** When true, inject a mock signed-in user and force the tier (see DEV_TIER). */
export const DEV_AUTH_BYPASS = import.meta.env.VITE_DEV_AUTH_BYPASS === "true";

/** Tier the mock user is treated as. Defaults to "pro" so all content unlocks. */
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
