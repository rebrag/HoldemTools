// Pure helpers for postflop node ids and doc conversion.
// Node ids are Pio colon paths ("r:0:c:b175"); blob suffixes use dots.
import type { JsonData } from "@/lib/solver/utils";
import type { PioSolutionDoc } from "@/lib/solver/postflopClient";

export const toSuffix = (nodeId: string): string => nodeId.replace(/:/g, ".");
export const toColon = (suffix: string): string => suffix.replace(/\./g, ":");

export const isCardSegment = (seg: string): boolean => /^[2-9TJQKA][hdcs]$/.test(seg);

export function parentOf(nodeId: string): string | null {
  if (nodeId === "r:0" || !nodeId.includes(":")) return null;
  return nodeId.split(":").slice(0, -1).join(":");
}

/** Segments after the last dealt card (or after "r:0") = the current street's actions. */
export function streetActionsOf(nodeId: string): string[] {
  const segs = nodeId.split(":").slice(2); // drop "r","0"
  let lastCard = -1;
  segs.forEach((s, i) => {
    if (isCardSegment(s)) lastCard = i;
  });
  return segs.slice(lastCard + 1);
}

/** Does the actor at `nodeId` face a bet on the current street? */
export function facingBet(nodeId: string): boolean {
  return streetActionsOf(nodeId).some((s) => s.startsWith("b"));
}

/**
 * Chips each player has committed on COMPLETED postflop streets along this
 * node's path. Pio bet labels are street-cumulative "commit to NNN" amounts,
 * and a street only completes matched (call or check-through), so the last
 * bet of each finished street is what both players put in.
 */
export function priorStreetCommitChips(nodeId: string): number {
  const segs = nodeId.split(":").slice(2); // drop "r","0"
  let total = 0;
  let lastBetThisStreet = 0;
  for (const seg of segs) {
    if (isCardSegment(seg)) {
      total += lastBetThisStreet; // street completed by the deal
      lastBetThisStreet = 0;
    } else {
      const m = seg.match(/^b(\d+)$/);
      if (m) lastBetThisStreet = Number(m[1]);
    }
  }
  return total; // the in-progress street is not included
}

/**
 * Chips each player has in front of them on the CURRENT (unfinished) street.
 * Heads-up postflop the actor alternates strictly, OOP first on every street,
 * and Pio bet labels are street-cumulative "commit to NNN" amounts - so
 * replaying the street's segments gives each side's live bet.
 */
export function currentStreetCommitChips(nodeId: string): {
  oop: number;
  ip: number;
} {
  const commit = { oop: 0, ip: 0 };
  let toCall = 0;
  streetActionsOf(nodeId).forEach((seg, i) => {
    const who = i % 2 === 0 ? "oop" : "ip";
    const bet = seg.match(/^b(\d+)$/);
    if (bet) {
      commit[who] = Number(bet[1]);
      toCall = commit[who];
    } else if (seg === "c") {
      commit[who] = toCall; // a call matches the outstanding bet; a check is 0
    }
  });
  return commit;
}

/**
 * How the money at a node sits on the table: chips already pooled in the
 * middle, and each side's live bet in front of them.
 *
 * Derived from the node path rather than Pio's `pot` triple, which reports
 * each player's chips as a running total for the whole postflop tree - taking
 * it at face value leaves a called flop bet parked in front of both seats for
 * the rest of the hand instead of in the pot.
 *
 * `streetComplete` (a chance node waiting on a turn/river card) sweeps the
 * street's matched bets into the middle, the way a dealer would before dealing.
 */
export function potSplitChips(
  nodeId: string,
  startingPotChips: number,
  streetComplete = false
): { potChips: number; oopChips: number; ipChips: number } {
  // Completed streets are matched by definition, so both players put in the
  // same amount: count it twice.
  const pooled = startingPotChips + 2 * priorStreetCommitChips(nodeId);
  const live = currentStreetCommitChips(nodeId);
  if (streetComplete) {
    return { potChips: pooled + live.oop + live.ip, oopChips: 0, ipChips: 0 };
  }
  return { potChips: pooled, oopChips: live.oop, ipChips: live.ip };
}

/**
 * Chips each remaining player put in preflop.
 *
 * The preflop street always ends with a call, so both players who see the flop
 * committed the same amount, and Pio's effective stack is the shallower seat's
 * chips behind at flop start - which pins that amount exactly. Boards solved
 * before `effective_stack_chips` was recorded return 0, so their seats read as
 * their full starting stack rather than a wrong number.
 */
export function preflopCommitChips(
  stacksMapBB: Record<string, number> | undefined,
  seats: string[],
  effectiveStackChips?: number | null
): number {
  if (!stacksMapBB || effectiveStackChips == null || effectiveStackChips <= 0) return 0;
  const stacks = seats
    .map((seat) => stacksMapBB[seat])
    .filter((bb): bb is number => bb != null);
  if (stacks.length === 0) return 0;
  return Math.max(0, Math.round(Math.min(...stacks) * 100) - effectiveStackChips);
}

