// src/pages/handhistory/types.ts
import type { User } from "firebase/auth";

export interface HandHistory {
  id: string;
  userId: string;
  title: string | null;
  rawText: string;
  sessionId: string | null; // reserved for future bankroll-session link; unused by UI for now
  createdAt: string; // ISO
  updatedAt: string | null; // ISO
}

export interface HandHistoryToolProps {
  user: User | null;
}

export interface HandHistoryDraft {
  title: string;
  rawText: string;
}
