// src/pages/handhistory/handFilters.ts
// Filter state + predicate for the hand-history list. All filtering is
// client-side over the already-fetched rows: structured facts come from the
// LRU-memoized summaryFromRawText (one engine fold per hand, ever), and
// session attributes (location / stakes) come from the linked bankroll
// session, matching the HandHistory model's design note.
import type { BankrollSession } from "@/pages/bankroll/types";
import type { CommonFilterState } from "@/components/filters/types";
import { parseDateBound } from "@/components/filters/dateBounds";
import { summaryFromRawText } from "./create/replay";
import type { ToolRow } from "./types";

export interface HandFilterState extends CommonFilterState {
  /** Players-row Guid; "" = any player. Matches hands whose payload links a
   *  seat to this player. Legacy hands (no payload / no links) never match. */
  playerId: string;
  /** With playerId: only hands where that player saw the flop. */
  playerSawFlop: boolean;
  /** With playerId: only hands where that player's hole cards were recorded. */
  playerShowed: boolean;
}

export const HAND_FILTERS_KEY = "ht_handfilters_v1";

export const defaultHandFilters: HandFilterState = {
  location: "",
  game: "",
  fromDate: "",
  toDate: "",
  playerId: "",
  playerSawFlop: false,
  playerShowed: false,
};

// Tolerant parser for the persisted blob (same contract as bankroll's):
// anything malformed or missing falls back field-by-field to the default.
export function parseHandFiltersOrDefault(raw: string): HandFilterState {
  const v: unknown = JSON.parse(raw);
  if (typeof v !== "object" || v === null) return defaultHandFilters;
  const o = v as Record<string, unknown>;
  const str = (k: keyof HandFilterState): string =>
    typeof o[k] === "string" ? (o[k] as string) : "";
  const bool = (k: keyof HandFilterState): boolean => o[k] === true;
  return {
    location: str("location"),
    game: str("game"),
    fromDate: str("fromDate"),
    toDate: str("toDate"),
    playerId: str("playerId"),
    playerSawFlop: bool("playerSawFlop"),
    playerShowed: bool("playerShowed"),
  };
}

export function isFiltering(f: HandFilterState): boolean {
  return (
    !!f.location ||
    !!f.game ||
    !!f.fromDate ||
    !!f.toDate ||
    !!f.playerId
    // playerSawFlop / playerShowed alone filter nothing (they qualify
    // playerId, which is already counted above).
  );
}

export function rowMatches(
  row: ToolRow,
  f: HandFilterState,
  sessionsById: Map<string, BankrollSession>
): boolean {
  // Location / stakes live on the linked session; an unlinked hand can't
  // satisfy either filter when it's set.
  if (f.location || f.game) {
    const session = row.sessionId ? sessionsById.get(row.sessionId) : undefined;
    if (!session) return false;
    if (f.location && session.location?.trim() !== f.location) return false;
    if (f.game && session.blinds?.trim() !== f.game) return false;
  }

  const fromMs = parseDateBound(f.fromDate, false);
  const toMs = parseDateBound(f.toDate, true);
  if (fromMs !== null || toMs !== null) {
    const t = new Date(row.createdAt).getTime();
    if (Number.isNaN(t)) return false;
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t > toMs) return false;
  }

  // Structured filters need the embedded payload; legacy hands without one
  // fail them when active (approved scope: no backward compatibility).
  if (f.playerId) {
    const summary = summaryFromRawText(row.rawText);
    if (!summary) return false;
    const fact = summary.seatFacts.find((s) => s.playerId === f.playerId);
    if (!fact) return false;
    if (f.playerSawFlop && !fact.sawFlop) return false;
    if (f.playerShowed && !fact.showedCards) return false;
  }

  return true;
}
