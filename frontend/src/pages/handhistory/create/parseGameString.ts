// src/pages/handhistory/create/parseGameString.ts
// Best-effort parse of a bankroll session's free-form "Game" string
// (e.g. "2/5 NL", "1/3 PLO", "2/5 NL Ultra") into recorder setup fields.
// Only recognized blind numbers and game tokens are matched, so marketing or
// variant words we don't know (e.g. "Ultra", "Prime") are simply ignored.

export interface ParsedGame {
  game?: string; // "Holdem" | "PLO" | "PLO5"
  smallBlind?: string;
  bigBlind?: string;
  ante?: string;
}

export function parseGameString(input: string | null | undefined): ParsedGame {
  const raw = (input ?? "").trim();
  if (!raw) return {};

  const result: ParsedGame = {};
  const cleaned = raw.replace(/\$/g, ""); // tolerate "$1/$2"

  // Blinds: the first "n/n" (optionally "n/n/n") group. A third number is
  // read as the ante (e.g. "1/2/5").
  const blinds = cleaned.match(
    /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?/
  );
  if (blinds) {
    result.smallBlind = blinds[1];
    result.bigBlind = blinds[2];
    if (blinds[3]) result.ante = blinds[3];
  }

  // An explicit ante ("ante 5", "ante: $5", "$5 ante") wins when present.
  const anteMatch =
    cleaned.match(/ante[:\s]*\$?\s*(\d+(?:\.\d+)?)/i) ||
    cleaned.match(/\$?(\d+(?:\.\d+)?)\s*ante\b/i);
  if (anteMatch) result.ante = anteMatch[1];

  // Game type — check the most specific token first (PLO5 before PLO).
  const lower = raw.toLowerCase();
  if (/plo\s*5|plo5|5\s*card|omaha\s*5|big\s*o/.test(lower)) {
    result.game = "PLO5";
  } else if (/plo|omaha/.test(lower)) {
    result.game = "PLO";
  } else if (/nlhe|nlh|hold\s*'?\s*em|holdem|\bnl\b|\bhe\b/.test(lower)) {
    result.game = "Holdem";
  }

  return result;
}
