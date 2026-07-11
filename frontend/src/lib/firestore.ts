// Firestore lives in its own module so the SDK stays out of the entry chunk.
// Only import this from lazily-loaded code (or via dynamic import, as useTier
// does); a static import from an eager module drags Firestore back onto the
// critical path.
import { getFirestore, serverTimestamp } from "firebase/firestore";
import { app } from "./firebase";

export const db = getFirestore(app);
export const timestamp = serverTimestamp;
