// src/hooks/useTier.ts
import { useEffect, useMemo, useState } from "react";
import { getPriceIdForTier, type Tier } from "@/lib/stripe/stripeTiers";

// Which subscription statuses count as "active enough"
const ACTIVE = new Set(["active", "trialing", "past_due"]);

/* Every failure path below resolves to "free", which downstream reads as
   "not subscribed" and locks the paid tools - indistinguishable, from the
   UI alone, from a genuinely free account. In dev that silence has cost
   real debugging time, so each path announces itself once. */
let warnedMissingPriceIds = false;
const devWarn = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.warn("[useTier]", ...args);
};

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

        if ((!PLUS || !PRO) && !warnedMissingPriceIds) {
          warnedMissingPriceIds = true;
          const missing = [
            !PRO && "VITE_STRIPE_PRICE_ID_PRO",
            !PLUS && "VITE_STRIPE_PRICE_ID_PLUS",
          ].filter(Boolean).join(" and ");
          devWarn(`${missing} unset - no subscription can resolve to that tier.`);
        }

        let best: Tier = "free";
        const activePriceIds: string[] = [];

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
          activePriceIds.push(candidatePriceId || "(no price id found on doc)");

          // Upgrade logic: Pro > Plus > Free
          if (PRO && candidatePriceId === PRO) {
            best = "pro";
          } else if (PLUS && candidatePriceId === PLUS) {
            // only set plus if we don't already have pro
            if (best !== "pro") best = "plus";
          }
        });

        if (best === "free" && activePriceIds.length > 0) {
          devWarn(
            `uid=${uid} has ${activePriceIds.length} active subscription(s) ` +
            `(price ids: ${activePriceIds.join(", ")}) but none match ` +
            `VITE_STRIPE_PRICE_ID_PRO (${JSON.stringify(PRO)}) or ` +
            `_PLUS (${JSON.stringify(PLUS)}) - resolving to "free".`
          );
        }

        setTier(best);
        setLoading(false);
      }, (err) => {
        devWarn(`Firestore subscriptions listener for uid=${uid} failed - tier stays "free":`, err);
        setLoading(false);
      });
    })().catch((err) => {
      devWarn(`loading Firestore for uid=${uid} failed - tier stays "free":`, err);
      setLoading(false);
    });

    return () => { cancelled = true; unsub?.(); };
  }, [uid]);

  const flags = useMemo(() => ({
    isFree: tier === "free",
    isPlus: tier === "plus",
    isPro:  tier === "pro",
  }), [tier]);

  return { tier, ...flags, loading };
}
