import { useEffect, useMemo, useState } from "react";
import { POSTFLOP_ENABLED } from "@/lib/solver/constants";
import {
  fetchPostflopIndex,
  type PostflopIndexEntry,
} from "@/lib/solver/postflopLibrary";

/**
 * The signed-in user's solved boards, indexed by the recorded hand behind
 * them: hand id -> the newest solved-flops index entry for that hand.
 *
 * Reads the same per-viewer overlaid index the solved-flops library uses, so
 * ownership filtering and hidden boards are already applied server-side - a
 * hand appears here exactly when its solution is openable. Errors are
 * swallowed: the map is a silent enhancement (a "view solution" button), and
 * without it pages behave exactly as before.
 */
const useHandSolutions = (enabled: boolean) => {
  const [entries, setEntries] = useState<PostflopIndexEntry[]>([]);

  useEffect(() => {
    if (!enabled || !POSTFLOP_ENABLED) {
      setEntries([]);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const index = await fetchPostflopIndex();
        if (!cancelled) setEntries(index?.entries ?? []);
      } catch (err) {
        if (!cancelled) console.warn("Could not load solved boards for hand links", err);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return useMemo(() => {
    const byHandId: Record<number, PostflopIndexEntry> = {};
    for (const e of entries) {
      if (e.source !== "handHistory" || typeof e.hand_history_id !== "number") continue;
      const existing = byHandId[e.hand_history_id];
      if (!existing || e.created_utc.localeCompare(existing.created_utc) > 0) {
        byHandId[e.hand_history_id] = e;
      }
    }
    return byHandId;
  }, [entries]);
};

export default useHandSolutions;
