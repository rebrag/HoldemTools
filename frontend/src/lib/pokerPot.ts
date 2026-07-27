// src/lib/pokerPot.ts
// Shared pot-display rule, used by the hand-history engine and the solver.

/**
 * Chips that count as "in the pot" for display purposes: everything wagered
 * so far minus the current street's live bets, which still sit in front of
 * the players. Bets only join the pot once the street they were wagered on
 * completes; showing them in both places would double-count.
 */
export function displayedPot(
  totalWagered: number,
  liveBets: Iterable<number>
): number {
  let live = 0;
  for (const b of liveBets) live += b;
  return Math.max(0, totalWagered - live);
}
