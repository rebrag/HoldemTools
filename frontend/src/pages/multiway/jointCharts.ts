// src/pages/multiway/jointCharts.ts
//
// Charts conditioned on the partner's ACTUAL cards, read off the exact joint
// table (lib/sessionSim/orbits.ts). Where the 169x169 rollup can only say
// "partner holds AKs", this can say "partner holds AsKs", and the difference
// is the suits: a cell of the 13x13 grid is then the reach-weighted average
// over its combos that do not collide with the partner's cards, and the
// combo breakdown under it shows each of those combos on its own - which is
// where the partner blocking your suits becomes visible.
//
// Everything here is in the artifact's chips; callers divide by the chip
// scale where they want big blinds (the plates do, the panel's tooltip does
// its own conversion).
import type { HandCellData, JsonData, HandData } from "@/lib/solver/utils";
import { HAND_ORDER } from "@/lib/solver/handOrder";
import { expandHandCombos } from "@/lib/solver/aggregates";
import { comboKey, type ComboDetail, type ComboRow } from "@/lib/solver/comboDetail";
import {
  idOfCode,
  jointEv,
  jointFreq,
  orbitOf,
  type JointNode,
  type TeamJoint,
} from "@/lib/sessionSim/orbits";
import { idToString } from "@/lib/sessionSim/cards";
import { decodeTeamJoint } from "@/lib/sessionSim/orbits";
import { actionLabels, gridFor, type DumpNode, type PushFoldDump } from "./pushfoldResult";

/** The decoded joint table for a payload, built once: decoding sorts
 *  93,769 keys, and the group view holds several payloads at once. */
const JOINT_CACHE = new WeakMap<PushFoldDump, TeamJoint | null>();
export function jointForDump(dump: PushFoldDump): TeamJoint | null {
  if (JOINT_CACHE.has(dump)) return JOINT_CACHE.get(dump) ?? null;
  const joint = decodeTeamJoint(dump.metadata.team_joint);
  JOINT_CACHE.set(dump, joint);
  return joint;
}

/** Card codes to ids, dropping anything that is not a card. */
export const idsOfCodes = (codes: string[]): number[] =>
  codes.map(idOfCode).filter((id) => id >= 0);

/** Card codes ("Ah") of a class's combos, cached: the same 169 lists are
 *  expanded for every chart. */
const COMBOS_OF_CLASS = new Map<string, [number, number][]>();
const combosOfClass = (hand: string): [number, number][] => {
  let hit = COMBOS_OF_CLASS.get(hand);
  if (!hit) {
    hit = expandHandCombos(hand).map(([a, b]) => [idOfCode(a), idOfCode(b)] as [number, number]);
    COMBOS_OF_CLASS.set(hand, hit);
  }
  return hit;
};

/** Every partner combo consistent with the cards given: one when both are
 *  known, the 51 holding that card when one is. */
const partnerCombos = (cards: number[]): [number, number][] => {
  if (cards.length >= 2) return [[cards[0], cards[1]]];
  const c = cards[0];
  const out: [number, number][] = [];
  for (let x = 0; x < 52; x += 1) if (x !== c) out.push([c, x]);
  return out;
};

export interface ConditionedChart {
  cells: HandCellData[];
  /** True when no row of the node carries reach for these partner cards:
   *  the chart then falls back to the partner-averaged marginal. */
  unreached: boolean;
  /** Reach mass behind the chart relative to the node's largest row (a
   *  "how often does this actually happen" signal, 0..1 scale, uncapped). */
  reach: number;
  /** Share of the actor's possible hands that have ANY data for these
   *  partner cards at this node (0..1). Everything else shows the marginal.
   *  Low when the partner almost never arrives here holding those cards -
   *  on a converged solve a partner that always jams AsQd leaves the
   *  "partner folded AsQd" node with data for a handful of hands only. */
  coverage: number;
  /** The chart is mostly fallback or trained on thin rows: coverage under
   *  half, or the rows behind it averaging under 2% of the node's heaviest.
   *  Read it loosely, and say so. */
  rare: boolean;
}

/** Below this share of the node's heaviest row, a conditioning's rows are
 *  thin data rather than a strategy. */
const RARE_MEAN_WEIGHT = 0.02;
/** Below this share of hands with data, the chart is mostly the marginal. */
const RARE_COVERAGE = 0.5;

/**
 * The actor's 13x13 chart at `node` given the partner holds `partnerCards`
 * (one or two ids). Cells average their combos' exact rows, weighted by
 * reach; a cell whose combos all collide with the partner's cards, or that
 * the solve never reached, shows the node's marginal for that class so the
 * grid never has a hole - and the cell's EVs stay empty to say so.
 */
