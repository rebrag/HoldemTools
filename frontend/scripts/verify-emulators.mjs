// End-to-end check of the Firebase emulator setup, driving the REAL client SDK
// through the same calls the app makes. Seeds first, then asserts.
//
//   cd frontend && npm run test:emulators
//
// That npm script wraps this in `firebase emulators:exec`, which starts the
// emulators, runs this file, and tears them down - so there is no lifecycle to
// manage by hand. To run it against emulators you already have up:
//
//   cd frontend && node scripts/verify-emulators.mjs
//
// Deliberately uses the client SDK, not firebase-admin: the seed writes with
// admin privileges, so only a client-side read proves the app's own path works
// and that firestore.rules actually permit it.
import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  arrayUnion,
} from "firebase/firestore";
import {
  seedEmulators,
  SEED_PASSWORD,
  SEED_PRICE_IDS,
} from "./seed-emulators.mjs";

// Mirrors the emulator branch of src/lib/firebase.ts. Kept as a literal rather
// than imported because that module is TypeScript compiled by Vite.
const app = initializeApp({
  apiKey: "demo-api-key",
  authDomain: "localhost",
  projectId: "demo-gto-lite",
  storageBucket: "demo-gto-lite.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:demoemulator",
});

const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);

// Verbatim copy of the tier logic in src/hooks/useTier.ts. If that hook changes,
// this should change with it - the point is to catch a drift between what the
// seed writes and what the app expects.
const ACTIVE = new Set(["active", "trialing", "past_due"]);

function resolveTier(snap) {
  let best = "free";
  snap.forEach((d) => {
    const data = d.data() ?? {};
    if (!ACTIVE.has(String(data.status ?? "").toLowerCase())) return;
    const items = Array.isArray(data.items) ? data.items : [];
    const nested = items[0]?.price?.id;
    const flat = data?.price?.id ?? data?.price_id;
    const candidate =
      (typeof nested === "string" && nested) ||
      (typeof flat === "string" && flat) ||
      "";
    if (SEED_PRICE_IDS.pro && candidate === SEED_PRICE_IDS.pro) best = "pro";
    else if (SEED_PRICE_IDS.plus && candidate === SEED_PRICE_IDS.plus) {
      if (best !== "pro") best = "plus";
    }
  });
  return best;
}

let failures = 0;

function check(label, ok, extra = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${extra ? ` - ${extra}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  await seedEmulators();
  console.log("\nVerifying against the client SDK…");

  // 1. Sign in through the Auth emulator, as LoginSignup does.
  const pro = await signInWithEmailAndPassword(
    auth,
    "pro@holdemtools.local",
    SEED_PASSWORD
  );
  check("sign in as pro@holdemtools.local", !!pro.user.uid);
  check(
    "seeded account is email-verified (VerifyEmailPrompt won't block)",
    pro.user.emailVerified === true
  );

  // 2. useTier path: the seeded subscription must resolve to pro.
  const subs = await getDocs(
    collection(db, "customers", pro.user.uid, "subscriptions")
  );
  const tier = resolveTier(subs);
  check("useTier resolves 'pro' for the seeded pro user", tier === "pro", `got "${tier}"`);

  // 3. Public catalog read (loadActiveProducts).
  const products = await getDocs(collection(db, "products"));
  check("products catalog is readable", products.size === 2, `${products.size} docs`);

  // 4. courseProgress read + write (useCourseProgress).
  await setDoc(
    doc(db, "courseProgress", pro.user.uid),
    { completedSections: arrayUnion(42) },
    { merge: true }
  );
  const progress = await getDoc(doc(db, "courseProgress", pro.user.uid));
  check(
    "courseProgress write + read round-trips",
    (progress.data()?.completedSections ?? []).includes(42)
  );

  // 5. Rules enforcement: one user must not read another's private doc.
  const free = await signInWithEmailAndPassword(
    auth,
    "free@holdemtools.local",
    SEED_PASSWORD
  );
  let denied = false;
  try {
    await getDoc(doc(db, "courseProgress", pro.user.uid));
  } catch (err) {
    denied = err.code === "permission-denied";
  }
  check("firestore.rules denies a cross-user read", denied);

  // 6. And the free user stays free.
  const freeSubs = await getDocs(
    collection(db, "customers", free.user.uid, "subscriptions")
  );
  check(
    "useTier resolves 'free' for the seeded free user",
    resolveTier(freeSubs) === "free"
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED.`);
    process.exit(1);
  }
  console.log("\nAll emulator checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n[verify-emulators] ${err.stack ?? err.message}`);
  process.exit(1);
});
