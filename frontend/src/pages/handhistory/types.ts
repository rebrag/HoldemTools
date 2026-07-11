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

// A unified row for the list: server hands carry a numeric `id`, local
// (signed-out) hands carry a string `localId`. Normalizing both to a string
// `key` keeps rendering/expansion/editing free of id-type collisions.
export type ToolRow = {
  key: string;
  isLocal: boolean;
  rawText: string;
  clean: string; // rawText with the embedded replay payload stripped (for display/copy)
  replayable: boolean; // has an embedded replay payload → the Replay button is shown
  createdAt: string;
  sessionId: string | null;
  server?: HandHistory; // present only for server-backed rows
  synthetic?: boolean; // dev-only "test" fixture row; not persisted
};

export interface HandHistoryDraft {
  rawText: string;
}
