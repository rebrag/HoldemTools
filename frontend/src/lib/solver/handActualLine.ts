// src/lib/solver/handActualLine.ts
// What actually happened in the recorded hand behind a solved board, in the
// terms the solutions viewer speaks: the postflop actions in order, and the
// turn/river that actually came.
//
// The viewer's job is to show what the solver would do; this is the other
// half of the study loop - what the player did, and what the deck did. Both
// are already in the hand's embedded replay payload, so nothing new has to be
// stored alongside the solve.
//
// Amounts stay in the hand's own money, which is exactly the money the solve
// displays (see formatPioAction's chip_scale note), so an action matches a
// solver label by comparing numbers rather than strings - the label text
// rounds for display and would not survive an equality check.
import { buildEngine, applyAction } from "@/pages/handhistory/create/engine";
import { parseReplay } from "@/pages/handhistory/create/replay";

export type ActualAction = {
  kind: "fold" | "check" | "call" | "bet" | "raise";
  /** Total street commitment for bet/raise, in the hand's money. */
  amount: number | null;
  allIn: boolean;
};

export type ActualHandLine = {
  /** Postflop actions in dealt order: flop, then turn, then river. */
  actions: ActualAction[];
  /** Cards that actually came, or null when the hand ended first. */
  turn: string | null;
  river: string | null;
};

/** Replay the hand and read off its postflop actions and runout. */
export function buildActualHandLine(rawText: string): ActualHandLine | null {
  const data = parseReplay(rawText);
  if (!data) return null;

  let e = buildEngine(data.state);
  for (const a of data.actions) e = applyAction(e, a.kind, a.to);

  const actions: ActualAction[] = [];
  for (let street = 1; street <= 3; street += 1) {
    for (const a of e.streetActions[street] ?? []) {
      actions.push({
        kind: a.kind,
        amount: a.kind === "bet" || a.kind === "raise" ? a.amount : null,
        allIn: a.allIn,
      });
    }
  }

  const board = data.state.board;
  return {
    actions,
    turn: e.reached >= 2 ? board[3] ?? null : null,
    river: e.reached >= 3 ? board[4] ?? null : null,
  };
}

/** Numeric amount inside a solver display label ("Bet 135", "Raise to 2.5"). */
function labelAmount(display: string): number | null {
  const m = display.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Does this solver action label correspond to the action actually taken?
 *
 * ALLIN is its own label rather than a size, so an all-in bet matches it
 * directly. Sized bets compare numerically with a cent of tolerance, since
 * the label is a rounded rendering of the same underlying chips.
 */
export function labelMatchesActual(display: string, actual: ActualAction): boolean {
  const label = display.trim();
  if (actual.kind === "fold") return label === "Fold";
  if (actual.kind === "check") return label === "Check";
  if (actual.kind === "call") return label === "Call" || label === "ALLIN";

  if (label === "ALLIN") return actual.allIn;
  if (!/^(Bet|Raise to)\b/i.test(label)) return false;
  const amount = labelAmount(label);
  return amount != null && actual.amount != null && Math.abs(amount - actual.amount) < 0.01;
}