export function conditionedGridForCards(
  node: DumpNode,
  joint: TeamJoint,
  jointNode: JointNode,
  partnerCards: number[]
): ConditionedChart {
  const labels = actionLabels(node);
  const marginal = gridFor(node);
  if (partnerCards.length === 0) {
    return { cells: marginal, unreached: false, reach: 1, coverage: 1, rare: false };
  }
  const partners = partnerCombos(partnerCards);
  const A = labels.length;
  let total = 0;
  let pairs = 0;
  let covered = 0;
  const cells: HandCellData[] = HAND_ORDER.map((hand, k) => {
    const fsum = new Float64Array(A);
    const esum = new Float64Array(A);
    const ew = new Float64Array(A);
    let W = 0;
    for (const [o1, o2] of combosOfClass(hand)) {
      for (const [p1, p2] of partners) {
        const jc = orbitOf(joint, o1, o2, p1, p2);
        if (jc < 0) continue;
        pairs += 1;
        const w = jointNode.weight[jc] / 65535;
        if (w <= 0) continue;
        covered += 1;
        W += w;
        for (let a = 0; a < A; a += 1) {
          fsum[a] += w * jointFreq(jointNode, jc, a);
          const e = jointEv(jointNode, jc, a);
          if (e != null) {
            esum[a] += w * e;
            ew[a] += w;
          }
        }
      }
    }
    total += W;
    if (W <= 0) return marginal[k];
    const actions: Record<string, number> = {};
    const evs: Record<string, number> = {};
    labels.forEach((label, a) => {
      actions[label] = fsum[a] / W;
      if (ew[a] > 0) evs[label] = esum[a] / ew[a];
    });
    return { hand, actions, evs };
  });
  const coverage = pairs > 0 ? covered / pairs : 0;
  return {
    cells,
    unreached: total <= 0,
    reach: total,
    coverage,
    rare:
      total > 0 && pairs > 0 && (coverage < RARE_COVERAGE || total / pairs < RARE_MEAN_WEIGHT),
  };
}

/**
 * Every combo the actor can hold against the partner's exact two cards,
 * with its own row: the per-combo view HandBreakdown renders. Weights are
 * relative to the heaviest combo so they read as "how much of this hand is
 * still here"; EVs stay in team chips.
 */
export function comboDetailForCards(
  node: DumpNode,
  joint: TeamJoint,
  jointNode: JointNode,
  partner: [number, number]
): ComboDetail {
  const labels = actionLabels(node);
  const A = labels.length;
  const rows: { key: string; w: number; f: number[]; e: (number | null)[] }[] = [];
  let wmax = 0;
  for (let o1 = 0; o1 < 52; o1 += 1) {
    if (o1 === partner[0] || o1 === partner[1]) continue;
    for (let o2 = o1 + 1; o2 < 52; o2 += 1) {
      if (o2 === partner[0] || o2 === partner[1]) continue;
      const jc = orbitOf(joint, o1, o2, partner[0], partner[1]);
      if (jc < 0) continue;
      const w = jointNode.weight[jc] / 65535;
      const f: number[] = [];
      const e: (number | null)[] = [];
      for (let a = 0; a < A; a += 1) {
        f.push(jointFreq(jointNode, jc, a));
        e.push(jointEv(jointNode, jc, a));
      }
      if (w > wmax) wmax = w;
      rows.push({ key: comboKey(idToString(o1), idToString(o2)), w, f, e });
    }
  }
  const byCombo = new Map<string, ComboRow>();
  for (const r of rows) {
    const best = r.e.reduce<number | null>(
      (m, v) => (v == null ? m : m == null ? v : Math.max(m, v)),
      null
    );
    const anyMissing = r.e.some((v) => v == null);
    const actions: ComboRow["actions"] = {};
    labels.forEach((label, a) => {
      const ev = r.e[a];
      actions[label] = {
        freq: r.f[a],
        ev,
        evLoss: anyMissing || ev == null || best == null ? null : best - ev,
      };
    });
    let ev: number | null = null;
    if (!anyMissing) {
      ev = 0;
      for (let a = 0; a < A; a += 1) ev += r.f[a] * (r.e[a] ?? 0);
    }
    byCombo.set(r.key, {
      key: r.key,
      weight: wmax > 0 ? r.w / wmax : 0,
      equity: null,
      ev,
      matchups: null,
      actions,
    });
  }
  return { actor: "oop", actions: labels, byCombo };
}

/** Cells as the JsonData a Plate reads, EVs converted to big blinds. */
export function jsonDataFromCells(
  position: string,
  stackBb: number,
  cells: HandCellData[],
  labels: string[],
  chipScale: number
): JsonData {
  const data: JsonData = { Position: position, bb: stackBb };
  const perLabel: HandData[] = labels.map(() => ({}));
  for (const cell of cells) {
    labels.forEach((label, i) => {
      const ev = cell.evs[label];
      perLabel[i][cell.hand] = [cell.actions[label] ?? 0, ev != null ? ev / chipScale : NaN];
    });
  }
  labels.forEach((label, i) => {
    data[label] = perLabel[i];
  });
  return data;
}
