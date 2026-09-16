// src/pages/multiwayPostflop/postflopLabels.ts
//
// Action labels and the 169-class grid for a MULTIWAY POSTFLOP dump.
//
// pushfoldResult's actionLabels cannot be reused here and it is worth saying
// why, because reusing it is the obvious move and it fails silently. It reads
//
//     node.num_children === 2 ? ["Fold", "ALLIN"] : ["ALLIN"]
//
// which is exactly right for a jam/fold tree, where a node either faces a bet
// (fold or jam) or does not (jam). A postflop node has check, any number of
// bet sizes, and a shove, so that function returns ONE label for a
// three-action node - and gridFor then paints the CHECK frequency into a cell
// labelled ALLIN. Wrong colours, wrong tooltip, no error.
//
// The vocabulary here is deliberately the same as /compare's
// actionLabels.displayLabelWith: "Fold", "Check", "Call", "Bet N",
// "Raise to N", and the literal "ALLIN". That last one is load-bearing rather
// than cosmetic - `isAllin` in solver/utils matches that exact word to give a
// jam a flat dark red instead of a shade from the bet ramp, and spreadRamp's
// gap is min(0.19, 1/(n-1)), so letting a jam into the ramp re-shades every
// other bet at the same node.
import type { HandCellData } from "@/lib/solver/utils";
import { HAND_ORDER } from "@/lib/solver/handOrder";
import type { DumpNode, PushFoldDump } from "@/pages/multiway/pushfoldResult";

/** The largest post-root commitment any seat has made at this node. */
const currentBet = (node: DumpNode): number =>
  node.commit.reduce((a, b) => Math.max(a, b), 0);

/** What each seat had committed when THIS street began.
 *
 *  `commit` is hand-cumulative, so on a turn or river tree the raw number
 *  keeps climbing across streets and a bet reads as far bigger than it is.
 *  The street's first node is its deal node, and that node's commits are the
 *  carried-over totals - so walking up to it gives the baseline to net out.
 *  The root street has no deal above it, and nothing to net. */
const streetStartCommit = (dump: PushFoldDump, node: DumpNode, seat: number): number => {
  let cur: DumpNode | undefined = node;
  while (cur) {
    if (cur.action_kind === "deal") return cur.commit[seat] ?? 0;
    if (cur.parent_id == null) return 0;
    cur = dump.nodes[String(cur.parent_id)];
  }
  return 0;
};

/** One label per child of a decision node, in child order. */
export const postflopActionLabels = (dump: PushFoldDump, node: DumpNode): string[] => {
  if (node.kind !== "decision" || node.first_child == null) return [];
  const actor = node.actor ?? 0;
  const bet = currentBet(node);
  const facing = bet > (node.commit[actor] ?? 0);
  const stack = dump.metadata.stacks?.[actor];
  const base = streetStartCommit(dump, node, actor);

  const out: string[] = [];
  for (let k = 0; k < node.num_children; k++) {
    const child = dump.nodes[String(node.first_child + k)];
    if (!child) {
      out.push("?");
      continue;
    }
    if (child.action_kind === "fold") {
      out.push("Fold");
      continue;
    }
    if (child.action_kind === "check_call") {
      out.push(facing ? "Call" : "Check");
      continue;
    }
    const committed = child.commit[actor] ?? 0;
    // 1 chip of tolerance: the smallest amount a solve can express.
    if (stack != null && stack > 0 && committed >= stack - 1) {
      out.push("ALLIN");
      continue;
    }
    out.push(facing ? `Raise to ${committed - base}` : `Bet ${committed - base}`);
  }
  return out;
};

/** The node's 169-class chart, in the shape DecisionMatrix consumes. */
export const postflopGridFor = (dump: PushFoldDump, node: DumpNode): HandCellData[] => {
  const rollup = node.data?.rollup_169 ?? [];
  const labels = postflopActionLabels(dump, node);
  const byClass = new Map(rollup.map((r) => [r.class, r]));
  return HAND_ORDER.map((hand) => {
    const entry = byClass.get(hand);
    const actions: Record<string, number> = {};
    const evs: Record<string, number> = {};
    labels.forEach((label, i) => {
      actions[label] = entry?.freq[i] ?? 0;
      // Per-action where the payload has it; the class EV is one number for
      // every action and only ever said what the mix was worth.
      if (entry) evs[label] = entry.action_ev?.[i] ?? entry.ev;
    });
    return { hand, actions, evs };
  });
};

/** Walk the chosen path from the root, collecting the decisions met on the
 *  way and wherever the path ended.
 *
 *  Mirrors pushfoldResult's walkLine except for the labels: that one calls the
 *  jam/fold actionLabels internally, so its breadcrumb reads "ALLIN" at every
 *  step of a postflop line. */
export const postflopWalkLine = (dump: PushFoldDump, path: number[]) => {
  const steps: { node: DumpNode; child: number; label: string; seat: number }[] = [];
  let node: DumpNode | undefined = dump.nodes["0"];
  for (const choice of path) {
    if (!node || node.kind !== "decision" || node.first_child == null) break;
    const labels = postflopActionLabels(dump, node);
    const child: number = node.first_child + choice;
    steps.push({ node, child, label: labels[choice] ?? "?", seat: node.actor ?? -1 });
    node = dump.nodes[String(child)];
  }
  return { steps, node };
};

/** The shared helpers (walkLine, buildLineModel, lineHandlers, gridFor) take a
 *  one-argument labeller; this binds the dump into one. */
export const labellerFor = (dump: PushFoldDump) => (node: DumpNode) =>
  postflopActionLabels(dump, node);
