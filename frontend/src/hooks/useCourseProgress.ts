import { useState, useEffect, useCallback } from "react";
import { doc, onSnapshot, setDoc, arrayUnion, arrayRemove, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firestore";

type CourseProgressResult = {
  completedSections: Set<number>;
  loading: boolean;
  markComplete: (sectionId: number) => Promise<void>;
  resetComplete: (sectionId: number) => Promise<void>;
};

export function useCourseProgress(uid: string | null): CourseProgressResult {
  const [completedSections, setCompletedSections] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(!!uid);

  useEffect(() => {
    if (!uid) {
      setCompletedSections(new Set());
      setLoading(false);
      return;
    }

    const ref = doc(db, "courseProgress", uid);
    const unsubscribe = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const sections: number[] = snap.data().completedSections ?? [];
        setCompletedSections(new Set(sections));
      } else {
        setCompletedSections(new Set());
      }
      setLoading(false);
    }, () => setLoading(false));

    return unsubscribe;
  }, [uid]);

  const markComplete = useCallback(async (sectionId: number) => {
    if (!uid) return;
    await setDoc(
      doc(db, "courseProgress", uid),
      { completedSections: arrayUnion(sectionId), updatedAt: serverTimestamp() },
      { merge: true }
    );
  }, [uid]);

  const resetComplete = useCallback(async (sectionId: number) => {
    if (!uid) return;
    await setDoc(
      doc(db, "courseProgress", uid),
      { completedSections: arrayRemove(sectionId), updatedAt: serverTimestamp() },
      { merge: true }
    );
  }, [uid]);

  return { completedSections, loading, markComplete, resetComplete };
}
