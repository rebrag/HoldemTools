// Decodes a node doc's per-combo (1326) block into render-ready rows.
//
// The 169-class blocks elsewhere are class averages, which is all the matrix
// needs. The hand breakdown needs the real thing: combos of one class routinely
// play different mixes (blockers make Ah5h a different hand from Ac5c), and
// averaging them is what made every breakdown tile identical.
//
// Values arrive as fixed-point integers indexed against the street bundle's
// shared hand_order; this module is the only place that knows the encoding.
import type { PioSolutionDoc, ComboSeatBlock } from "./postflopClient";

export interface ComboActionValue {
  /** Frequency 0..1. */
  freq: number;
  /** EV in chips of taking this action with this combo, when known. */
  ev: number | null;
  /**
   * Chips given up versus this combo's best available action. 0 for the best
   * one. Null when any action's EV is missing, since the max is then unknown.
   */
  evLoss: number | null;
}

export interface ComboRow {
  /** Order-independent key, e.g. "AhKd". */
  key: string;
  /** Reach weight 0..1: how much of this combo the actor still holds here. */
  weight: number;
  /** Equity vs the opponent's range at this node, 0..1. */
  equity: number | null;
  /** EV in chips at this node. */
  ev: number | null;
  /** Weighted opponent combos this hand is up against. */
  matchups: number | null;
  /** Display action label -> that combo's own value. */
  actions: Record<string, ComboActionValue>;
}

export interface ComboDetail {
  /** Which seat the strategy belongs to. */
  actor: "oop" | "ip";
  /** Display action labels, in the doc's action order. */
  actions: string[];
  /** Keyed by comboKey; only combos the actor can hold appear. */
  byCombo: Map<string, ComboRow>;
}

/**
 * Order-independent key for a two-card combo. Pio writes "6d6c" and "AcKd"
 * while the UI expands classes to ["Ah","Kh"]; sorting the two codes makes both
 * sides agree without either having to replicate the other's convention.
 */
export const comboKey = (a: string, b: string): string =>
  a < b ? `${a}${b}` : `${b}${a}`;

/** Split a hand_order entry ("AcKd") into its two card codes. */
const splitCombo = (combo: string): [string, string] | null =>
  combo && combo.length === 4 ? [combo.slice(0, 2), combo.slice(2, 4)] : null;

const decode = (
  arr: (number | null)[] | null | undefined,
  slot: number,
  scale: number
): number | null => {
  const raw = arr?.[slot];
  return raw == null ? null : raw / scale;
};

/**
 * Build the per-combo view for one node.
 *
 * `displayLabels` maps the doc's raw pio labels to the labels the UI shows
 * ("b138" -> "Bet 1.4bb"), so the rows key by the same strings as the rest of
 * the solver page. Returns null for pre-schema-4 docs and for nodes the actor
 * never reaches, both of which carry no combo block.
 */
export function buildComboDetail(
  doc: PioSolutionDoc | null | undefined,
  handOrder: string[] | null | undefined,
  displayLabels?: string[]
): ComboDetail | null {
  const combos = doc?.combos;
  if (!combos || !handOrder?.length) return null;

  const seat: ComboSeatBlock | null =
    combos.actor === "ip" ? combos.ip : combos.oop;
  if (!seat?.idx?.length) return null;

  const { scale } = combos;
  const labels =
    displayLabels?.length === combos.actions.length
      ? displayLabels
      : combos.actions;

  const byCombo = new Map<string, ComboRow>();

  seat.idx.forEach((handIdx, slot) => {
    const cards = splitCombo(handOrder[handIdx]);
    if (!cards) return;

    const weight = decode(seat.w, slot, scale.w);
    if (weight == null || weight <= 0) return;

    // Pass 1: frequencies and per-action EVs.
    const actions: Record<string, ComboActionValue> = {};
    let best: number | null = null;
    let evKnown = true;
    labels.forEach((label, actionIdx) => {
      const freq = decode(combos.strategy?.[actionIdx], slot, scale.s) ?? 0;
      const ev = decode(combos.action_ev?.[actionIdx], slot, scale.ev);
      if (ev == null) evKnown = false;
      else best = best == null ? ev : Math.max(best, ev);
      actions[label] = { freq, ev, evLoss: null };
    });

    // Pass 2: EV loss needs every action's EV, so it waits for the max.
    if (evKnown && best != null) {
      for (const label of labels) {
        const entry = actions[label];
        if (entry.ev != null) entry.evLoss = best - entry.ev;
      }
    }

    byCombo.set(comboKey(cards[0], cards[1]), {
      key: comboKey(cards[0], cards[1]),
      weight,
      equity: decode(seat.eq, slot, scale.eq),
      ev: decode(seat.ev, slot, scale.ev),
      matchups: decode(seat.mu, slot, scale.mu),
      actions,
    });
  });

  return byCombo.size
    ? { actor: combos.actor, actions: [...labels], byCombo }
    : null;
}
