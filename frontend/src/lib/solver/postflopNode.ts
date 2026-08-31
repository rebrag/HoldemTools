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
 * node's path. Pio bet labels are hand-cumulative "commit to NNN" amounts -
 * running totals of a player's whole postflop investment, never resetting at
 * a street boundary - and a street only completes matched (call or
 * check-through), so the last bet seen before the current street is what both
 * players have put in. A check-through street has no bet segment and the
 * carry simply persists.
 */
export function priorStreetCommitChips(nodeId: string): number {
  const segs = nodeId.split(":").slice(2); // drop "r","0"
  let carry = 0; // cumulative commit at the last street boundary
  let lastBet: number | null = null; // last bNNN seen on the street in progress
  for (const seg of segs) {
    if (isCardSegment(seg)) {
      if (lastBet != null) carry = lastBet; // street completed by the deal
      lastBet = null;
    } else {
      const m = seg.match(/^b(\d+)$/);
      if (m) lastBet = Number(m[1]);
    }
  }
  return carry; // the in-progress street is not included
}

/**
 * Chips each player has in front of them on the CURRENT (unfinished) street.
 * Heads-up postflop the actor alternates strictly, OOP first on every street,
 * and Pio bet labels are hand-cumulative "commit to NNN" amounts - so each
 * side's live bet is its latest cumulative value less what it had already
 * committed on completed streets.
 */
