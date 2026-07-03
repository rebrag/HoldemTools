// src/pages/handhistory/types.ts
import type { User } from "firebase/auth";

export interface HandHistory {
  id: number; // "HandId" — sequential identity PK
  userId: string;
  rawText: string;
  sessionId: string | null; // optional bankroll-session link; unused by UI for now
  createdAt: string; // ISO
  updatedAt: string | null; // ISO
}

// A hand created while signed out. Persisted only in the browser
// (localStorage) and auto-migrated to the server once the user signs in.
export interface LocalHandHistory {
  localId: string; // client-generated (see makeLocalId)
  rawText: string;
  createdAt: string; // ISO — lets local hands sort alongside server hands
}

export interface HandHistoryToolProps {
  user: User | null;
}

export interface HandHistoryDraft {
  rawText: string;
}
