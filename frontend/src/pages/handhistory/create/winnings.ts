// src/pages/handhistory/create/winnings.ts
// Per-player winnings for a resolved hand, side pots included. Each pot layer
// (main + sides, from potBreakdown) is awarded on its own: to the best hand
// among that pot's eligible players when every card needed is known, else to
// the recorded overall winners that are eligible for it (falling back to an
// even split among the eligible when none are — a manual winner pick can't
// rank the remaining hands). Shared by the text serializer ("X wins $Y") and
// the next-hand defaults (carrying stacks forward).
import { evalWinners } from "@/lib/handEval";
import { evalGameId, handSize, type AdvancedHandState } from "./types";
import { potBreakdown, type Engine } from "./engine";

// Split a pot into per-winner amounts with cent precision (odd cent goes first).
export function splitAmounts(total: number, n: number): number[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  let rem = cents - base * n;
  return Array.from({ length: n }, () => {
    const extra = rem > 0 ? 1 : 0;
    if (rem > 0) rem--;
    return (base + extra) / 100;
  });
}

/** Total chips each player (index into engine.players) collects from the
 *  resolved hand. Call once the hand is done and winners are recorded. */
export function computeWinnings(
  state: AdvancedHandState,
  e: Engine
): Map<number, number> {
  const winnings = new Map<number, number>();
  const add = (i: number, amt: number) =>
    winnings.set(i, (winnings.get(i) ?? 0) + amt);

  const pots = potBreakdown(e);
  if (!pots.length) return winnings;
  const evalGame = evalGameId(state.game);
  const cardsPerHand = handSize(state.game);
  const fullBoard = (b: (string | null)[]) => b.filter((c): c is string => !!c);

  const boards: { overall: number[] | null; board: string[] }[] =
    e.numBoards === 2
      ? [
          { overall: e.winners, board: fullBoard(state.board) },
          { overall: e.winners2, board: fullBoard(state.board2) },
        ]
      : [{ overall: e.winners, board: fullBoard(state.board) }];

  for (const { overall, board } of boards) {
    for (const pot of pots) {
      const share = pot.amount / boards.length;
      let potWinners: number[] = [];
      if (pot.eligible.length === 1) {
        potWinners = pot.eligible;
      } else {
        // Rank the eligible hands ourselves when every card is known — the
        // overall winner of the hand may not be eligible for a side pot.
        const hands = e.players.map((p, i) =>
          pot.eligible.includes(i)
            ? p.hole.filter((c): c is string => !!c)
            : null
        );
        const canEval =
          evalGame != null &&
          board.length === 5 &&
          pot.eligible.every((i) => hands[i]!.length === cardsPerHand);
        if (canEval) {
          potWinners = evalWinners(evalGame, board, hands);
        } else {
          potWinners = (overall ?? []).filter((i) => pot.eligible.includes(i));
          if (!potWinners.length) potWinners = pot.eligible;
        }
      }
      if (!potWinners.length) continue;
      const amts = splitAmounts(share, potWinners.length);
      potWinners.forEach((wi, k) => add(wi, amts[k]));
    }
  }
  return winnings;
}
