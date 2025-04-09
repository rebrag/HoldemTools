// logEvent.ts
import { db, timestamp } from './firebase';
import { collection, addDoc } from 'firebase/firestore';

export async function logUserAction(userId: string, action: string, target: string) {
  try {
    await addDoc(collection(db, 'user_logs'), {
      userId,
      action,
      target,
      timestamp: timestamp(),
    });
  } catch (error) {
    console.error('Error logging user action:', error);
  }
}
