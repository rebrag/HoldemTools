import { useCallback, useMemo, useRef, useState } from "react";
import type { PioSolutionDoc } from "@/lib/solver/postflopClient";
import type {
  BoardManifest,
  ManifestNode,
} from "@/lib/solver/postflopLibrary";
import {
  fetchStreetBundle,
  pollForStreet,
  postNodeRequest,
} from "@/lib/solver/postflopLibrary";
import {
  boardToCards,
  displayActionMap,
  isCardSegment,
  parentOf,
  toSuffix,
} from "@/lib/solver/postflopNode";

export type PostflopLineItem = {
  label: string;
  nodeId: string;
  kind?: "action" | "card";
};

/** A visited node of the postflop line, enriched for the Line display:
 *  dealt-card markers, or decisions with the options that were available. */
export type PostflopSessionLineNode =
  | { kind: "card"; nodeId: string; label: string }
  | {
      kind: "action";
      /** Child node reached by taking the action (jump target). */
      nodeId: string;
      /** The decision node itself (base for branching to other options). */
      parentId: string;
      seat: string;
      stackBB: number | null;
      /** Display labels of every action available at the decision node. */
      options: string[];
      taken: string;
    };

export type StreetPicker = {
  /** The chance node whose card is being picked. */
  chanceNodeId: string;
  street: "turn" | "river";
};

export type PendingStreet = {
  seedSuffix: string;
  card: string;
  startedAt: number;
  /** True once the watcher reports an evicted-cfr re-solve (minutes). */
  resolving: boolean;
};

type SessionCore = {
  stacks: string;
  nodeName: string;
  manifest: BoardManifest;
  oopSeat: string;
  ipSeat: string;
  currentNodeId: string;
  line: PostflopLineItem[];
  notice: string | null;
  picker: StreetPicker | null;
  pendingStreet: PendingStreet | null;
};

export type PostflopView = {
  stacks: string;
  nodeName: string;
  /** Board at the CURRENT node (grows with dealt cards). */
  board: string[];
  oopSeat: string;
  ipSeat: string;
  manifest: BoardManifest;
  currentNodeId: string;
  line: PostflopLineItem[];
  /** The line enriched with per-decision seats/stacks/options for display. */
  lineNodes: PostflopSessionLineNode[];
  notice: string | null;
  picker: StreetPicker | null;
  pendingStreet: PendingStreet | null;
  /** Cards with an already-extracted street for the open picker. */
  extractedCards: Set<string>;
  /** Cards legal to deal at the open picker (52 minus board). */
  usedCards: Set<string>;
  actorSeat: string;
  actorDoc: PioSolutionDoc | null;
  opponentSeat: string;
  opponentDoc: PioSolutionDoc | null;
  actions: { pioLabel: string; display: string }[];
  loading: boolean;
};

/** Cards dealt along a node path (segments after "r:0" that look like cards). */
function dealtCards(nodeId: string): string[] {
  return nodeId.split(":").slice(2).filter(isCardSegment);
}

/**
 * Postflop navigation over v3 street bundles. A whole street's node docs and
 * walk metadata load in one gzipped fetch; navigation within a street is
 * synchronous. Chance nodes open a turn/river card picker; unextracted
 * streets are requested on demand and polled via the manifest.
 */