export function currentStreetCommitChips(nodeId: string): {
  oop: number;
  ip: number;
} {
  const prior = priorStreetCommitChips(nodeId);
  const commit = { oop: 0, ip: 0 };
  let toCall = 0;
  streetActionsOf(nodeId).forEach((seg, i) => {
    const who = i % 2 === 0 ? "oop" : "ip";
    const bet = seg.match(/^b(\d+)$/);
    if (bet) {
      commit[who] = Number(bet[1]) - prior;
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
 * Derived from the node path rather than Pio's `pot` triple; both use the
 * same hand-cumulative running totals, but taking the triple at face value
 * leaves a called flop bet parked in front of both seats for the rest of the
 * hand instead of in the pot.
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
  /** Starting stacks from the folder tokens, in the solve's display money
   *  (big blinds for sims, the hand's own chips for hand-history solves). */
  stacksMap: Record<string, number> | undefined,
  seats: string[],
  effectiveStackChips?: number | null,
  chipScale = 100
): number {
  if (!stacksMap || effectiveStackChips == null || effectiveStackChips <= 0) return 0;
  const stacks = seats
    .map((seat) => stacksMap[seat])
    .filter((v): v is number => v != null);
  if (stacks.length === 0) return 0;
  return Math.max(0, Math.round(Math.min(...stacks) * chipScale) - effectiveStackChips);
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

/** "13.40" -> "13.4", "150.0" -> "150". Never emits a thousands separator:
 *  lib/solver/utils.ts reads the first number out of the label. */
const trimTrailingZeros = (s: string): string =>
  s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;

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
  effectiveStackChips?: number | null,
  /** Pio chips per unit of the solve's display money. Passing it marks the
   *  solve as money-denominated (a recorded hand); leaving it out is a
   *  preflop sim, whose numbers are big blinds at 100 chips each. */
  chipScale?: number | null
): string {
  if (pioLabel === "f") return "Fold";
  if (pioLabel === "c" || pioLabel === "x" || pioLabel === "check") {
    return facingBet(nodeId) ? "Call" : "Check";
  }
  const m = pioLabel.match(/^b(\d+)$/);
  if (m) {
    const chips = Number(m[1]);
    if (effectiveStackChips != null && effectiveStackChips > 0) {
      // Both sides are hand-cumulative postflop totals, so they compare
      // directly. 1 raw Pio chip of tolerance - the smallest amount the
      // solve can express, whatever the scale.
      if (chips >= effectiveStackChips - 1) return "ALLIN";
    }
    // The bNNN value is the actor's whole-hand postflop commitment; the bet
    // on this street is what exceeds their completed-street carry.
    const net = chips - priorStreetCommitChips(nodeId);
    if (chipScale != null) {
      // The scale is a power of ten and `net` is an integer, so this many
      // decimals renders it losslessly. That matters beyond looks: the label
      // doubles as a JsonData key, and two bets that round onto the same
      // string would overwrite each other and misdirect node navigation.
      const decimals = Math.max(0, Math.round(Math.log10(chipScale)));
      const text = trimTrailingZeros((net / chipScale).toFixed(decimals));
      return facingBet(nodeId) ? `Raise to ${text}` : `Bet ${text}`;
    }
    const bb = net / 100;
    const amount = Number.isInteger(bb) ? String(bb) : bb.toFixed(1);
    return facingBet(nodeId) ? `Raise to ${amount}bb` : `Bet ${amount}bb`;
  }
  return pioLabel;
}

/**
 * A bet or raise as a percentage of the pot it is going into - the second
 * number on a line card, beside the amount ("Bet 5.7 (104%)").
 *
 * A bet is simply its size over the pot. A raise is the raise-BY amount over
 * the pot the raiser would be raising into, i.e. after their own call: the
 * convention every solver front-end uses, and the one that makes a 3-bet read
 * as a size rather than as a running total.
 *
 * Null for fold, check, call and all-in - none of which are a size choice -
 * and null when the solve did not record its starting pot.
 *
 * Deliberately NOT folded into formatPioAction: that label doubles as a
 * JsonData plate key, as pickActionAt's reverse-lookup key and as comboDetail's
 * row key, so it has to stay byte-identical. The percentage is presentation
 * and travels beside the label as its own number.
 */
export function betPotPct(
  pioLabel: string,
  nodeId: string,
  /** manifest.pot_chips - the pot at the root of the tree, in Pio chips. */
  startingPotChips?: number | null,
  effectiveStackChips?: number | null
): number | null {
  if (startingPotChips == null || startingPotChips <= 0) return null;
  const m = pioLabel.match(/^b(\d+)$/);
  if (!m) return null; // fold / check / call
  const chips = Number(m[1]);
  // An all-in is labelled ALLIN, with no amount and so no percentage.
  if (effectiveStackChips != null && effectiveStackChips > 0) {
    if (chips >= effectiveStackChips - 1) return null;
  }

  const { potChips, oopChips, ipChips } = potSplitChips(nodeId, startingPotChips);
  // Heads-up postflop the actor alternates strictly, OOP first on every street,
  // so the number of actions already taken on this street names who is acting.
  const actingOop = streetActionsOf(nodeId).length % 2 === 0;
  const facing = actingOop ? ipChips : oopChips;
  const mine = actingOop ? oopChips : ipChips;

  // What the raiser is raising into: the middle, both live bets, and the call
  // they are about to make. For a bet (facing === 0) that is just the middle.
  const target = potChips + facing + mine + (facing - mine);
  if (target <= 0) return null;
  const net = chips - priorStreetCommitChips(nodeId);
  return Math.round(((net - facing) / target) * 100);
}

/** Map each raw pio action of a node's doc to its display label and, for bets
 *  and raises, its size as a percentage of the pot (order preserved). */
export function displayActionMap(
  doc: PioSolutionDoc,
  nodeId: string,
  effectiveStackChips?: number | null,
  chipScale?: number | null,
  /** manifest.pot_chips. Without it the entries carry a null percentage. */
  startingPotChips?: number | null
): { pioLabel: string; display: string; pct: number | null }[] {
  const actions = doc.root_169?.strategy.actions ?? [];
  return actions.map((pioLabel) => ({
    pioLabel,
    display: formatPioAction(pioLabel, nodeId, effectiveStackChips, chipScale),
    pct: betPotPct(pioLabel, nodeId, startingPotChips, effectiveStackChips),
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
  effectiveStackChips?: number | null,
  chipScale?: number | null
): JsonData {
  const json: JsonData = { Position: seat, bb } as JsonData;
  /* Pio reports EV in raw chips; the grid renders it as money, so scale it
   * here rather than leaving the tooltip to label chips as big blinds. */
  const evScale = chipScale ?? 100;
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
      handMap[hand] = [weight, (ev ?? 0) / evScale];
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (json as any)[formatPioAction(pioLabel, nodeId, effectiveStackChips, chipScale)] =
      handMap;
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
