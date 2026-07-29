// Range-wide aggregate math for the solver's study view (ActionSummary /
// HandBreakdown). Pure functions over HandCellData; colors and ordering come
// from the same shared helpers the matrix cells and legend use.
import { SUITS } from "@/lib/cards";
import {
  type HandCellData,
  actionCategory,
  getColorForAction,
  orderActionKeys,
} from "./utils";

/** 13*12/2 pairs of distinct cards: 6*13 pairs + 4*78 suited + 12*78 offsuit. */
export const TOTAL_COMBOS = 1326;

/** Concrete combos a hand class stands for: 6 for pairs, 4 suited, 12 offsuit. */
export const combosForHand = (hand: string): number => {
  if (hand.length === 2 && hand[0] === hand[1]) return 6;
  return hand[2] === "s" ? 4 : 12;
};

/**
 * Expand a hand class into its concrete combos as [highCard, lowCard] pairs.
 * Suits iterate in the canonical h,d,c,s order:
 *   "QQ"  -> [Qh Qd, Qh Qc, Qh Qs, Qd Qc, Qd Qs, Qc Qs]
 *   "AKs" -> [Ah Kh, Ad Kd, Ac Kc, As Ks]
 *   "AKo" -> the 12 pairs with differing suits, first suit major.
 */
export const expandHandCombos = (hand: string): Array<[string, string]> => {
  const r1 = hand[0];
  const r2 = hand[1];
  const combos: Array<[string, string]> = [];
  if (r1 === r2) {
    for (let i = 0; i < SUITS.length; i++)
      for (let j = i + 1; j < SUITS.length; j++)
        combos.push([r1 + SUITS[i], r2 + SUITS[j]]);
  } else if (hand[2] === "s") {
    for (const s of SUITS) combos.push([r1 + s, r2 + s]);
  } else {
    for (const s1 of SUITS)
      for (const s2 of SUITS)
        if (s1 !== s2) combos.push([r1 + s1, r2 + s2]);
  }
  return combos;
};

export interface ActionAggregate {
  action: string;
  /** getColorForAction(action), precomputed for render. */
  color: string;
  /** Weighted combo count: sum over hands of weight * combosForHand(hand). */
  combos: number;
  /** combos / 1326 * 100. */
  pctOfRange: number;
}

/**
 * Per-action totals across a full range, ordered by orderActionKeys so the
 * result lines up with the matrix cells and the legend. Empty input -> [].
 */
/* Stable segment slots for animated stacked bars, mirroring HandCell: always
 * mounted (width 0 when unused) and keyed by slot name, so the `.segment`
 * width transition animates node changes instead of remounting. Order matches
 * orderActionKeys: all-in, bets (largest first), Min, check/call, fold. */
export const SEGMENT_SLOTS = [
  "allin",
  "bet0",
  "bet1",
  "bet2",
  "bet3",
  "bet4",
  "bet5",
  "min",
  "passive",
  "fold",
  "other0",
  "other1",
] as const;
export type SegmentSlot = (typeof SEGMENT_SLOTS)[number];

export interface SlotSegment {
  slot: SegmentSlot;
  /** 0..100; overflow bets/others merge into the last slot like HandCell. */
  width: number;
  color: string;
}

/** Assign action weights (fractions 0..1) to the fixed slots as bar widths. */
export const buildSegmentSlots = (
  weights: Record<string, number>,
  sizeRef = 1
): SlotSegment[] => {
  const ordered = orderActionKeys(
    Object.keys(weights).filter((a) => a !== "Position")
  );
  const bySlot: Partial<Record<SegmentSlot, { width: number; color: string }>> = {};
  let betIdx = 0;
  let otherIdx = 0;
  for (const action of ordered) {
    const cat = actionCategory(action);
    let slot: SegmentSlot;
    if (cat === "bet") slot = `bet${Math.min(betIdx++, 5)}` as SegmentSlot;
    else if (cat === "other") slot = `other${Math.min(otherIdx++, 1)}` as SegmentSlot;
    else slot = cat;

    const prev = bySlot[slot];
    bySlot[slot] = {
      width: (prev?.width ?? 0) + (weights[action] || 0) * 100,
      color: prev?.color ?? getColorForAction(action, sizeRef),
    };
  }
  return SEGMENT_SLOTS.map((slot) => ({
    slot,
    width: bySlot[slot]?.width ?? 0,
    color: bySlot[slot]?.color ?? "transparent",
  }));
};

export const computeActionAggregates = (
  data: HandCellData[],
  sizeRef = 1
): ActionAggregate[] => {
  /* Keep zero-weight actions: they are still navigable branches (clicking a
   * 0.0% panel shows reactions to that action, matching ColorKey). */
  const totals = new Map<string, number>();
  for (const cell of data) {
    const handCombos = combosForHand(cell.hand);
    for (const [action, weight] of Object.entries(cell.actions)) {
      if (action === "Position") continue;
      totals.set(action, (totals.get(action) ?? 0) + (weight || 0) * handCombos);
    }
  }
  return orderActionKeys([...totals.keys()]).map((action) => {
    const combos = totals.get(action) ?? 0;
    return {
      action,
      color: getColorForAction(action, sizeRef),
      combos,
      pctOfRange: (combos / TOTAL_COMBOS) * 100,
    };
  });
};
