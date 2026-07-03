// src/pages/handhistory/create/serialize.ts
// Renders a recorded hand (state + engine) as a compact, tracker-style text
// history: position-labelled seats, one comma-separated line of action per
// street, showdown hand descriptions, and optional per-street equity.
import { Hand } from "pokersolver";
import type { AdvancedHandState } from "./types";
import { fmtChips, type Engine, type EngineAction } from "./engine";
import { bestOmahaCards, type EvalGame } from "@/lib/handEval";

// Per engine-player-index equity snapshots (percent) at each street.
export interface StreetEquity {
  pre?: number;
  flop?: number;
  turn?: number;
}
export interface EquityInfo {
  byPlayer: Record<number, StreetEquity>;
}

const STREETS = ["Pre Flop", "Flop", "Turn", "River"];

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
// pokersolver category name → the wording this format uses.
const CATEGORY: Record<string, string> = { Pair: "One Pair" };

function money(chips: number): string {
  return `$${fmtChips(chips)}`;
}

function cardList(cs: (string | null)[]): string {
  return cs.filter((c): c is string => !!c).join(" ");
}

function evalGameOf(game: string): EvalGame {
  if (game === "PLO") return "omaha4";
  if (game === "PLO5") return "omaha5";
  return "texas-holdem";
}

function gameName(game: string): string {
  if (game === "PLO") return "Omaha";
  if (game === "PLO5") return "Omaha5";
  if (game === "Holdem") return "Holdem";
  return game;
}

// "UTG1" → "UTG+1" to match the conventional written form.
function displayPos(pos: string): string {
  return pos.replace(/^(UTG|MP|LJ|HJ)(\d)$/, "$1+$2");
}

