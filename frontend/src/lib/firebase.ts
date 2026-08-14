// src/firebase.ts
import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  type User,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { isCoarsePointer } from "@/lib/pointer";

/**
 * Run against the local Firebase Emulator Suite instead of the real project.
 * Set by USE_FIREBASE_EMULATOR=true, bridged into the bundle by vite.config.ts.
 *
 * This exists for Claude Code cloud sessions (claude.ai/code), which clone from
 * GitHub only and therefore have no .env - see "Firebase emulators" in the root
 * CLAUDE.md. Unset on a normal dev machine, so nothing below changes locally.
 */
export const USE_FIREBASE_EMULATOR =
  import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true";

// Emulator config. `demo-` prefixed project ids are special-cased by Firebase:
// the emulators never ask for credentials and the SDKs refuse to fall back to a
// real backend, so a misconfigured session fails loudly instead of touching
// production. The api key is a required-but-ignored placeholder, not a secret.
const emulatorConfig = {
  apiKey: "demo-api-key",
  authDomain: "localhost",
  projectId: "demo-gto-lite",
  storageBucket: "demo-gto-lite.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:demoemulator",
};

/**
 * Hosts where the Firebase auth handler is served from the app's OWN origin:
 * vercel.json proxies /__/auth/* and /__/firebase/* through to the
 * gto-lite.firebaseapp.com handler, so setting authDomain to the app's host
 * keeps the whole OAuth round trip same-site. That matters twice over:
 *
 *  - Safari's tracking prevention partitions storage for the cross-site
 *    firebaseapp.com handler, which is what makes the classic popup/redirect
 *    flows flaky there.
 *  - On iOS the handler page shares the opener tab's WebContent process; with
 *    the app tab heavy, that shared process was being killed and sign-in died
 *    with Safari's "A problem repeatedly occurred".
 *
 * The list is explicit rather than "any current host" because each host must
 * be an authorized redirect URI on the Google OAuth client - a *.vercel.app
 * preview can't be whitelisted, so previews keep the firebaseapp.com handler.
 */
const SAME_ORIGIN_AUTH_HOSTS = ["www.holdemtools.com", "holdemtools.com"];
const sameOriginAuthHost =
  !USE_FIREBASE_EMULATOR &&
  typeof window !== "undefined" &&
  SAME_ORIGIN_AUTH_HOSTS.includes(window.location.hostname)
    ? window.location.hostname
    : null;

// Firebase config from environment variables
const firebaseConfig = USE_FIREBASE_EMULATOR
  ? emulatorConfig
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: sameOriginAuthHost ?? import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      measurementId: import.meta.env.VITE_FIREBASE_measurementId,
    };

// Initialize Firebase
export const app = initializeApp(firebaseConfig); // ⬅️ export app

// Firebase services. Firestore is intentionally NOT initialized here — it is
// the heaviest part of the SDK and only a few lazily-loaded routes need it.
// Import { db } from "@/lib/firestore" instead (keeps it off the entry chunk).
const auth = getAuth(app);

// Must happen before any sign-in call. Modules are singletons, so this runs
// exactly once; disableWarnings silences the banner the SDK logs on every load.
if (USE_FIREBASE_EMULATOR) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}

// Dev-only: sign in as the developer's real account when the dev server offers
// credentials (see devRealAuth in vite.config.ts). The import.meta.env.DEV
// guard makes production builds drop the dynamic import - devRealAuth.ts never
// ships. Skipped under the auth bypass (which force-signs-out real sessions)
// and under the emulators (real-project credentials mean nothing there).
if (
  import.meta.env.DEV &&
  !USE_FIREBASE_EMULATOR &&
  import.meta.env.VITE_DEV_AUTH_BYPASS !== "true"
) {
  void import("@/lib/devRealAuth").then((m) => m.autoSignIn(auth));
}

const provider = new GoogleAuthProvider();

/**
 * Google sign-in, flow chosen by device.
 *
 * Touch devices use the redirect flow: no popup means no second page sharing
 * the app tab's process on iOS (see SAME_ORIGIN_AUTH_HOSTS above for why that
 * was killing sign-in). Redirect is only reliable when the handler is
 * same-site, so it is gated on sameOriginAuthHost; everywhere else (desktop,
 * localhost, vercel previews) keeps the popup.
 *
 * On the redirect path this promise never settles - the page navigates away,
 * and the result lands via getRedirectResult/onAuthStateChanged after the
 * round trip back. Callers' post-await code simply doesn't run, which is the
 * behavior they want anyway (the whole page is about to reload).
 */
const signInWithGoogle = async (): Promise<User> => {
  if (sameOriginAuthHost && isCoarsePointer()) {
    return signInWithRedirect(auth, provider);
  }
  const result = await signInWithPopup(auth, provider);
  return result.user;
};

export {
  auth,
  provider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  signInWithGoogle,
  FirebaseError,
};
