// src/App.tsx
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./firebase";
import AuthForm from "./components/AuthForm";
import MainApp from "./components/MainApp";
import VerifyEmailPrompt from "./components/VerifyEmailPrompt";

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) return <div>Loading...</div>;

  if (!user) {
    return <AuthForm />;
  }

  if (user && !user.emailVerified) {
    return <VerifyEmailPrompt />;
  }

  return <MainApp />;
}

export default App;
