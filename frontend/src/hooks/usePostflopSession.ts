import { useCallback, useMemo, useRef, useState } from "react";
import type { PioSolutionDoc } from "@/lib/solver/postflopClient";
import type { BoardManifest, ManifestNode } from "@/lib/solver/postflopLibrary";
import { fetchNodeDoc } from "@/lib/solver/postflopLibrary";
import {
  boardToCards,
  displayActionMap,
  parentOf,
  toSuffix,
} from "@/lib/solver/postflopNode";

export type PostflopLineItem = { label: string; nodeId: string };

type SessionCore = {
  stacks: string;
  nodeName: string;
  board: string[];
  oopSeat: string;
  ipSeat: string;
  manifest: BoardManifest;
  currentNodeId: string;
  line: PostflopLineItem[];
  notice: string | null;
};

export type PostflopView = {
  stacks: string;
  nodeName: string;
  board: string[];
  oopSeat: string;
  ipSeat: string;
  manifest: BoardManifest;
  currentNodeId: string;
  line: PostflopLineItem[];
  notice: string | null;
  /** Seat to act at the current node + its doc. */
  actorSeat: string;
  actorDoc: PioSolutionDoc | null;
  /** Other seat; shows their latest decision (or check-preview at the root). */
  opponentSeat: string;
  opponentDoc: PioSolutionDoc | null;
  /** Raw pio label -> display label for the current node's actions. */
  actions: { pioLabel: string; display: string }[];
  loading: boolean;
};

/**
 * Postflop navigation state machine. Completely separate from the preflop
 * plate-name machinery: nodes are addressed by Pio colon ids and resolved
 * through the board manifest; docs are fetched once and cached per suffix.
 */
