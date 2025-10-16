// lib/stripeProducts.ts
import { collection, getDocs, query, where, doc, collectionGroup } from 'firebase/firestore';
import { db } from '../firebase';

// Load all active products with their active prices
export async function loadActiveProducts() {
  const productsSnap = await getDocs(
    query(collection(db, 'products'), where('active', '==', true))
  );

  const products: Array<{
    id: string;
    name: string;
    description?: string;
    prices: Array<{ id: string; unit_amount: number; currency: string; interval?: string }>;
  }> = [];

  for (const p of productsSnap.docs) {
    const priceSnap = await getDocs(
      query(collection(db, `products/${p.id}/prices`), where('active', '==', true))
    );
    products.push({
      id: p.id,
      name: p.get('name'),
      description: p.get('description'),
      prices: priceSnap.docs.map(d => ({
        id: d.id,
        unit_amount: d.get('unit_amount'),
        currency: d.get('currency'),
        interval: d.get('interval'),
      })),
    });
  }
  return products;
}
