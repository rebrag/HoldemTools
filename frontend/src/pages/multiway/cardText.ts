// src/pages/multiway/cardText.ts
//
// Cards as typed: "AsQd", "as qd", "10h 9h", "Ah,Kd". The hole-cards picker
// reads this on every keystroke, so a half-typed trailing rank is not an
// error, only an incomplete token; a token that can never become a card, a
// repeated card, a card another seat already holds, or a third card is.
// Rank-only text ("AQ", "66", "AQs") names a hand without its suits; see
// the holdings below. Pure, so the check script covers it.
import { CLASS_OF, classIndexOfName } from "@/lib/sessionSim/cards";
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

/* ---------- holdings: exact cards, or only the ranks ---------- */

/** What one seat is known to hold. Exact cards (zero to two codes), or only
 *  the ranks: a hand class ("66", "AQs", "AQo") or a rank pair spanning both
 *  of its classes ("AQ"). A rank holding reserves no cards; everything that
 *  reads it averages over its combos. */
export type Holding =
  | { kind: "cards"; cards: string[] }
  | { kind: "ranks"; hand: string };

/** The one empty holding every seat without cards shares, so props keep
 *  their identity across renders. */
export const EMPTY_HOLDING: Holding = { kind: "cards", cards: [] };

/** The deal: each seat's holding, keyed by seat index. */
export type HeldCards = Record<number, Holding>;

export const holdingOfCards = (cards: string[]): Holding =>
  cards.length === 0 ? EMPTY_HOLDING : { kind: "cards", cards };

/** The exact cards in a holding; none for a rank holding. */
export const cardsOfHolding = (h: Holding): string[] => (h.kind === "cards" ? h.cards : []);

export const isEmptyHolding = (h: Holding): boolean => h.kind === "cards" && h.cards.length === 0;

/** Enough to name a hand: two exact cards, or any rank holding. */
export const isCompleteHolding = (h: Holding): boolean =>
  h.kind === "ranks" || h.cards.length === 2;

/** The canonical text: "AsQd", "AQ", "AQs", "66". */
export const formatHolding = (h: Holding): string =>
  h.kind === "cards" ? formatCardsText(h.cards) : h.hand;

/** The 169-class indices a holding can be: one for two exact cards, a pair
 *  or a suited / offsuit class, both for a bare rank pair like "AQ". */
export const classesOfHolding = (h: Holding): number[] => {
  if (h.kind === "cards") {
    const cls = classIndexOfCards(h.cards);
    return cls >= 0 ? [cls] : [];
  }
  if (h.hand.length === 3 || h.hand[0] === h.hand[1]) {
    const cls = classIndexOfName(h.hand);
    return cls >= 0 ? [cls] : [];
  }
  return [classIndexOfName(`${h.hand}s`), classIndexOfName(`${h.hand}o`)];
};

export interface ParsedHolding {
  holding: Holding;
  /** As ParsedCards; rank text errs on a bad rank, a suffix other than s/o,
   *  a suffix on a pair, or anything after the suffix. */
  error: boolean;
  incomplete: boolean;
  conflict: string | null;
}

/** Cards or ranks as typed. The two forms cannot be confused: a card has
 *  its suit in the second character, a rank holding has a rank there, so
 *  "As" / "AsQd" read exactly as `parseCardsText` reads them, and "AQ",
 *  "aq", "QA", "AQs", "66" are rank holdings (high rank first). */
export function parseHoldingText(text: string, taken?: ReadonlySet<string>): ParsedHolding {
  const compact = text.replace(/[\s,;/]+/g, "").replace(/10/g, "T");
  const second = compact[1]?.toUpperCase();
  if (second == null || !RANKS.includes(second)) {
    const { cards, error, incomplete, conflict } = parseCardsText(text, taken);
    return { holding: holdingOfCards(cards), error, incomplete, conflict };
  }
  const bad = { holding: EMPTY_HOLDING, error: true, incomplete: false, conflict: null };
  const a = compact[0].toUpperCase();
  if (!RANKS.includes(a) || compact.length > 3) return bad;
  const [hi, lo] = RANKS.indexOf(a) <= RANKS.indexOf(second) ? [a, second] : [second, a];
  const suffix = compact[2]?.toLowerCase() ?? "";
  if (suffix !== "" && (hi === lo || (suffix !== "s" && suffix !== "o"))) return bad;
  return {
    holding: { kind: "ranks", hand: hi + lo + suffix },
    error: false,
    incomplete: false,
    conflict: null,
  };
}
