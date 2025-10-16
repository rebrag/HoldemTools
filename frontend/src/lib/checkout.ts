// lib/checkout.ts
import { addDoc, collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { auth } from '../firebase';

export async function startSubscriptionCheckout(priceId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in');

  // Create a new Checkout Session
  const csRef = await addDoc(
    collection(doc(db, 'customers', user.uid), 'checkout_sessions'),
    {
      price: priceId,
      mode: 'subscription',
      allow_promotion_codes: true,
      success_url: `${window.location.origin}/account?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${window.location.origin}/pricing`,
    }
  );

  // Wait for the extension to populate the session URL, then redirect
  return new Promise<void>((resolve, reject) => {
    const unsub = onSnapshot(csRef, (snap) => {
      const data = snap.data();
      if (!data) return;
      if (data.error) {
        unsub();
        reject(new Error(data.error.message ?? 'Checkout failed'));
      }
      if (data.url) {
        unsub();
        window.location.assign(data.url);
        resolve();
      }
    });
  });
}
