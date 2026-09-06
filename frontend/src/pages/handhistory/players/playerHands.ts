// src/pages/handhistory/players/playerHands.ts
// Which of the user's saved hands show a given player's cards. Used by the
// player editor's "Showdown hands" section. The link between a hand and a
// player is Seat.playerId inside the replay payload, so this is a client-side
// selection over the hand list, not an API query.
import { summaryFromRawText } from "../create/replay";
import type { HandHistory } from "../types";

/**
 * Hands in which `playerId`'s seat has at least one recorded hole card,
 * newest first. This is the same predicate as the hand list's "Showed cards"
 * filter (handFilters.rowMatches), so the editor and the filter agree: a hand
 * that reached showdown but where the player mucked unseen has nothing to
 * show and is left out; a bluff shown after everyone folded is in.
 * summaryFromRawText is LRU-cached, so hands the list already rendered cost
 * nothing here.
 */
export function selectShowdownHands(hands: HandHistory[], playerId: string): HandHistory[] {
  return hands
    .filter((h) =>
      summaryFromRawText(h.rawText)?.seatFacts.some(
        (s) => s.playerId === playerId && s.showedCards
      )
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
