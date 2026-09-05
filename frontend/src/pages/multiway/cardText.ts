// src/pages/multiway/cardText.ts
//
// Cards as typed: "AsQd", "as qd", "10h 9h", "Ah,Kd". The partner-hand
// picker reads this on every keystroke, so a half-typed trailing rank is not
// an error, only an incomplete token; a token that can never become a card,
// a repeated card, or a third card is. Pure, so the check script covers it.

const RANKS = "AKQJT98765432";
const SUITS = "shdc";

export interface ParsedCards {
  /** Complete, valid, distinct cards in the app's code form ("As"). */
  cards: string[];
  /** Something typed can never be right: bad rank or suit, a repeat, or more
   *  than two cards. */
  error: boolean;
  /** A trailing rank without its suit yet. */
  incomplete: boolean;
}

export function parseCardsText(text: string): ParsedCards {
  const compact = text.replace(/[\s,;/]+/g, "").replace(/10/g, "T");
  const cards: string[] = [];
  let error = false;
  let incomplete = false;
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
    cards.push(code);
  }
  return { cards, error, incomplete };
}

/** The canonical text for a set of cards, e.g. "AsQd". */
export const formatCardsText = (cards: string[]): string => cards.join("");
