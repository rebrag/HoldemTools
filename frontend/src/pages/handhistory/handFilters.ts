// src/pages/handhistory/handFilters.ts
// Filter state + predicate for the hand-history list. All filtering is
// client-side over the already-fetched rows: structured facts come from the
// LRU-memoized summaryFromRawText (one engine fold per hand, ever).
//
// Deliberately NOT an extension of CommonFilterState: the hand list filters on
// what happened IN the hand (who was dealt in, what they did, whose cards are
// known), not on the session it belongs to. Location / stakes / date range
// live on the bankroll tool, which is where a session-attribute question
// actually belongs; a hand found there drills through to its session anyway.
import { summaryFromRawText } from "./create/replay";
import type { ToolRow } from "./types";

export interface HandFilterState {
  /** Players-row Guids; empty = any player. A hand matches when ANY of them
   *  was dealt in (OR), which is how "show me the hands with these regs in
   *  them" reads. Legacy hands (no payload / no links) never match. */
  playerIds: string[];
  /** With playerIds: the matching player saw the flop. */
  playerSawFlop: boolean;
  /** With playerIds: the matching player's hole cards were recorded. */
  playerShowed: boolean;
  /** Only hands where at least one seat's hole cards were recorded - the
   *  hands worth reviewing, as opposed to a fold-out with nothing shown. */
  anyKnownCards: boolean;
  /** Only hands I played, as opposed to the ones I sat and watched. The tell
   *  is the hero seat's own cards: every hand recorded here has a hero seat,
   *  but a hand watched from the rail records no cards for it. */
  myHands: boolean;
}

export const HAND_FILTERS_KEY = "ht_handfilters_v1";

export const defaultHandFilters: HandFilterState = {
  playerIds: [],
  playerSawFlop: false,
  playerShowed: false,
  anyKnownCards: false,
  myHands: false,
};

// Tolerant parser for the persisted blob (same contract as bankroll's):
// anything malformed or missing falls back field-by-field to the default.
// A blob written before the multi-select landed carries a single `playerId`;
// it is read as a one-element selection rather than dropped, so a saved filter
// survives the upgrade.
export function parseHandFiltersOrDefault(raw: string): HandFilterState {
  const v: unknown = JSON.parse(raw);
  if (typeof v !== "object" || v === null) return defaultHandFilters;
  const o = v as Record<string, unknown>;
  const bool = (k: keyof HandFilterState): boolean => o[k] === true;
  const ids = Array.isArray(o.playerIds)
    ? o.playerIds.filter((id): id is string => typeof id === "string" && !!id)
    : typeof o.playerId === "string" && o.playerId
      ? [o.playerId]
      : [];
  return {
    playerIds: ids,
    playerSawFlop: bool("playerSawFlop"),
    playerShowed: bool("playerShowed"),
    anyKnownCards: bool("anyKnownCards"),
    myHands: bool("myHands"),
  };
}

export function isFiltering(f: HandFilterState): boolean {
  return f.playerIds.length > 0 || f.anyKnownCards || f.myHands;
  // playerSawFlop / playerShowed alone filter nothing (they qualify
  // playerIds, which is already counted above).
}

export function rowMatches(row: ToolRow, f: HandFilterState): boolean {
  if (!isFiltering(f)) return true;

  // Every filter needs the embedded payload; legacy hands without one fail
  // them when active (approved scope: no backward compatibility).
  const summary = summaryFromRawText(row.rawText);
  if (!summary) return false;

  if (f.anyKnownCards && !summary.seatFacts.some((s) => s.showedCards)) return false;

  if (f.myHands && !summary.seatFacts.some((s) => s.isHero && s.showedCards)) return false;

  if (f.playerIds.length > 0) {
    // OR over the selection, with the qualifiers applied to the SAME seat: a
    // hand matches when one selected player was dealt in and personally
    // satisfies whichever qualifiers are on.
    const hit = summary.seatFacts.some(
      (s) =>
        !!s.playerId &&
        f.playerIds.includes(s.playerId) &&
        (!f.playerSawFlop || s.sawFlop) &&
        (!f.playerShowed || s.showedCards)
    );
    if (!hit) return false;
  }

  return true;
}