export function usePostflopSession() {
  const [core, setCore] = useState<SessionCore | null>(null);
  const [docs, setDocs] = useState<Record<string, PioSolutionDoc>>({});
  const [loading, setLoading] = useState(false);
  const docsRef = useRef<Record<string, PioSolutionDoc>>({});
  const metaRef = useRef<Record<string, ManifestNode>>({});
  const coreRef = useRef<SessionCore | null>(null);
  const cancelRef = useRef(false);
  docsRef.current = docs;
  coreRef.current = core;

  const loadStreet = useCallback(
    async (c: SessionCore, seedSuffix: string): Promise<boolean> => {
      if (docsRef.current[seedSuffix]) return true; // seed doc present = street cached
      const bundle = await fetchStreetBundle(
        c.stacks, c.nodeName, c.manifest.board, seedSuffix
      );
      if (!bundle) return false;
      docsRef.current = { ...docsRef.current, ...bundle.nodes };
      metaRef.current = { ...metaRef.current, ...bundle.meta };
      setDocs(docsRef.current);
      return true;
    },
    []
  );

  const open = useCallback(
    async (manifest: BoardManifest) => {
      const alive = manifest.preflop.alive_positions ?? [];
      const c: SessionCore = {
        stacks: manifest.stacks,
        nodeName: manifest.node_name,
        manifest,
        oopSeat: manifest.seats.oop ?? alive[0] ?? "OOP",
        ipSeat: manifest.seats.ip ?? alive[1] ?? "IP",
        currentNodeId: "r:0",
        line: [],
        notice: null,
        picker: null,
        pendingStreet: null,
      };
      cancelRef.current = false;
      docsRef.current = {};
      metaRef.current = {};
      setDocs({});
      setLoading(true);
      try {
        await loadStreet(c, "r.0");
      } finally {
        setLoading(false);
      }
      setCore(c);
    },
    [loadStreet]
  );

  /** Take `displayLabel` at `parentNodeId` (any visited node). Branching from
   *  a past node truncates the line there first, GTO Wizard style. */
  const pickActionAt = useCallback((parentNodeId: string, displayLabel: string) => {
    const c = coreRef.current;
    if (!c || c.pendingStreet) return;
    const parentDoc = docsRef.current[toSuffix(parentNodeId)];
    if (!parentDoc) return;

    // Line up to (and including) the branch point.
    let baseLine: PostflopLineItem[];
    if (parentNodeId === "r:0") {
      baseLine = [];
    } else {
      const idx = c.line.findIndex((item) => item.nodeId === parentNodeId);
      if (idx < 0) return; // not a visited node
      baseLine = c.line.slice(0, idx + 1);
    }
    // Land on the branch point for the notice/picker outcomes below, so a
    // dead-end pick from a past card still moves the view to that node.
    const atParent = { currentNodeId: parentNodeId, line: baseLine };

    const match = displayActionMap(
      parentDoc,
      parentNodeId,
      c.manifest.effective_stack_chips
    ).find(
      (a) => a.display === displayLabel || a.pioLabel === displayLabel
    );
    if (!match) return;

    const childId = `${parentNodeId}:${match.pioLabel}`;
    const meta = metaRef.current[toSuffix(childId)];

    if (!meta) {
      setCore({ ...c, ...atParent, notice: "This continuation was not extracted.", picker: null });
      return;
    }
    if (meta.type === "SPLIT_NODE") {
      const nextStreet = dealtCards(childId).length === 0 ? "turn" : "river";
      setCore({
        ...c,
        ...atParent,
        notice: null,
        picker: { chanceNodeId: childId, street: nextStreet },
      });
      return;
    }
    if (meta.type === "terminal") {
      setCore({
        ...c,
        ...atParent,
        picker: null,
        notice:
          match.pioLabel === "f"
            ? "Hand ends here - fold."
            : "Hand ends here - all-in and call. Runout EV browsing is coming soon.",
      });
      return;
    }
    if (!docsRef.current[toSuffix(childId)]) {
      setCore({ ...c, ...atParent, notice: "This node is missing from the street bundle.", picker: null });
      return;
    }
    setCore({
      ...c,
      currentNodeId: childId,
      line: [...baseLine, { label: displayLabel, nodeId: childId, kind: "action" }],
      notice: null,
      picker: null,
    });
  }, []);

  const clickAction = useCallback(
    (displayLabel: string) => {
      const c = coreRef.current;
      if (!c) return;
      pickActionAt(c.currentNodeId, displayLabel);
    },
    [pickActionAt]
  );

  const advanceToStreet = useCallback(
    (c: SessionCore, seedId: string, card: string, manifest: BoardManifest) => {
      setCore({
        ...c,
        manifest,
        currentNodeId: seedId,
        line: [...c.line, { label: card, nodeId: seedId, kind: "card" }],
        notice: null,
        picker: null,
        pendingStreet: null,
      });
    },
    []
  );

  const pickCard = useCallback(
    async (card: string) => {
      const c = coreRef.current;
      if (!c?.picker || c.pendingStreet) return;
      const seedId = `${c.picker.chanceNodeId}:${card}`;
      const seedSuffix = toSuffix(seedId);

      if (c.manifest.streets?.[seedSuffix]?.extracted) {
        setLoading(true);
        try {
          const ok = await loadStreet(c, seedSuffix);
          if (!ok) {
            setCore({ ...c, notice: "Could not load this street's data.", picker: null });
            return;
          }
        } finally {
          setLoading(false);
        }
        advanceToStreet(c, seedId, card, c.manifest);
        return;
      }

      // On-demand extraction: queue it and poll the manifest.
      const pending: PendingStreet = {
        seedSuffix,
        card,
        startedAt: Date.now(),
        resolving: c.manifest.streets?.[seedSuffix]?.status === "resolving",
      };
      setCore({ ...c, pendingStreet: pending, notice: null });
      try {
        await postNodeRequest({
          stacks: c.stacks,
          node: c.nodeName,
          board: c.manifest.board,
          nodeId: seedId,
        });
      } catch (err) {
        console.warn("Node request failed:", err);
        setCore({ ...coreRef.current!, pendingStreet: null, notice: "Could not queue the extraction." });
        return;
      }

      const manifest = await pollForStreet(
        c.stacks, c.nodeName, c.manifest.board, seedSuffix,
        {
          shouldStop: () => cancelRef.current,
          onResolving: () => {
            const cur = coreRef.current;
            if (cur?.pendingStreet && !cur.pendingStreet.resolving) {
              setCore({ ...cur, pendingStreet: { ...cur.pendingStreet, resolving: true } });
            }
          },
        }
      );
      const cur = coreRef.current;
      if (!cur || cancelRef.current) return;
      if (!manifest) {
        setCore({ ...cur, pendingStreet: null, notice: "The solver did not respond in time - try again later." });
        return;
      }
      const c2 = { ...cur, manifest };
      const ok = await loadStreet(c2, seedSuffix);
      if (!ok) {
        setCore({ ...c2, pendingStreet: null, notice: "Street extracted but the bundle failed to load." });
        return;
      }
      advanceToStreet(c2, seedId, card, manifest);
    },
    [advanceToStreet, loadStreet]
  );

  const closePicker = useCallback(() => {
    const c = coreRef.current;
    if (!c) return;
    setCore({ ...c, picker: null });
  }, []);

  const cancelPending = useCallback(() => {
    const c = coreRef.current;
    if (!c) return;
    cancelRef.current = true;
    // allow future picks again
    setTimeout(() => { cancelRef.current = false; }, 0);
    setCore({ ...c, pendingStreet: null, notice: "Extraction canceled - the street will still finish in the background." });
  }, []);

  const jumpTo = useCallback((nodeId: string) => {
    const c = coreRef.current;
    if (!c || c.pendingStreet) return;
    if (nodeId === "r:0") {
      setCore({ ...c, currentNodeId: "r:0", line: [], notice: null, picker: null });
      return;
    }
    const idx = c.line.findIndex((item) => item.nodeId === nodeId);
    if (idx < 0) return;
    setCore({
      ...c,
      currentNodeId: nodeId,
      line: c.line.slice(0, idx + 1),
      notice: null,
      picker: null,
    });
  }, []);

  const close = useCallback(() => {
    cancelRef.current = true;
    setCore(null);
    setDocs({});
    docsRef.current = {};
    metaRef.current = {};
  }, []);

  const view: PostflopView | null = useMemo(() => {
    if (!core) return null;
    const currentSuffix = toSuffix(core.currentNodeId);
    const currentDoc = docs[currentSuffix] ?? null;

    const board = [
      ...boardToCards(core.manifest.board),
      ...dealtCards(core.currentNodeId),
    ];

    const actorRole = currentDoc?.position === "IP" ? "ip" : "oop";
    const actorSeat = actorRole === "ip" ? core.ipSeat : core.oopSeat;
    const opponentSeat = actorRole === "ip" ? core.oopSeat : core.ipSeat;
    const opponentType = actorRole === "ip" ? "OOP_DEC" : "IP_DEC";

    // Opponent plate: nearest ancestor where they acted...
    let opponentDoc: PioSolutionDoc | null = null;
    for (let p = parentOf(core.currentNodeId); p; p = parentOf(p)) {
      const meta = metaRef.current[toSuffix(p)];
      if (meta?.type === opponentType) {
        opponentDoc = docs[toSuffix(p)] ?? null;
        break;
      }
    }
    // ...else their check-response preview (same street, already cached).
    if (!opponentDoc) {
      const previewSuffix = toSuffix(`${core.currentNodeId}:c`);
      const meta = metaRef.current[previewSuffix];
      if (meta?.type === opponentType) {
        opponentDoc = docs[previewSuffix] ?? null;
      }
    }

    // Enriched line for the Line display: each decision item carries the seat,
    // stack, and the options that were available at its decision node.
    const lineNodes: PostflopSessionLineNode[] = [];
    {
      const eff = core.manifest.effective_stack_chips;
      let parent = "r:0";
      for (const item of core.line) {
        if (item.kind === "card") {
          lineNodes.push({ kind: "card", nodeId: item.nodeId, label: item.label });
          parent = item.nodeId;
          continue;
        }
        const parentDoc = docs[toSuffix(parent)] ?? null;
        const seat =
          parentDoc?.position === "IP" ? core.ipSeat : core.oopSeat;
        lineNodes.push({
          kind: "action",
          nodeId: item.nodeId,
          parentId: parent,
          seat,
          stackBB: core.manifest.stacks_map?.[seat] ?? null,
          options: parentDoc
            ? displayActionMap(parentDoc, parent, eff).map((a) => a.display)
            : [item.label],
          taken: item.label,
        });
        parent = item.nodeId;
      }
    }

    // Picker context
    const usedCards = new Set<string>(
      core.picker ? [...boardToCards(core.manifest.board), ...dealtCards(core.picker.chanceNodeId)] : board
    );
    const extractedCards = new Set<string>();
    if (core.picker) {
      const prefix = toSuffix(core.picker.chanceNodeId) + ".";
      for (const [suffix, entry] of Object.entries(core.manifest.streets ?? {})) {
        if (entry.extracted && suffix.startsWith(prefix)) {
          const card = suffix.slice(prefix.length);
          if (!card.includes(".")) extractedCards.add(card);
        }
      }
    }

    return {
      stacks: core.stacks,
      nodeName: core.nodeName,
      board,
      oopSeat: core.oopSeat,
      ipSeat: core.ipSeat,
      manifest: core.manifest,
      currentNodeId: core.currentNodeId,
      line: core.line,
      lineNodes,
      notice: core.notice,
      picker: core.picker,
      pendingStreet: core.pendingStreet,
      extractedCards,
      usedCards,
      actorSeat,
      actorDoc: currentDoc,
      opponentSeat,
      opponentDoc,
      actions: currentDoc
        ? displayActionMap(currentDoc, core.currentNodeId, core.manifest.effective_stack_chips)
        : [],
      loading,
    };
  }, [core, docs, loading]);

  return { view, open, clickAction, pickActionAt, pickCard, closePicker, cancelPending, jumpTo, close };
}
