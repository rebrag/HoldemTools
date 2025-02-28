import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase";

interface UserData {
  email: string;
  subscription: string;
}

const TestFirestore = () => {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userDocRef = doc(db, "users", user.uid);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            setUserData(userDoc.data() as UserData);
          } else {
            const newUserData: UserData = { email: user.email ?? "", subscription: "inactive" };
            await setDoc(userDocRef, newUserData);
            setUserData(newUserData);
          }
        } catch (err: unknown) {
          if (err instanceof Error) {
            setError(err.message);
          } else {
            setError(String(err));
          }
        }
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <div>
      <h2>Testing Firestore Access</h2>
      {error && <p style={{ color: "red" }}>Error: {error}</p>}
      {userData ? (
        <pre>{JSON.stringify(userData, null, 2)}</pre>
      ) : (
        <p>No user data found. Please log in.</p>
      )}
    </div>
  );
};

export default TestFirestore;
