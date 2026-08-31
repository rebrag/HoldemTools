// src/pages/compare/compareLineNodes.ts
//
// The line strip's data, derived entirely from the node directory a .htc header
// already carries. No new fetch, no new page state: `nodeIndex` remains the one
// source of truth for "where am I", and this turns it into the walk that got
// there.
//
// It can do that because htsolver and PioSolver emit the SAME node ids - a
// deliberate convergence, see watcher/engine_compare.py's engine_colon_ids and
// backend Services/EngineArtifacts/EngineSolutionExporter.cs. Ids are colon
// paths rooted at "r:0", one segment per edge:
//
//   f      fold
//   c      check or call
//   b<n>   bet/raise; <n> is the actor's HAND-CUMULATIVE postflop commit
//   As     a dealt runout card (a chance edge)
//
// so `id.split(":")` is literally the line, and every prefix is a node.
//
// One asymmetry to know about: a .htc header lists DECISION nodes only. A
// chance node - the point where a street's card is dealt - has no strategy and
// so no header row, which is exactly how a card segment is recognised: its
// parent prefix is absent from the directory.
import { isCardSegment, priorStreetCommitChips } from "@/lib/solver/postflopNode";
import type { PostflopSessionLineNode } from "@/hooks/usePostflopSession";

/** The projection of HtcNodeMeta that the strip needs.
 *
 *  `actions` is carried rather than re-derived from the directory: a node's
 *  child that is a CHANCE node has no header row of its own, so a sibling list
 *  assembled from the directory would silently omit the very action that
 *  closes a street. The header's own action list has all of them. */
export interface CompareNodeRef {
  id: string;
  position: string;
  actions: string[];
}

export const ROOT_ID = "r:0";

/**
 * Every node id's immediate children, keyed by parent. Built once per payload
 * rather than per prefix, so walking a line is linear in the directory rather
 * than quadratic.
 *
 * Only used to resolve a CHANCE node's runouts - the deals under it are real
 * directory entries even though the chance node itself is not. A decision
 * node's own options come from its `actions`, never from here; see the note on
 * CompareNodeRef for why the two are not interchangeable.
 */
export const buildChildIndex = (nodes: CompareNodeRef[]): Map<string, string[]> => {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    const cut = node.id.lastIndexOf(":");
    if (cut < 0) continue;
    const parent = node.id.slice(0, cut);
    const segment = node.id.slice(cut + 1);
    // "r:0" splits into parent "r" + segment "0"; the root has no parent edge.
    if (node.id === ROOT_ID) continue;
    const list = children.get(parent);
    if (list) list.push(segment);
    else children.set(parent, [segment]);
  }
  return children;
};

export interface CompareLine {
  /** Visited nodes between the root and the current one, in order. */
  lineNodes: PostflopSessionLineNode[];
  /** Cards dealt along the way, so the caller can show the board as it stood
   *  at this node rather than the full runout. */
  dealtCards: string[];
}

/**
 * The walk from the root to `nodeId`.
 *
 * `label(segment, parentId)` turns a raw segment into the display name - passed
 * in rather than imported so this file cannot introduce a SECOND action-label
 * formatter. /compare already has one, and its output doubles as the join key
 * between the two solvers' action columns, so a disagreement here would show up
 * as columns that silently stop matching.
 */
export const buildCompareLine = (
  nodeId: string,
  byId: Map<string, CompareNodeRef>,
  label: (segment: string, parentId: string) => string,
  /** Pot at the root, in the page's display units. Card tiles carry the pot as
   *  it stood when they were dealt, which needs this as the base. */
  rootPot = 0
): CompareLine => {
  const segments = nodeId.split(":");
  const lineNodes: PostflopSessionLineNode[] = [];
  const dealtCards: string[] = [];

  // Start after "r:0" - the root is drawn by the strip's own board card.
  let prefix = ROOT_ID;
  for (let i = 2; i < segments.length; i++) {
    const segment = segments[i];
    const childId = `${prefix}:${segment}`;

    if (isCardSegment(segment)) {
      dealtCards.push(segment);
      lineNodes.push({
        kind: "card",
        nodeId: childId,
        label: segment,
        /* priorStreetCommitChips is one seat's share of the completed streets,
         * and a street only completes matched - so both seats put that in.
         * bNNN here is already in the page's display units, so no scaling. */
        potMoney: rootPot + 2 * priorStreetCommitChips(childId),
      });
      prefix = childId;
      continue;
    }

    const decision = byId.get(prefix);
    if (decision) {
      lineNodes.push({
        kind: "action",
        nodeId: childId,
        parentId: prefix,
        seat: decision.position,
        // A .htc header carries no per-seat stacks, so the card shows none
        // rather than inventing one.
        stackMoney: null,
        // /compare keeps its labels in the payload's own chips and prints no
        // percent-of-pot beside them (see actionLabels.ts), so every option
        // here carries a null pct.
        options: decision.actions.map((s) => ({ label: label(s, prefix), pct: null })),
        taken: label(segment, prefix),
      });
    }
    prefix = childId;
  }

  return { lineNodes, dealtCards };
};

/**
 * The raw segment a display label came from, at one decision node. The inverse
 * of `label` above, done by search over the node's own action list rather than
 * by parsing, so the two can never drift: whatever the formatter produced is
 * what is matched.
 */
export const segmentForLabel = (
  node: CompareNodeRef | undefined,
  display: string,
  label: (segment: string, parentId: string) => string
): string | null =>
  node?.actions.find((s) => label(s, node.id) === display) ?? null;
