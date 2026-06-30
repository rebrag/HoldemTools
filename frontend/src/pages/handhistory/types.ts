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

export interface HandHistoryToolProps {
  user: User | null;
}

export interface HandHistoryDraft {
  rawText: string;
}
