// src/lib/checkoutDirect.ts
import { getFunctions, httpsCallable } from "firebase/functions";

/**
 * Fast path to Stripe Checkout:
 * Calls your Cloud Function "createCheckoutSession" and redirects immediately.
 *
 * Requires you to have deployed a callable named "createCheckoutSession"
 * that returns { url: string }.
 *
 * Env:
 *   VITE_STRIPE_PRICE_ID = your recurring price id (e.g. price_123)
 */
export async function startSubscriptionCheckoutDirect(params?: {
  priceId?: string;
  successUrl?: string;
  cancelUrl?: string;
}) {
  const priceId = params?.priceId ?? import.meta.env.VITE_STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error("Missing Stripe price id. Set VITE_STRIPE_PRICE_ID.");
  }

  const successUrl =
    params?.successUrl ?? `${window.location.origin}/success`;
  const cancelUrl =
    params?.cancelUrl ?? `${window.location.origin}/billing`;

  const fn = httpsCallable(getFunctions(), "createCheckoutSession");
  const res = await fn({ priceId, successUrl, cancelUrl });
  const data = (res.data || {}) as { url?: string };

  if (!data.url) throw new Error("Failed to create checkout session");
  window.location.href = data.url;
}
