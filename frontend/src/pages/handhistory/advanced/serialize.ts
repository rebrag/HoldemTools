// src/pages/handhistory/advanced/serialize.ts
// Turns the recorded hand (state + engine) into a plain-text hand history in
// literal chip amounts, matching the "*** STREET ***" hand-history format.
import type { AdvancedHandState } from "./types";
import { fmtChips, STREET_NAMES, type Engine, type EnginePlayer } from "./engine";

const SUMMARY_STREET_NAMES = ["Pre-Flop", "Flop", "Turn", "River"];

function posSuffix(p: EnginePlayer): string {
  if (p.pos === "BTN") return " (button)";
  if (p.pos === "SB") return " (small blind)";
  if (p.pos === "BB") return " (big blind)";
  return "";
}

function cards(cs: (string | null)[]): string {
  return cs.map((c) => c ?? "?").join(" ");
}

function boardBracket(board: (string | null)[], upToStreet: number): string {
  // Flop: [a b c]  Turn: [a b c] [d]  River: [a b c d] [e]
  if (upToStreet === 1) return `[${cards(board.slice(0, 3))}]`;
  if (upToStreet === 2) return `[${cards(board.slice(0, 3))}] [${cards(board.slice(3, 4))}]`;
  return `[${cards(board.slice(0, 4))}] [${cards(board.slice(4, 5))}]`;
}

function forcedContribution(p: EnginePlayer, e: Engine): number {
  let forced = e.ante > 0 ? e.ante : 0;
  if (p.pos === "SB" || (p.pos === "BTN" && e.players.every((pl) => pl.pos !== "SB")))
    forced += e.sb;
  if (p.pos === "BB") forced += e.bb;
  if (e.straddleIndex != null && e.players[e.straddleIndex] === p) forced += e.straddle;
  return forced;
}

function showdownBlock(
  lines: string[],
  e: Engine,
  board: (string | null)[],
  winners: number[] | null,
  potShare: number,
  suffix: string
) {
  for (let s = 1; s <= e.reached; s++) {
    const meta = e.streetMeta[s];
    lines.push("");
    lines.push(`*** ${STREET_NAMES[s].toUpperCase()}${suffix} *** ${boardBracket(board, s)}`);
    lines.push(`Main pot ${fmtChips(meta.potStart)}`);
    if (e.streetTokens[s].length) {
      lines.push(...e.streetTokens[s]);
    }
  }

  const live = e.players.filter((p) => !p.folded);
  if (live.length >= 2) {
    lines.push("");
    lines.push(`*** SHOW DOWN${suffix} ***`);
    lines.push(`Main pot ${fmtChips(potShare)}`);
    for (const p of live) {
      const hc = p.hole.filter((c): c is string => !!c);
      if (hc.length) lines.push(`${p.name} shows [${cards(hc)}]`);
    }
    if (winners && winners.length) {
      const share = potShare / winners.length;
      for (const wi of winners) {
        lines.push(`${e.players[wi].name} collected ${fmtChips(share)} from main pot`);
      }
    }
  } else if (winners && winners.length) {
    lines.push("");
    lines.push(`${e.players[winners[0]].name} collected ${fmtChips(potShare)} from main pot`);
  }
}

