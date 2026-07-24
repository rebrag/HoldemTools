// Firestore lives in its own module so the SDK stays out of the entry chunk.
// Only import this from lazily-loaded code (or via dynamic import, as useTier
// does); a static import from an eager module drags Firestore back onto the
// critical path.
import {
  getFirestore,
  connectFirestoreEmulator,
  serverTimestamp,
} from "firebase/firestore";
import { app, USE_FIREBASE_EMULATOR } from "./firebase";

export const db = getFirestore(app);

// Point at the local Firestore emulator when USE_FIREBASE_EMULATOR=true (see
// firebase.ts). Must run before the first read/write; this module is a
// singleton, so it happens exactly once, on first import by a lazy route.
if (USE_FIREBASE_EMULATOR) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

export const timestamp = serverTimestamp;
