import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./firebase";
import LoadingIndicator from "./components/LoadingIndicator";
import { AppProvider } from "./components/AppContext";
import AppShell from "./components/AppShell";
import "./index.css";

type Section = "solver" | "equity";

/** Map the first path segment to a Section. Default: solver. */
const readPath = (): Section => {
  if (typeof window === "undefined") return "solver";
  const seg = window.location.pathname.replace(/^\/+/, "").split("/")[0]?.toLowerCase();

  // accept either /solutions (new) or /solver (legacy) for the solver section
  if (seg === "equity") return "equity";
  return "solver";
};

/** Build a URL path for a section (canonical paths). */
const pathFor = (section: Section) => {
  switch (section) {
    case "equity":
      return "/equity";
    case "solver":
    default:
      return "/solutions"; // NEW canonical route
  }
};

function App() {
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

  // Helper: replace the path but keep query & hash
  const replacePathKeepSuffix = (newPath: string) => {
    const { search, hash } = window.location;
    window.history.replaceState({}, "", `${newPath}${search}${hash}`);
  };

  // On first mount:
  // 1) normalize root → canonical path ("/" → "/solutions")
  // 2) redirect legacy "/solver" → "/solutions" (keep search/hash)
  useEffect(() => {
    const currentSection = readPath();
    setSection(currentSection);

    const path = window.location.pathname;
    const firstSeg = path.replace(/^\/+/, "").split("/")[0]?.toLowerCase() || "";

    if (path === "/" || path === "") {
      // Put canonical section path in URL without adding history
      replacePathKeepSuffix(pathFor(currentSection));
      return;
    }

    // Legacy redirect: /solver -> /solutions
    if (firstSeg === "solver") {
      replacePathKeepSuffix("/solutions");
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

  const goToEquity = () => {
    navigate("equity");
  };
  // keep the prop name but point to /solutions
  const goToSolver = () => {
    navigate("solver");
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
