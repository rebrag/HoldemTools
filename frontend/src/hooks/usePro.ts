// src/hooks/usePro.ts
import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  getFirestore,
  onSnapshot,
  query,
  where,
  DocumentData,
} from "firebase/firestore";

/** Stripe extension subscription shape (subset of fields we actually use) */
type StripeStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

export type StripeSubscription = {
  id: string;
  status?: StripeStatus;
  role?: string | null;
  price?: { id?: string; product?: string } | null;
  items?: DocumentData;
  cancel_at_period_end?: boolean;
  current_period_end?: number; // seconds since epoch
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function usePro(_uid: string | null) {
  const [loading, setLoading] = useState(true);
  const [isPro, setIsPro] = useState<boolean>(false);
  const [subscription, setSubscription] = useState<StripeSubscription | null>(null);

  useEffect(() => {
    const auth = getAuth();
    const db = getFirestore();

    let unsubSubs: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user: User | null) => {
      // Clean up previous subscription listener, if any
      if (unsubSubs) {
        unsubSubs();
        unsubSubs = null;
      }

      if (!user) {
        setIsPro(false);
        setSubscription(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      // Listen to this user's subscriptions
      const subsRef = collection(db, "customers", user.uid, "subscriptions");

      // Consider trialing/active/past_due as “Pro” (adjust as desired)
      const qy = query(
        subsRef,
        where("status", "in", ["trialing", "active", "past_due"])
      );

      unsubSubs = onSnapshot(
        qy,
        (snap) => {
          // Pick the first matching sub (or you can pick the one with the latest period_end)
          let best: StripeSubscription | null = null;

          snap.forEach((doc) => {
            const data = doc.data() as Omit<StripeSubscription, "id">;
            const sub: StripeSubscription = { id: doc.id, ...data };
            if (!best) best = sub;
            // If you want the “most recent” subscription, uncomment and compare current_period_end
            // if (!best || (sub.current_period_end ?? 0) > (best.current_period_end ?? 0)) {
            //   best = sub;
            // }
          });

          setSubscription(best);
          setIsPro(!!best); // Any matching doc makes the user Pro
          setLoading(false);
        },
        (err) => {
          console.error("[usePro] subscriptions snapshot error:", err);
          setSubscription(null);
          setIsPro(false);
          setLoading(false);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubSubs) unsubSubs();
    };
  }, []);

  return { isPro, loading, subscription };
}

export default usePro;
