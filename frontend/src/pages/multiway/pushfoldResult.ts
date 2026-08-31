// src/pages/multiway/pushfoldResult.ts
//
// Decoding for the payload a `pushfold` job returns: `engine.exe dump-json`
// over the .hta artifact, gzipped by the watcher and served through
// GET /api/enginecompare/{id}/result/ht.
//
// The 169-class rollup the engine already writes into every decision node's
// blob IS the push/fold chart, so there is no new schema here and no exporter
// involved - the schema-4 bundle path is heads-up postflop by construction
// (manifest.seats is {oop, ip}) and correctly refuses a 4-seat artifact.
import type { HandCellData } from "@/lib/solver/utils";
import { HAND_ORDER } from "@/lib/solver/handOrder";

export interface DumpRollupEntry {
  class: string;
  weight: number;
  ev: number;
  freq: number[];
}

export interface DumpNode {
  node_id: number;
  parent_id: number | null;
  kind: "decision" | "chance" | "terminal";
  action_kind: "root" | "fold" | "check_call" | "bet" | "deal";
  action_amount: number;
  pot: number;
  actor: number | null;
  num_children: number;
  first_child: number | null;
  commit: number[];
  terminal?: "fold" | "showdown";
  fold_winner?: number;
  data?: { num_actions: number; rollup_169?: DumpRollupEntry[] };
}

export interface PushFoldDump {
  metadata: {
    seats: string[];
    stacks?: number[];
    ev_chips: number[];
    final_nashconv: number;
    iterations: number;
    pot: number;
    chip_scale: number;
    multiway_no_nash_guarantee: boolean;
    opponent_card_removal?: string;
    solver_family?: string;
    hand_symmetry?: string;
    board_sample?: { iter_count: number; pair_count: number; seed: number };
    preflop?: {
      button: number;
      sb_seat: number;
      bb_seat: number;
      small_blind: number;
      big_blind: number;
      action_order: number[];
    };
  };
  nodes: Record<string, DumpNode>;
}

/** Jam-or-fold trees offer fold first whenever there is something to call, so
 *  the jam is always the last action. Naming them here keeps the colour
 *  mapping in lib/solver/constants (where ALLIN and Fold already live)
 *  rather than inventing a second vocabulary. */
export const actionLabels = (node: DumpNode): string[] =>
  node.num_children === 2 ? ["Fold", "ALLIN"] : ["ALLIN"];

/** The node's 169-class chart, in the shape DecisionMatrix consumes. */
export const gridFor = (node: DumpNode): HandCellData[] => {
  const rollup = node.data?.rollup_169 ?? [];
  const labels = actionLabels(node);
  const byClass = new Map(rollup.map((r) => [r.class, r]));
  return HAND_ORDER.map((hand) => {
    const entry = byClass.get(hand);
    const actions: Record<string, number> = {};
    const evs: Record<string, number> = {};
    labels.forEach((label, i) => {
      actions[label] = entry?.freq[i] ?? 0;
      if (entry) evs[label] = entry.ev;
    });
    return { hand, actions, evs };
  });
};

/** Combos taking `action` as a percent of the 1326, weighting each class by
 *  how many combos it has. This is the number push/fold charts are quoted
 *  in, so it is what the panel shows beside each grid. */
export const actionPct = (node: DumpNode, action: string): number => {
  const labels = actionLabels(node);
  const index = labels.indexOf(action);
  if (index < 0) return 0;
  const byClass = new Map((node.data?.rollup_169 ?? []).map((r) => [r.class, r]));
  let taken = 0;
  HAND_ORDER.forEach((hand) => {
    const combos = hand.length === 2 ? 6 : hand.endsWith("s") ? 4 : 12;
    taken += combos * (byClass.get(hand)?.freq[index] ?? 0);
  });
  return (taken / 1326) * 100;
};

export interface LineStep {
  /** The node the action was taken at. */
  node: DumpNode;
  /** Which child it leads to. */
  child: number;
  label: string;
  seat: number;
}

/** Walk from the root down a chosen path, collecting the decision nodes met
 *  along the way. Returns the steps taken plus wherever the path ended -
 *  which may be a terminal, since folding everyone out ends the hand. */
export const walkLine = (dump: PushFoldDump, path: number[]) => {
  const steps: LineStep[] = [];
  let node = dump.nodes["0"];
  for (const choice of path) {
    if (!node || node.kind !== "decision" || node.first_child == null) break;
    const labels = actionLabels(node);
    const child = node.first_child + choice;
    steps.push({ node, child, label: labels[choice] ?? "?", seat: node.actor ?? -1 });
    node = dump.nodes[String(child)];
  }
  return { steps, node };
};