export function usePostflopSession(apiBase: string) {
  const [core, setCore] = useState<SessionCore | null>(null);
  const [docs, setDocs] = useState<Record<string, PioSolutionDoc>>({});
  const [loading, setLoading] = useState(false);
  const docsRef = useRef<Record<string, PioSolutionDoc>>({});
  const coreRef = useRef<SessionCore | null>(null);
  docsRef.current = docs;
  coreRef.current = core;

  const nodeMeta = useCallback((c: SessionCore, nodeId: string): ManifestNode | undefined => {
    return c.manifest.nodes[toSuffix(nodeId)];
  }, []);

  const loadDoc = useCallback(
    async (c: SessionCore, nodeId: string): Promise<PioSolutionDoc | null> => {
      const suffix = toSuffix(nodeId);
      const cached = docsRef.current[suffix];
      if (cached) return cached;
      const doc = await fetchNodeDoc(apiBase, c.stacks, c.nodeName, c.manifest.board, nodeId);
      if (doc) {
        docsRef.current = { ...docsRef.current, [suffix]: doc };
        setDocs(docsRef.current);
      }
      return doc;
    },
    [apiBase]
  );

  /** Prefetch the check-child of a node when it is an extracted decision node
   * (used as the opponent's "preview" plate at the root). */
  const prefetchCheckChild = useCallback(
    (c: SessionCore, nodeId: string) => {
      const childId = `${nodeId}:c`;
      const meta = nodeMeta(c, childId);
      if (meta?.extracted && (meta.type === "OOP_DEC" || meta.type === "IP_DEC")) {
        void loadDoc(c, childId);
      }
    },
    [loadDoc, nodeMeta]
  );

  const open = useCallback(
    async (manifest: BoardManifest) => {
      const alive = manifest.preflop.alive_positions ?? [];
      const oopSeat = manifest.seats.oop ?? alive[0] ?? "OOP";
      const ipSeat = manifest.seats.ip ?? alive[1] ?? "IP";
      const c: SessionCore = {
        stacks: manifest.stacks,
        nodeName: manifest.node_name,
        board: boardToCards(manifest.board),
        oopSeat,
        ipSeat,
        manifest,
        currentNodeId: "r:0",
        line: [],
        notice: null,
      };
      setLoading(true);
      try {
        await loadDoc(c, "r:0");
        prefetchCheckChild(c, "r:0");
      } finally {
        setLoading(false);
      }
      setCore(c);
    },
    [loadDoc, prefetchCheckChild]
  );

  const clickAction = useCallback(
    async (displayLabel: string) => {
      const c = coreRef.current;
      if (!c) return;
      const currentDoc = docsRef.current[toSuffix(c.currentNodeId)];
      if (!currentDoc) return;

      const match = displayActionMap(currentDoc, c.currentNodeId).find(
        (a) => a.display === displayLabel || a.pioLabel === displayLabel
      );
      if (!match) return;

      const childId = `${c.currentNodeId}:${match.pioLabel}`;
      const meta = nodeMeta(c, childId);

      if (!meta) {
        setCore({ ...c, notice: "This continuation was not extracted." });
        return;
      }
      if (meta.type === "SPLIT_NODE") {
        setCore({
          ...c,
          notice:
            "Betting closes here - the turn is dealt. Turn & river browsing is coming soon.",
        });
        return;
      }
      if (meta.type === "terminal") {
        setCore({
          ...c,
          notice:
            match.pioLabel === "f"
              ? "Hand ends here - fold."
              : "Hand ends here - all-in and call. Runout EV browsing is coming soon.",
        });
        return;
      }
      if (!meta.extracted) {
        setCore({ ...c, notice: "This node is not extracted yet." });
        return;
      }

      setLoading(true);
      try {
        const doc = await loadDoc(c, childId);
        if (!doc) {
          setCore({ ...c, notice: "Could not load this node's data." });
          return;
        }
        prefetchCheckChild(c, childId);
        setCore({
          ...c,
          currentNodeId: childId,
          line: [...c.line, { label: displayLabel, nodeId: childId }],
          notice: null,
        });
      } finally {
        setLoading(false);
      }
    },
    [loadDoc, nodeMeta, prefetchCheckChild]
  );

  const jumpTo = useCallback((nodeId: string) => {
    const c = coreRef.current;
    if (!c) return;
    if (nodeId === "r:0") {
      setCore({ ...c, currentNodeId: "r:0", line: [], notice: null });
      return;
    }
    const idx = c.line.findIndex((item) => item.nodeId === nodeId);
    if (idx < 0) return;
    setCore({
      ...c,
      currentNodeId: nodeId,
      line: c.line.slice(0, idx + 1),
      notice: null,
    });
  }, []);

  const close = useCallback(() => {
    setCore(null);
    setDocs({});
    docsRef.current = {};
  }, []);

  const view: PostflopView | null = useMemo(() => {
    if (!core) return null;
    const currentSuffix = toSuffix(core.currentNodeId);
    const currentDoc = docs[currentSuffix] ?? null;

    const actorRole = currentDoc?.position === "IP" ? "ip" : "oop";
    const actorSeat = actorRole === "ip" ? core.ipSeat : core.oopSeat;
    const opponentSeat = actorRole === "ip" ? core.oopSeat : core.ipSeat;
    const opponentType = actorRole === "ip" ? "OOP_DEC" : "IP_DEC";

    // Opponent plate: nearest ancestor where they acted...
    let opponentDoc: PioSolutionDoc | null = null;
    for (let p = parentOf(core.currentNodeId); p; p = parentOf(p)) {
      const meta = core.manifest.nodes[toSuffix(p)];
      if (meta?.type === opponentType) {
        opponentDoc = docs[toSuffix(p)] ?? null;
        break;
      }
    }
    // ...else their check-response preview (e.g. r:0:c while viewing r:0).
    if (!opponentDoc) {
      const previewId = `${core.currentNodeId}:c`;
      const meta = core.manifest.nodes[toSuffix(previewId)];
      if (meta?.type === opponentType && meta.extracted) {
        opponentDoc = docs[toSuffix(previewId)] ?? null;
      }
    }

    return {
      stacks: core.stacks,
      nodeName: core.nodeName,
      board: core.board,
      oopSeat: core.oopSeat,
      ipSeat: core.ipSeat,
      manifest: core.manifest,
      currentNodeId: core.currentNodeId,
      line: core.line,
      notice: core.notice,
      actorSeat,
      actorDoc: currentDoc,
      opponentSeat,
      opponentDoc,
      actions: currentDoc ? displayActionMap(currentDoc, core.currentNodeId) : [],
      loading,
    };
  }, [core, docs, loading]);

  return { view, open, clickAction, jumpTo, close };
}
