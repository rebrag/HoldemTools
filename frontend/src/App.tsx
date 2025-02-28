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

  let content;
  if (!user) {
    content = <AuthForm />;
  } else if (!user.emailVerified) {
    content = <VerifyEmailPrompt />;
  } else {
    content = <MainApp />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-grow">{content}</div>
      <footer className="text-center mb-4">
        © Josh Garber 2025
      </footer>
    </div>
  );
}

export default App;
