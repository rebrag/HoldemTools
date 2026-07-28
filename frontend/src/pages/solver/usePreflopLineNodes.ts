// Reconstructs the preflop nodes visited along a line so the postflop Line
// can render GTO Wizard style cards: for each preflop action, the seat that
// acted, their stack when acting, the options that were available at that
// node, and which one was taken.
//
// Node plate files are deterministic ("root.json", then dot-joined action
// numbers), so the nodes can be re-fetched for any folder + line - including
// sessions opened from the solved-flops library where the preflop tree was
// never navigated in this pageload.
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { getActionNumber } from "@/lib/solver/constants";
import type { JsonData } from "@/lib/solver/utils";

export interface PreflopLineNode {
  seat: string;
  /** Stack when acting: starting stack minus chips already committed. */
  stackBB: number;
  /** Actions available at the node, in the plate's display order. */
  options: string[];
  /** The action this line took at the node. */
  taken: string;
}

export interface PreflopLineReplay {
  nodes: PreflopLineNode[];
  /**
   * What every seat had in the pot when the line ended, in bb - blinds
   * included, so seats that folded still account for the chips they posted.
   * Seats that never put anything in are absent.
   */
  committed: Record<string, number>;
}

/** Same option derivation the preflop Line uses for a seat's plate. */
const nodeOptions = (data: JsonData): string[] => {
  const acts = Object.keys(data)
    .filter((k) => k !== "Position" && k !== "bb")
    .map((k) => (k === "c" ? "Call" : k));
  return Array.from(new Set(acts));
};

/**
 * Filenames of the nodes visited along the line ("Root" excluded): file `i` is
 * the node at which `actions[i]` was taken. Null when the line contains a
 * label with no action number, i.e. the line cannot be reconstructed.
 */
export const preflopNodeFiles = (actions: string[]): string[] | null => {
  const nums: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < actions.length; i++) {
    files.push(i === 0 ? "root.json" : `${nums.join(".")}.json`);
    const num = getActionNumber(actions[i]);
    if (num == null) return null; // unknown action label - cannot reconstruct
    nums.push(num);
  }
  return files;
};

export function usePreflopLineNodes(
  apiBaseUrl: string,
  folder: string | null,
  line: string[] | null,
  ante = 0
): PreflopLineReplay | null {
  const actions = useMemo(
    () => (line && line.length > 1 ? line.slice(line[0] === "Root" ? 1 : 0) : null),
    [line]
  );
  const files = useMemo(
    () => (actions ? preflopNodeFiles(actions) : null),
    [actions]
  );

  const [docs, setDocs] = useState<{ key: string; data: (JsonData | null)[] } | null>(null);
  const key = folder && files ? `${folder}|${files.join(",")}` : null;

  useEffect(() => {
    if (!key || !folder || !files) return;
    let cancelled = false;
    Promise.all(
      files.map((file) =>
        axios
          .get<JsonData>(`${apiBaseUrl}/api/Files/${folder}/${file}`)
          .then((res) => res.data)
          .catch(() => null)
      )
    ).then((data) => {
      if (!cancelled) setDocs({ key, data });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, apiBaseUrl]);

  return useMemo(() => {
    if (!actions || !docs || docs.key !== key) return null;

    /* Replay the betting to know each seat's committed chips when acting.
     * Mirrors handleActionClickImpl's bet math. Blinds: heads-up sims seat
     * BTN + BB (BTN posts the small blind); otherwise SB + BB. */
    const nodes: PreflopLineNode[] = [];
    const committed: Record<string, number> = {};
    const seats = new Set(docs.data.filter(Boolean).map((d) => d!.Position));
    if (seats.has("SB")) committed["SB"] = 0.5;
    else committed["BTN"] = 0.5;
    committed["BB"] = 1;
    let pot = 1.5 + ante;
    let maxBet = 1;

    for (let i = 0; i < actions.length; i++) {
      const data = docs.data[i];
      if (!data) return null; // a node failed to load - fall back entirely
      const seat = data.Position;
      const stack = data.bb ?? 0;
      const before = committed[seat] ?? 0;
      const action = actions[i];

      nodes.push({
        seat,
        stackBB: stack - before,
        options: nodeOptions(data),
        taken: action,
      });

      let newBet = before;
      if (action === "Min") newBet = 2;
      else if (action === "ALLIN") newBet = stack;
      else if (action.startsWith("Raise ")) {
        const val = action.split(" ")[1];
        newBet = val.endsWith("bb")
          ? maxBet + parseFloat(val)
          : maxBet + (parseFloat(val) / 100) * (pot + maxBet);
      } else if (action === "Call") newBet = Math.min(maxBet, stack);

      pot += Math.max(0, newBet - before);
      committed[seat] = newBet;
      maxBet = Math.max(maxBet, newBet);
    }
    return { nodes, committed };
  }, [actions, docs, key, ante]);
}
