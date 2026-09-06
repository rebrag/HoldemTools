import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/api";
import { cacheHandTexts, forgetCachedHandText } from "@/lib/handTextCache";
import type { HandHistory } from "@/pages/handhistory/types";

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
 *
 * `rows` is the same response as the API returned it, for consumers that need
 * more than the text (the player editor sorts by createdAt). Null until the
 * first response lands, so "not loaded yet" and "no hands" stay distinct.
 */
const useHandHistoryTexts = (enabled: boolean) => {
  const [rows, setRows] = useState<HandHistory[] | null>(null);
  const [byId, setById] = useState<Record<number, string>>({});
  const [shareTokenById, setShareTokenById] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await authedFetch("/api/handhistory");
        if (!res.ok) throw new Error(`${res.status}`);
        const data: HandHistory[] = await res.json();
        if (cancelled) return;
        setRows(data);
        setById(Object.fromEntries(data.map((r) => [r.id, r.rawText])));
        setShareTokenById(
          Object.fromEntries(
            data.filter((r) => !!r.shareToken).map((r) => [r.id, r.shareToken as string])
          )
        );
        // The library's rows link to replays that open in a new tab; seed the
        // cache so those tabs paint immediately.
        cacheHandTexts(data.map((r) => [String(r.id), r.rawText] as [string, string]));
      } catch (err) {
        // Non-fatal: the library still lists the boards, just without a
        // preview of the hand that produced them.
        if (!cancelled) {
          console.warn("Could not load hand histories for previews", err);
          setFailed(true);
        }
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
    setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    setById((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  return { rows, byId, shareTokenById, loading, failed, forget };
};

export default useHandHistoryTexts;
