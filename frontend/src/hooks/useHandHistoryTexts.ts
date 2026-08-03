import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api";

/**
 * The signed-in user's saved hands, indexed by id -> rawText.
 *
 * One list request rather than one request per id: the solved-flops library
 * needs the text of every hand behind a solved board, and the hand-history
 * page already pays exactly this call. Fetched lazily (`enabled`) so opening
 * the solver page does not download hands nobody is going to look at.
 *
 * rawText is the whole record - the human-readable history plus the embedded
 * replay payload - which is what <HandPreview rawText> needs to draw cards.
 */
const useHandHistoryTexts = (enabled: boolean) => {
  const [byId, setById] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const res = await authedFetch("/api/handhistory");
        if (!res.ok) throw new Error(`${res.status}`);
        const rows: { id: number; rawText: string }[] = await res.json();
        if (cancelled) return;
        setById(Object.fromEntries(rows.map((r) => [r.id, r.rawText])));
      } catch (err) {
        // Non-fatal: the library still lists the boards, just without a
        // preview of the hand that produced them.
        if (!cancelled) console.warn("Could not load hand histories for previews", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { byId, loading };
};

export default useHandHistoryTexts;
