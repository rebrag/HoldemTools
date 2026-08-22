// src/pages/handhistory/players/relinkHands.ts
// Retroactive player linking: scan saved hands' replay payloads for seat names
// that aren't linked to a Players row yet, and rewrite a hand's payload to add
// the link. Pure functions - the wizard UI drives them and PUTs the results.
//
// Names are matched exactly (trimmed): "Seongbum" in two hands is one
// candidate group, but WHICH player each hand belongs to stays the user's
// call - the wizard applies per hand, never by fuzzy matching, because two
// different people can share a first name.
import { encodeReplay, parseReplay, stripReplay } from "../create/replay";
import type { HandHistory } from "../types";

export interface UnlinkedHandRef {
  id: number;
  createdAt: string;
  sessionId: string | null;
  /** This name sits on 2+ eligible seats of the hand - two different people
   *  with the same label at one table can't both be the same player, so the
   *  wizard excludes the hand and says why. */
  conflict: boolean;
}

export interface UnlinkedNameGroup {
  name: string;
  hands: UnlinkedHandRef[]; // newest first
}

// Seats eligible for linking: occupied, custom-named, not the hero (the hero
// is the account owner, not an opponent), and not already linked.
function eligibleSeatIndexes(
  data: NonNullable<ReturnType<typeof parseReplay>>,
  name: string
): number[] {
  return data.state.seats
    .map((s, i) => ({ s, i }))
    .filter(
      ({ s, i }) =>
        s.occupied &&
        !s.playerId &&
        i !== data.state.heroSeat &&
        s.name.trim() === name
    )
    .map(({ i }) => i);
}

/** Group every unlinked, non-hero seat name across the given hands. Hands
 *  without a replay payload can't be linked and are counted separately. */
export function scanUnlinkedNames(hands: HandHistory[]): {
  groups: UnlinkedNameGroup[];
  unscannable: number;
} {
  const byName = new Map<string, UnlinkedHandRef[]>();
  let unscannable = 0;

  for (const hand of hands) {
    const data = parseReplay(hand.rawText);
    if (!data) {
      unscannable++;
      continue;
    }
    const names = new Set(
      data.state.seats
        .filter((s, i) => s.occupied && !s.playerId && i !== data.state.heroSeat)
        .map((s) => s.name.trim())
        .filter(Boolean)
    );
    for (const name of names) {
      const seatIdxs = eligibleSeatIndexes(data, name);
      const refs = byName.get(name) ?? [];
      refs.push({
        id: hand.id,
        createdAt: hand.createdAt,
        sessionId: hand.sessionId,
        conflict: seatIdxs.length > 1,
      });
      byName.set(name, refs);
    }
  }

  const groups = [...byName.entries()]
    .map(([name, refs]) => ({
      name,
      hands: refs.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    }))
    // Most hands first: frequent regulars are the names worth linking most.
    .sort((a, b) => b.hands.length - a.hands.length || a.name.localeCompare(b.name));

  return { groups, unscannable };
}

/** Rewrite one hand's rawText so the single eligible seat named `name` links
 *  to `playerId`. The human-readable text is untouched - only the embedded
 *  payload is re-encoded. Returns null when the hand has no payload, no
 *  eligible seat with that name, or a same-name conflict (2+ seats). */
export function linkPlayerInRawText(
  rawText: string,
  name: string,
  playerId: string
): string | null {
  const data = parseReplay(rawText);
  if (!data) return null;
  const seatIdxs = eligibleSeatIndexes(data, name);
  if (seatIdxs.length !== 1) return null;

  const seats = data.state.seats.map((s, i) =>
    i === seatIdxs[0] ? { ...s, playerId } : s
  );
  const updated = { ...data, state: { ...data.state, seats } };
  // Rebuild exactly the shape the recorder saves: clean text + one marker.
  return stripReplay(rawText) + encodeReplay(updated);
}