/**
 * Chips a seat has already pushed into the middle at `nodeId`: their preflop
 * money plus every postflop bet that is no longer sitting in front of them.
 * A seat's remaining stack is `startingStack - this - liveBet`, so chips keep
 * leaving the stack when a bet gets called and joins the pot.
 *
 * `streetComplete` (a chance node waiting on a turn/river card) counts the
 * street's matched bets as pooled, matching potSplitChips' sweep.
 */
export function pooledCommitChips(
  nodeId: string,
  role: "oop" | "ip",
  preflopCommit: number,
  streetComplete = false
): number {
  const live = currentStreetCommitChips(nodeId)[role];
  return preflopCommit + priorStreetCommitChips(nodeId) + (streetComplete ? live : 0);
}

/**
 * Chips a seat still has behind at `nodeId`: their starting stack less the
 * preflop money, every matched postflop street, and their live bet.
 */
export function stackBehindChips(
  nodeId: string,
  role: "oop" | "ip",
  startingStackChips: number,
  preflopCommit: number
): number {
  return (
    startingStackChips -
    preflopCommit -
    priorStreetCommitChips(nodeId) -
    currentStreetCommitChips(nodeId)[role]
  );
}

/**
 * Human label for a raw pio action at a given node.
 * "c" -> Check | Call, "f" -> Fold, "bNNN" -> Bet X bb | Raise to X bb.
 * With `effectiveStackChips` (manifest.effective_stack_chips), a bet that
 * commits a player's whole remaining stack is labeled ALLIN - matching the
 * preflop label and color.
 */
export function formatPioAction(
  pioLabel: string,
  nodeId: string,
  effectiveStackChips?: number | null
): string {
  if (pioLabel === "f") return "Fold";
  if (pioLabel === "c" || pioLabel === "x" || pioLabel === "check") {
    return facingBet(nodeId) ? "Call" : "Check";
  }
  const m = pioLabel.match(/^b(\d+)$/);
  if (m) {
    const chips = Number(m[1]);
    if (effectiveStackChips != null && effectiveStackChips > 0) {
      const remaining = effectiveStackChips - priorStreetCommitChips(nodeId);
      // 1-chip tolerance: a bet leaving 0.01bb behind is all-in for display.
      if (remaining > 0 && chips >= remaining - 1) return "ALLIN";
    }
    const bb = chips / 100;
    const amount = Number.isInteger(bb) ? String(bb) : bb.toFixed(1);
    return facingBet(nodeId) ? `Raise to ${amount}bb` : `Bet ${amount}bb`;
  }
  return pioLabel;
}

/** Map each raw pio action of a node's doc to its display label (order preserved). */
export function displayActionMap(
  doc: PioSolutionDoc,
  nodeId: string,
  effectiveStackChips?: number | null
): { pioLabel: string; display: string }[] {
  const actions = doc.root_169?.strategy.actions ?? [];
  return actions.map((pioLabel) => ({
    pioLabel,
    display: formatPioAction(pioLabel, nodeId, effectiveStackChips),
  }));
}

/**
 * Convert a v2 node doc into the JsonData plate shape for one seat.
 * Prefers per-action EVs (doc.actions) over the shared node-level EV array,
 * falling back for legacy docs. Action keys use display labels.
 */
export function docToJsonData(
  doc: PioSolutionDoc,
  role: "oop" | "ip",
  seat: string,
  bb: number,
  effectiveStackChips?: number | null
): JsonData {
  const json: JsonData = { Position: seat, bb } as JsonData;
  const root = doc.root_169;
  if (!root) return json;

  const nodeId = doc.node_id ?? "r:0";
  const evArray = role === "oop" ? root.ev.oop : root.ev.ip;

  root.strategy.actions.forEach((pioLabel, actionIdx) => {
    const row = root.strategy.matrix[actionIdx] ?? [];
    const perAction = doc.actions?.[pioLabel];
    const handMap: { [hand: string]: [number, number] } = {};

    root.hand_classes.forEach((hand, handIdx) => {
      const weight = row[handIdx] ?? 0;
      const perActionEv = perAction?.[hand]?.[1];
      const ev = perActionEv ?? evArray?.[handIdx] ?? 0;
      handMap[hand] = [weight, ev ?? 0];
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (json as any)[formatPioAction(pioLabel, nodeId, effectiveStackChips)] = handMap;
  });

  return json;
}

/** "AhKd9c" -> ["Ah","Kd","9c"] (also handles turn/river strings). */
export function boardToCards(board: string): string[] {
  const cards: string[] = [];
  for (let i = 0; i + 1 < board.length; i += 2) {
    cards.push(board[i] + board[i + 1]);
  }
  return cards;
}
