// src/bankroll/types.ts
import type { User } from "firebase/auth";

export interface BankrollSession {
  id: string;
  userId: string;
  type: string;
  start: string | null; // ISO
  end: string | null;
  hours: number | null;
  location: string | null;
  game: string | null;
  blinds: string | null;
  buyIn: number | null;
  cashOut: number | null;
  profit: number;
}

export interface BankrollTrackerProps {
  user: User | null;
}

export interface FormState {
  type: string;
  start: string; // datetime-local
  end: string;
  location: string;
  blinds: string;
  buyIn: string;
  cashOut: string;
}

export interface BankrollStats {
  totalProfit: number;
  totalHours: number;
  numSessions: number;
  hourly: number;
}

export type CumulativePoint = {
  x: number;
  y: number;
  session: BankrollSession | null;
};

export interface SessionDuration {
  hours: number;
  minutes: number;
}
