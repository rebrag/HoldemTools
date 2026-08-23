// src/pages/private/describe.ts
// Human-readable descriptions for ranking cutoff hands, main-thread only
// (keeps pokersolver out of the worker bundle). Hold'em wording follows the
// old Python tool's output: "High Card, Ace-high", "One Pair, Sixes",
// "Two Pair, Jacks and Eights", "Three of a Kind, Fours".
import { Hand } from "pokersolver";
import { describeBadugi } from "@/lib/badugi";
import type { RankingsMode } from "./protocol";

const RANK_PLURAL: Record<string, string> = {
  A: "Aces", K: "Kings", Q: "Queens", J: "Jacks", T: "Tens", "9": "Nines",
  "8": "Eights", "7": "Sevens", "6": "Sixes", "5": "Fives", "4": "Fours",
  "3": "Threes", "2": "Twos",
};
const RANK_SINGULAR: Record<string, string> = {
  A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "Ten", "9": "Nine",
  "8": "Eight", "7": "Seven", "6": "Six", "5": "Five", "4": "Four",
  "3": "Three", "2": "Two",
};
// pokersolver category name -> the wording this page uses.
const CATEGORY: Record<string, string> = { Pair: "One Pair" };

export function describeCutoff(mode: RankingsMode, cards: string[]): string {
  if (mode !== "holdem5") return describeBadugi(cards);
  try {
    const solved = Hand.solve(cards);
    const cat = CATEGORY[solved.name] ?? solved.name;
    const comma = solved.descr.indexOf(",");
    let detail = comma >= 0 ? solved.descr.slice(comma + 1).trim() : "";
    if (!detail) {
      // High Card's descr has no comma; it is just e.g. "A High".
      const m = /([2-9TJQKA])[hdcs]?\s+High/.exec(solved.descr);
      if (m) return `${cat}, ${RANK_SINGULAR[m[1]] ?? m[1]}-high`;
      return cat;
    }
    detail = detail.replace(/([2-9TJQKA])'s/g, (_m, r: string) => RANK_PLURAL[r] ?? r);
    detail = detail.replace(
      /\b([2-9TJQKA])[hdcs]?\s+High\b/g,
      (_m, r: string) => `${RANK_SINGULAR[r] ?? r} High`
    );
    detail = detail.replace(/\s*&\s*/g, " and ");
    return `${cat}, ${detail}`;
  } catch {
    return "";
  }
}