// Best-hand description on a complete board, e.g. "One Pair, Jacks".
function describeHand(game: string, board: string[], hole: string[]): string {
  try {
    const eg = evalGameOf(game);
    const five = eg === "texas-holdem" ? [...hole, ...board] : bestOmahaCards(board, hole);
    if (five.length < 5) return "";
    const solved = Hand.solve(five);
    const cat = CATEGORY[solved.name] ?? solved.name;
    const comma = solved.descr.indexOf(",");
    let detail = comma >= 0 ? solved.descr.slice(comma + 1).trim() : "";
    detail = detail.replace(/([2-9TJQKA])'s/g, (_m, r) => RANK_PLURAL[r] ?? r);
    detail = detail.replace(/\b([2-9TJQKA])[hdcs]?\s+High\b/g, (_m, r) => `${RANK_SINGULAR[r] ?? r} High`);
    return detail ? `${cat}, ${detail}` : cat;
  } catch {
    return "";
  }
}

// Split a pot into per-winner amounts with cent precision (odd chip goes first).
function splitAmounts(total: number, n: number): number[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  let rem = cents - base * n;
  return Array.from({ length: n }, () => {
    const extra = rem > 0 ? 1 : 0;
    if (rem > 0) rem--;
    return (base + extra) / 100;
  });
}

export function serializeHand(
  state: AdvancedHandState,
  e: Engine,
  equity?: EquityInfo,
  opts?: { location?: string | null }
): string {
  const lines: string[] = [];
  const isHero = (i: number) => e.heroIndex === i;
  // A seat has a real name when it differs from its position label (the engine
  // falls back to the position when no name was typed). Names take priority over
  // positions everywhere; the position is only a fallback for unnamed seats.
  const custom = (i: number) => e.players[i].name !== e.players[i].pos;
  const nameOf = (i: number) => (custom(i) ? e.players[i].name : displayPos(e.players[i].pos));
  const seatLabel = (i: number) =>
    isHero(i)
      ? custom(i)
        ? `${e.players[i].name} (Hero)`
        : "Hero"
      : nameOf(i);
  const actLabel = (i: number) =>
    isHero(i) ? (custom(i) ? e.players[i].name : "Hero") : nameOf(i);

  const actionText = (a: EngineAction): string => {
    const lab = actLabel(a.player);
    const tail = a.allIn ? " (all-in)" : "";
    switch (a.kind) {
      case "fold":
        return `${lab} folds`;
      case "check":
        return `${lab} checks`;
      case "call":
        return `${lab} calls ${money(a.amount)}${tail}`;
      case "bet":
        return `${lab} bets ${money(a.amount)}${tail}`;
      case "raise":
        return `${lab} raises to ${money(a.amount)}${tail}`;
    }
  };

  const limit = state.game === "Holdem" ? "NL" : "PL";

  // Header. Use the session's location when available (e.g. from the bankroll
  // session that spawned this hand); fall back to the generic site name.
  const site = opts?.location?.trim() || "Yatahay Network";
  lines.push(
    `${site} - ${money(e.bb)} ${limit} - ${gameName(state.game)} - ${e.players.length} players`
  );
  lines.push("Hand converted by HoldemTools: http://www.holdemtools.com/");
  if (state.numBoards === 2) lines.push("(Double board)");
  lines.push("");

  // Seats (seat order)
  e.players.forEach((p, i) => lines.push(`${seatLabel(i)}: ${money(p.startingStack)}`));
  lines.push("");

  // Blinds / ante / straddle
  const sbIdx = e.players.findIndex((p) => p.pos === "SB");
  const btnIdx = e.players.findIndex((p) => p.pos === "BTN");
  const effSbIdx = sbIdx >= 0 ? sbIdx : btnIdx; // heads-up: button posts the SB
  const bbIdx = e.players.findIndex((p) => p.pos === "BB");
  const posts: string[] = [];
  if (effSbIdx >= 0) posts.push(`${actLabel(effSbIdx)} posts SB ${money(e.sb)}`);
  if (bbIdx >= 0) posts.push(`${actLabel(bbIdx)} posts BB ${money(e.bb)}`);
  if (e.straddleIndex != null) {
    posts.push(`${actLabel(e.straddleIndex)} posts straddle ${money(e.straddle)}`);
  }
  let blindLine = posts.join(", ");
  if (e.ante > 0) blindLine = `Ante ${money(e.ante)} total${blindLine ? `, ${blindLine}` : ""}`;
  if (blindLine) {
    lines.push(blindLine);
    lines.push("");
  }

  // Preflop
  const preflopPot = e.ante + e.sb + e.bb + e.straddle;
  let preHeader = `Pre Flop: (pot: ${money(preflopPot)})`;
  if (e.heroIndex != null) {
    const hero = e.players[e.heroIndex];
    const hc = cardList(hero.hole);
    if (hc) preHeader += ` Hero has ${hc}`;
  }
  lines.push(preHeader);
  if (e.streetActions[0].length) {
    lines.push(e.streetActions[0].map(actionText).join(", "));
  }

  // Postflop streets
  const revealFor = (board: (string | null)[], s: number): string => {
    if (s === 1) return cardList(board.slice(0, 3));
    if (s === 2) return cardList(board.slice(3, 4));
    return cardList(board.slice(4, 5));
  };
  for (let s = 1; s <= e.reached; s++) {
    const meta = e.streetMeta[s];
    lines.push("");
    const boardStr =
      state.numBoards === 2
        ? `${revealFor(state.board, s)}  |  ${revealFor(state.board2, s)}`
        : revealFor(state.board, s);
    lines.push(`${STREETS[s]} : (${money(meta.potStart)}, ${meta.players} players) ${boardStr}`);
    if (e.streetActions[s].length) {
      lines.push(e.streetActions[s].map(actionText).join(", "));
    }
  }

  // Showdown
  const board1 = state.board.filter((c): c is string => !!c);
  const live = e.players.map((p, i) => ({ p, i })).filter((x) => !x.p.folded);
  if (live.length >= 2) {
    for (const { p, i } of live) {
      const hc = p.hole.filter((c): c is string => !!c);
      if (!hc.length) continue;
      lines.push("");
      const desc = board1.length === 5 ? describeHand(state.game, board1, hc) : "";
      lines.push(`${actLabel(i)} shows ${cardList(hc)}${desc ? ` (${desc})` : ""}`);
      const eq = equity?.byPlayer[i];
      if (eq) {
        const parts: string[] = [];
        if (eq.pre != null) parts.push(`Pre ${Math.round(eq.pre)}%`);
        if (eq.flop != null) parts.push(`Flop ${Math.round(eq.flop)}%`);
        if (eq.turn != null) parts.push(`Turn ${Math.round(eq.turn)}%`);
        if (parts.length) lines.push(` (${parts.join(", ")})`);
      }
    }
  }

  // Winnings
  const potShare = e.numBoards === 2 ? e.pot / 2 : e.pot;
  const winnings = new Map<number, number>();
  const award = (winners: number[] | null) => {
    if (!winners || !winners.length) return;
    const amts = splitAmounts(potShare, winners.length);
    winners.forEach((wi, k) => winnings.set(wi, (winnings.get(wi) ?? 0) + amts[k]));
  };
  award(e.winners);
  if (e.numBoards === 2) award(e.winners2);

  if (winnings.size) {
    lines.push("");
    e.players.forEach((_p, i) => {
      const won = winnings.get(i);
      if (won) lines.push(`${actLabel(i)} wins ${money(won)}`);
    });
  }

  if (state.comment.trim()) {
    lines.push("");
    lines.push(state.comment.trim());
  }

  return lines.join("\n");
}
