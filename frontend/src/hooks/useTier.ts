// src/hooks/useTier.ts
import { useEffect, useMemo, useState } from "react";
import { getPriceIdForTier, type Tier } from "@/lib/stripe/stripeTiers";

// Which subscription statuses count as "active enough"
const ACTIVE = new Set(["active", "trialing", "past_due"]);

export function useTier(uid: string | null) {
  const [tier, setTier] = useState<Tier>("free");
  const [loading, setLoading] = useState<boolean>(!!uid);

  useEffect(() => {
    if (!uid) { setTier("free"); setLoading(false); return; }

    // Firestore is loaded on demand: this hook mounts with the app shell, and
    // a static import here would put the whole SDK on the critical path.
    let unsub: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const [{ collection, onSnapshot }, { db }] = await Promise.all([
        import("firebase/firestore"),
        import("@/lib/firestore"),
      ]);
      if (cancelled) return;

      const ref = collection(db, "customers", uid, "subscriptions");
      unsub = onSnapshot(ref, (snap) => {
        // environment price IDs
        const PLUS = getPriceIdForTier("plus");
        const PRO  = getPriceIdForTier("pro");

        let best: Tier = "free";

        snap.forEach((doc) => {
          const data = doc.data() ?? {};
          const status = String(data.status ?? "").toLowerCase();
          if (!ACTIVE.has(status)) return;

          // Try to grab price IDs from multiple shapes the Firebase ext may write
          const items = Array.isArray(data.items) ? data.items : [];
          const firstItem = items[0] ?? {};
          const nestedPrice = firstItem?.price?.id;
          const flatPrice   = data?.price?.id ?? data?.price_id;

          const candidatePriceId =
            (typeof nestedPrice === "string" && nestedPrice) ||
            (typeof flatPrice === "string" && flatPrice) ||
            "";

          // Upgrade logic: Pro > Plus > Free
          if (PRO && candidatePriceId === PRO) {
            best = "pro";
          } else if (PLUS && candidatePriceId === PLUS) {
            // only set plus if we don't already have pro
            if (best !== "pro") best = "plus";
          }
        });

        setTier(best);
        setLoading(false);
      }, () => setLoading(false));
    })().catch(() => setLoading(false));

    return () => { cancelled = true; unsub?.(); };
  }, [uid]);

  const flags = useMemo(() => ({
    isFree: tier === "free",
    isPlus: tier === "plus",
    isPro:  tier === "pro",
  }), [tier]);

  return { tier, ...flags, loading };
}
