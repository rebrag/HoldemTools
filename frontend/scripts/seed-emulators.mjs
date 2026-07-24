#!/usr/bin/env node
// Seed the Firebase Auth + Firestore emulators with test users and the baseline
// documents the app reads on startup.
//
//   cd frontend && node scripts/seed-emulators.mjs
//
// Idempotent: users have fixed uids, so re-running recreates nothing and the
// document writes just overwrite themselves. Safe on every session start.
//
// Nothing here is a credential. The project is `demo-gto-lite` (a Firebase
// "demo-" project, which only ever exists inside an emulator) and the seeded
// password is a well-known test value.
//
// Lives under frontend/ rather than firebase/ because it imports firebase-admin,
// which only resolves from frontend/node_modules (the repo has no root package).
import { pathToFileURL } from "node:url";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "demo-gto-lite";

// The Admin SDK talks to the emulators purely through these env vars, and skips
// its credential lookup entirely when they are set - which is what lets this run
// with no service account anywhere. Defaulted here so the script works whether
// or not the surrounding session exported them.
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";

/** Password the seeded accounts share. */
export const SEED_PASSWORD = "emulator-password";

// Price ids the frontend compares against (getPriceIdForTier reads these env
// vars via import.meta.env). Fall back to stable fakes so the seeded catalog
// still matches a cloud session that has no Stripe vars set.
export const SEED_PRICE_IDS = {
  pro: process.env.VITE_STRIPE_PRICE_ID_PRO ?? "price_pro_emulator",
  plus: process.env.VITE_STRIPE_PRICE_ID_PLUS ?? "price_plus_emulator",
};

/**
 * Users to create. The uids are fixed rather than generated so seeded data is
 * reproducible across runs and other scripts can reference a user without
 * looking it up.
 */
export const SEED_USERS = [
  {
    uid: "seed-admin",
    email: "thejoshgarber@gmail.com", // matches Admin:Emails in appsettings.json
    displayName: "Josh (admin)",
    tier: "pro",
    courseProgress: [1, 2, 3],
  },
  {
    uid: "seed-pro",
    email: "pro@holdemtools.local",
    displayName: "Pro User",
    tier: "pro",
    courseProgress: [1],
  },
  {
    uid: "seed-free",
    email: "free@holdemtools.local",
    displayName: "Free User",
    tier: "free",
    courseProgress: [],
  },
];

// Even with the emulator hosts set, the Admin SDK runs Application Default
// Credentials discovery, which probes the GCP metadata server. The emulator
// never needs that token, but the probe is a real network call that can stall
// in a locked-down container. Turning detection off makes gcp-metadata fail
// fast and locally instead of over the wire.
//
// Note a fake `credential` object does NOT work here: getFirestore() type-checks
// the credential and rejects anything that isn't a real Credential implementation.
process.env.METADATA_SERVER_DETECTION ??= "none";

const app = initializeApp({ projectId: PROJECT_ID }, `seed-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);

/** Create the user, or leave the existing one alone. Both outcomes are fine. */
async function ensureUser({ uid, email, displayName }) {
  try {
    await auth.createUser({
      uid,
      email,
      displayName,
      password: SEED_PASSWORD,
      emailVerified: true, // so VerifyEmailPrompt doesn't block seeded accounts
    });
    console.log(`  + created ${email} (${uid})`);
  } catch (err) {
    if (
      err.code === "auth/uid-already-exists" ||
      err.code === "auth/email-already-exists"
    ) {
      console.log(`  = reusing ${email} (${uid})`);
      return;
    }
    throw err;
  }
}

/** Seed the running emulators. Exported so the verify script can call it. */
export async function seedEmulators() {
  console.log(`Seeding emulators for project ${PROJECT_ID}…`);

  // Stripe product catalog, read by loadActiveProducts().
  for (const [id, name, priceId, amount] of [
    ["prod_pro", "HoldemTools Pro", SEED_PRICE_IDS.pro, 2999],
    ["prod_plus", "HoldemTools Plus", SEED_PRICE_IDS.plus, 999],
  ]) {
    await db.doc(`products/${id}`).set({
      name,
      description: `${name} (emulator seed)`,
      active: true,
    });
    await db.doc(`products/${id}/prices/${priceId}`).set({
      active: true,
      currency: "usd",
      unit_amount: amount,
      interval: "month",
    });
  }
  console.log("  + product catalog");

  for (const user of SEED_USERS) {
    await ensureUser(user);

    await db.doc(`users/${user.uid}`).set({
      email: user.email,
      subscription: user.tier === "free" ? "inactive" : "active",
    });

    if (user.courseProgress.length > 0) {
      await db
        .doc(`courseProgress/${user.uid}`)
        .set({ completedSections: user.courseProgress });
    }

    if (user.tier !== "free") {
      // Shape mirrors what the "Run Payments with Stripe" extension writes, so
      // useTier() resolves the tier the same way it does in production.
      const priceId = SEED_PRICE_IDS[user.tier];
      await db.doc(`customers/${user.uid}`).set({ email: user.email });
      await db
        .doc(`customers/${user.uid}/subscriptions/sub_${user.tier}_emulator`)
        .set({
          status: "active",
          price: { id: priceId },
          items: [{ price: { id: priceId } }],
        });
    }
  }

  console.log(
    `\nDone. Sign in with any seeded email and password "${SEED_PASSWORD}".\n` +
      `Emulator UI: http://127.0.0.1:4000`
  );
}

// Only self-execute when run as a script; stays inert when imported.
const runDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (runDirectly) {
  seedEmulators()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n[seed-emulators] ${err.message}`);
      process.exit(1);
    });
}
