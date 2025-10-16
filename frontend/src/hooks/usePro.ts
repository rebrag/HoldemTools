// /* eslint-disable @typescript-eslint/no-explicit-any */
// // hooks/usePro.ts
// import { useEffect, useState } from 'react';
// import { auth, db } from '../firebase';
// import { collection, onSnapshot, doc } from 'firebase/firestore';

// export function usePro() {
//   const [isPro, setIsPro] = useState<boolean | null>(null);
//   const [sub, setSub] = useState<any>(null);

//   useEffect(() => {
//     const uid = auth.currentUser?.uid;
//     if (!uid) { setIsPro(false); setSub(null); return; }

//     const ref = collection(doc(db, 'customers', uid), 'subscriptions');
//     const unsub = onSnapshot(ref, (snap) => {
//       const active = snap.docs
//         .map(d => ({ id: d.id, ...d.data() }))
//         .find(s => ['active', 'trialing'].includes(s.status));
//       setSub(active ?? null);
//       setIsPro(Boolean(active));
//     });
//     return unsub;
//   // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [auth.currentUser?.uid]);

//   return { isPro, subscription: sub };
// }
