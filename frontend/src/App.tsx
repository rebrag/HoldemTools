import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./firebase";
import LoadingIndicator from "./components/LoadingIndicator";
import { AppProvider } from "./components/AppContext";
import AppShell from "./components/AppShell";

type Section = "solver" | "equity";

// Helper to read #solver / #equity (default: solver)
const readHash = (): Section => {
  if (typeof window === "undefined") return "solver";
  const h = window.location.hash.replace("#", "").toLowerCase();
  return h === "equity" ? "equity" : "solver";
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // SECTION STATE (synced with hash)
  const [section, setSection] = useState<Section>(readHash);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Keep state in sync if the hash changes (e.g., back/forward)
  useEffect(() => {
    const onHash = () => setSection(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Navigation handlers (update hash + state immediately)
  const goToSolver = () => {
    if (window.location.hash !== "#solver") window.location.hash = "solver";
    setSection("solver");
    // console.log("→ section: solver");
  };
  const goToEquity = () => {
    if (window.location.hash !== "#equity") window.location.hash = "equity";
    setSection("equity");
    // console.log("→ section: equity");
  };

  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center z-10 transition-opacity duration-300">
        <LoadingIndicator />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-grow">
        <AppProvider>
          <AppShell
            user={user}
            section={section}
            goToEquity={goToEquity}
            goToSolver={goToSolver}
          />
        </AppProvider>
      </div>
    </div>
  );
}

export default App;
