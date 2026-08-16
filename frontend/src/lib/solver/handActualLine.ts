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
 * The option label the actual action corresponds to, or null when none does.
 *
 * ALLIN is its own label rather than a size, so an all-in bet matches it
 * directly. Sized bets pick the CLOSEST candidate, capped at 20% relative
 * error: the tree's sizes are whole-percent-of-pot discretizations of the
 * real amounts ($20 becomes "Bet 20.1", $200 "Bet 199.3"), so exact
 * comparison never fires, while the cap keeps a genuinely different size
 * from being claimed as played.
 */
export function matchPlayedOption(
  options: string[],
  actual: ActualAction
): string | null {
  const labels = options.map((o) => o.trim());
  if (actual.kind === "fold") return labels.includes("Fold") ? "Fold" : null;
  if (actual.kind === "check") return labels.includes("Check") ? "Check" : null;
  if (actual.kind === "call") {
    // A tree call is always the "Call" branch; "ALLIN" is an aggressive
    // action, matched only as a fallback when a shove was called and the
    // node has no plain Call label.
    if (labels.includes("Call")) return "Call";
    return actual.allIn && labels.includes("ALLIN") ? "ALLIN" : null;
  }

  // bet / raise
  if (actual.allIn && labels.includes("ALLIN")) return "ALLIN";
  if (actual.amount == null) return null;
  let best: { label: string; diff: number } | null = null;
  for (const label of labels) {
    if (!/^(Bet|Raise to)\b/i.test(label)) continue;
    const amount = labelAmount(label);
    if (amount == null) continue;
    const diff = Math.abs(amount - actual.amount);
    if (!best || diff < best.diff) best = { label, diff };
  }
  if (!best) return null;
  return best.diff <= Math.max(actual.amount * 0.2, 0.01) ? best.label : null;
}