export function serializeHand(state: AdvancedHandState, e: Engine): string {
  const lines: string[] = [];

  // Header
  const anteStr = e.ante > 0 ? ` (ante ${fmtChips(e.ante)})` : "";
  lines.push(
    `HoldemTools Hand - ${state.game} (No Limit) - Blinds ${fmtChips(e.sb)}/${fmtChips(
      e.bb
    )}${anteStr} (${state.tableSize}-max)`
  );
  lines.push(`Seat #${state.buttonSeat + 1} is the button`);

  // Seats
  for (const p of e.players) {
    lines.push(`Seat ${p.seat + 1}: ${p.name} (${fmtChips(p.startingStack)})`);
  }

  // Antes + blinds + straddle
  if (e.ante > 0) {
    for (const p of e.players) {
      lines.push(`${p.name} posts ante ${fmtChips(e.ante)}`);
    }
  }
  const sbP = e.players.find((p) => p.pos === "SB") ?? e.players.find((p) => p.pos === "BTN");
  const bbP = e.players.find((p) => p.pos === "BB");
  if (sbP) lines.push(`${sbP.name} posts the small blind ${fmtChips(e.sb)}`);
  if (bbP) lines.push(`${bbP.name} posts the big blind ${fmtChips(e.bb)}`);
  if (e.straddleIndex != null) {
    lines.push(`${e.players[e.straddleIndex].name} posts the straddle ${fmtChips(e.straddle)}`);
  }

  // Hole cards
  lines.push("*** HOLE CARDS ***");
  const preflopPot = e.ante * e.players.length + e.sb + e.bb + e.straddle;
  lines.push(`Main pot ${fmtChips(preflopPot)}`);
  if (e.heroIndex != null) {
    const hero = e.players[e.heroIndex];
    const hc = hero.hole.filter((c): c is string => !!c);
    if (hc.length) lines.push(`Dealt to ${hero.name} [${cards(hc)}]`);
  }
  if (e.streetTokens[0].length) lines.push(...e.streetTokens[0]);

  // Postflop + showdown, once per board.
  const potShare = e.numBoards === 2 ? e.pot / 2 : e.pot;
  showdownBlock(lines, e, state.board, e.winners, potShare, e.numBoards === 2 ? " (Board 1)" : "");
  if (e.numBoards === 2) {
    showdownBlock(lines, e, state.board2, e.winners2, potShare, " (Board 2)");
  }

  // Summary
  lines.push("");
  lines.push("*** SUMMARY ***");
  lines.push(`Total pot ${fmtChips(e.pot)}`);
  if (e.numBoards === 1 && e.reached > 0) {
    const revealed = e.reached >= 3 ? 5 : e.reached >= 2 ? 4 : 3;
    lines.push(`Board [${cards(state.board.slice(0, revealed))}]`);
  } else if (e.numBoards === 2 && e.reached > 0) {
    const revealed = e.reached >= 3 ? 5 : e.reached >= 2 ? 4 : 3;
    lines.push(`Board 1 [${cards(state.board.slice(0, revealed))}]`);
    lines.push(`Board 2 [${cards(state.board2.slice(0, revealed))}]`);
  }

  const winnings = new Map<number, number>();
  const addWin = (winners: number[] | null, share: number) => {
    if (!winners || !winners.length) return;
    const each = share / winners.length;
    for (const wi of winners) winnings.set(wi, (winnings.get(wi) ?? 0) + each);
  };
  addWin(e.winners, potShare);
  if (e.numBoards === 2) addWin(e.winners2, potShare);

  for (const p of e.players) {
    const idx = e.players.indexOf(p);
    const won = winnings.get(idx);
    if (won) {
      const hc = p.hole.filter((c): c is string => !!c);
      const shown = hc.length ? `showed [${cards(hc)}] and ` : "";
      lines.push(`Seat ${p.seat + 1}: ${p.name}${posSuffix(p)} ${shown}won ${fmtChips(won)}`);
    } else if (p.folded) {
      const street = SUMMARY_STREET_NAMES[p.foldedStreet ?? 0];
      const voluntary = p.totalCommitted - forcedContribution(p, e);
      const betNote = voluntary > 1e-9 ? "" : " and did not bet";
      lines.push(`Seat ${p.seat + 1}: ${p.name}${posSuffix(p)} folded on the ${street}${betNote}`);
    } else {
      const hc = p.hole.filter((c): c is string => !!c);
      const shown = hc.length ? `showed [${cards(hc)}] and ` : "";
      lines.push(`Seat ${p.seat + 1}: ${p.name}${posSuffix(p)} ${shown}lost`);
    }
  }

  if (state.comment.trim()) {
    lines.push("");
    lines.push(state.comment.trim());
  }

  return lines.join("\n");
}
