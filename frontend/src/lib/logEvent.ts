/* eslint-disable @typescript-eslint/no-unused-vars */
// logEvent.ts
// import { db } from './firebase';
// import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export async function logUserAction(_userId: string | null | undefined, _action: string, _target: string) {
  // try {
  //   if (!userId) return;
  //   await addDoc(collection(db, 'user_logs'), {
  //     userId,
  //     action,
  //     target,
  //     timestamp: serverTimestamp(),
  //   });
  // } catch (error) {
  //   console.error('Error logging user action:', error);
  // }
  return;
}
