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
} from "firebase/auth";
import { FirebaseError } from "firebase/app";

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

// Firebase config from environment variables
const firebaseConfig = USE_FIREBASE_EMULATOR
  ? emulatorConfig
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
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

const provider = new GoogleAuthProvider();

const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    console.log("User info:", user);
    return user;
  } catch (error) {
    console.error("Google sign-in error:", error);
    throw error;
  }
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
