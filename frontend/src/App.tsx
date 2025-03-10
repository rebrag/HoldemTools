// src/App.tsx
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./firebase";
import AuthForm from "./components/Login-Signup";
import MainApp from "./components/Main";
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
      <div className="text-center">
        
      </div>
    </div>
  );
}

export default App;
