import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/api";
import { cacheHandTexts, forgetCachedHandText } from "@/lib/handTextCache";

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
  const [shareTokenById, setShareTokenById] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const res = await authedFetch("/api/handhistory");
        if (!res.ok) throw new Error(`${res.status}`);
        const rows: { id: number; rawText: string; shareToken?: string | null }[] =
          await res.json();
        if (cancelled) return;
        setById(Object.fromEntries(rows.map((r) => [r.id, r.rawText])));
        setShareTokenById(
          Object.fromEntries(
            rows.filter((r) => !!r.shareToken).map((r) => [r.id, r.shareToken as string])
          )
        );
        // The library's rows link to replays that open in a new tab; seed the
        // cache so those tabs paint immediately.
        cacheHandTexts(rows.map((r) => [String(r.id), r.rawText] as [string, string]));
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

  /** Evict one hand after it is deleted, so consumers fall back to their
   *  "hand no longer saved" state without a refetch. */
  const forget = useCallback((id: number) => {
    forgetCachedHandText(String(id));
    setById((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  return { byId, shareTokenById, loading, forget };
};

export default useHandHistoryTexts;
