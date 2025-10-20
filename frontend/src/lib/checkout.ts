import { db } from "../firebase";
import { collection, addDoc, onSnapshot } from "firebase/firestore";

type StartCheckoutOpts = {
  uid: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  allowPromotionCodes?: boolean;
};

export async function startSubscriptionCheckout({
  uid,
  priceId,
  successUrl,
  cancelUrl,
  allowPromotionCodes = true,
}: StartCheckoutOpts): Promise<void> {
  // Create a new Checkout Session doc under customers/{uid}/checkout_sessions
  const ref = await addDoc(
    collection(db, "customers", uid, "checkout_sessions"),
    {
      mode: "subscription",
      price: priceId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: allowPromotionCodes,
      client: "web",
    }
  );

  // Listen for the extension to write back the session URL or sessionId
  return new Promise((resolve, reject) => {
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data();
      if (!data) return;

      // Surface extension errors if present
      if (data.error?.message) {
        unsub();
        reject(new Error(data.error.message));
        return;
      }

      // Prefer 'url' (works without Stripe.js); fallback to sessionId
      if (data.url) {
        unsub();
        window.location.assign(data.url);
        resolve();
      } else if (data.sessionId) {
        // If you want to use Stripe.js instead, use Option B below
        // and call stripe.redirectToCheckout({ sessionId: data.sessionId })
      }
    });
  });
}
