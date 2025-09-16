import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./firebase";
import LoadingIndicator from "./components/LoadingIndicator";
import { AppProvider } from "./components/AppContext";
import AppShell from "./components/AppShell";
import { useDisableMobileGestures } from "./hooks/useDisableMobileGestures";

type Section = "solver" | "equity";

/** Read the current section from the URL path (e.g., /solver, /equity). Default: solver. */
const readPath = (): Section => {
  if (typeof window === "undefined") return "solver";
  // Grab first non-empty segment
  const seg = window.location.pathname.replace(/^\/+/, "").split("/")[0]?.toLowerCase();
  return seg === "equity" ? "equity" : "solver";
};

/** Build a URL path for a section. If you deploy under a subpath, prepend it here. */
const pathFor = (section: Section) => `/${section}`;

function App() {

  
  useDisableMobileGestures();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // SECTION STATE (synced with path, not hash)
  const [section, setSection] = useState<Section>(() => readPath());

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // On first mount, ensure the URL is a clean section path. If at root "/", rewrite to default.
  useEffect(() => {
    const current = readPath();
    setSection(current);
    const isRoot = window.location.pathname === "/" || window.location.pathname === "";
    if (isRoot) {
      // Put /solver (or /equity) in the URL without adding a history entry
      window.history.replaceState({}, "", pathFor(current));
    }
  }, []);

  // Keep state in sync with back/forward navigation
  useEffect(() => {
    const onPop = () => setSection(readPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Navigation handlers (update path + state immediately)
  const navigate = (next: Section, replace = false) => {
    const url = pathFor(next);
    if (replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
    setSection(next);
  };

  const goToEquity = () => { console.log("goToEquity"); navigate("equity"); };
  const goToSolver = () => { console.log("goToSolver"); navigate("solver"); };
  


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
