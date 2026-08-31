// src/bankroll/types.ts
import type { User } from "firebase/auth";
import type { CommonFilterState } from "@/components/filters/types";

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

// The mobile toggle's superset: BreakdownTableMode plus the raw session list.
// Kept a parallel literal rather than importing from the component (wrong
// dependency direction) - keep it in sync with BreakdownTableMode.
export type BreakdownMode = "sessions" | "weekday" | "month" | "year" | "game";

// The common fields (location/game/dates) live in the shared filter shape so
// the hand-history list and this page stay one source of truth; see
// components/filters. Same six string fields as always, so the persisted
// localStorage blob keeps parsing unchanged.
export interface FilterState extends CommonFilterState {
  minHours: string;
  maxHours: string;
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
