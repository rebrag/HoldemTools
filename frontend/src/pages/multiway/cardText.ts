// src/pages/multiway/cardText.ts
//
// Cards as typed: "AsQd", "as qd", "10h 9h", "Ah,Kd". The hole-cards picker
// reads this on every keystroke, so a half-typed trailing rank is not an
// error, only an incomplete token; a token that can never become a card, a
// repeated card, a card another seat already holds, or a third card is.
// Pure, so the check script covers it.
import { CLASS_OF } from "@/lib/sessionSim/cards";
import { idOfCode } from "@/lib/sessionSim/orbits";

const RANKS = "AKQJT98765432";
const SUITS = "shdc";

export interface ParsedCards {
  /** Complete, valid, distinct cards in the app's code form ("As"). */
  cards: string[];
  /** Something typed can never be right: bad rank or suit, a repeat, a card
   *  in `taken`, or more than two cards. */
  error: boolean;
  /** A trailing rank without its suit yet. */
  incomplete: boolean;
  /** The typed card that is in `taken`, when that is what went wrong. */
  conflict: string | null;
}

/** `taken`: cards held elsewhere in the deal, which this text may not use. */
export function parseCardsText(text: string, taken?: ReadonlySet<string>): ParsedCards {
  const compact = text.replace(/[\s,;/]+/g, "").replace(/10/g, "T");
  const cards: string[] = [];
  let error = false;
  let incomplete = false;
  let conflict: string | null = null;
  for (let i = 0; i < compact.length; i += 2) {
    const rank = compact[i].toUpperCase();
    if (!RANKS.includes(rank)) {
      error = true;
      break;
    }
    if (i + 1 >= compact.length) {
      incomplete = true;
      break;
    }
    const suit = compact[i + 1].toLowerCase();
    if (!SUITS.includes(suit)) {
      error = true;
      break;
    }
    const code = rank + suit;
    if (cards.includes(code) || cards.length >= 2) {
      error = true;
      break;
    }
    if (taken?.has(code)) {
      error = true;
      conflict = code;
      break;
    }
    cards.push(code);
  }
  return { cards, error, incomplete, conflict };
}

/** The canonical text for a set of cards, e.g. "AsQd". */
export const formatCardsText = (cards: string[]): string => cards.join("");

/** The engine's 169-class index of a two-card hand (the index CLASS_NAMES,
 *  HAND_ORDER, rollup_169 and team_rollup all share), or -1 unless the
 *  cards are exactly two valid distinct codes. */
export const classIndexOfCards = (cards: readonly string[]): number => {
  if (cards.length !== 2) return -1;
  const a = idOfCode(cards[0]);
  const b = idOfCode(cards[1]);
  return a < 0 || b < 0 || a === b ? -1 : CLASS_OF[a * 52 + b];
};
