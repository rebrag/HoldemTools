// src/components/filters/types.ts
// Shared filter-state shape for the tools that filter by session attributes
// (bankroll sessions, hand histories). Each tool extends this with its own
// fields; SessionFilterPanel renders the common controls for any extension.
export interface CommonFilterState {
  location: string;
  /** NOTE: historical name — this matches BankrollSession.blinds (the stakes
   *  string, e.g. "1/2 NLH"), not the session's `game` field. Bankroll has
   *  always filtered this way and persisted filters rely on it; do not "fix". */
  game: string;
  fromDate: string; // YYYY-MM-DD ("" = unbounded)
  toDate: string;
}

export type FilterTheme = "light" | "dark";
