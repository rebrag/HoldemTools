import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./firebase";
import LoadingIndicator from "./components/LoadingIndicator";
import { AppProvider } from "./components/AppContext";
import AppShell from "./components/AppShell";
import "./index.css";

type Section = "solver" | "equity";

const readPath = (): Section => {
  if (typeof window === "undefined") return "solver";
  const seg = window.location.pathname.replace(/^\/+/, "").split("/")[0]?.toLowerCase();

  if (seg === "equity") return "equity";
  return "solver";
};

const pathFor = (section: Section) => {
  switch (section) {
    case "equity":
      return "/equity";
    case "solver":
    default:
      return "/solutions";
  }
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>(() => readPath());

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const replacePathKeepSuffix = (newPath: string) => {
    const { search, hash } = window.location;
    window.history.replaceState({}, "", `${newPath}${search}${hash}`);
  };

  useEffect(() => {
    const currentSection = readPath();
    setSection(currentSection);

    const path = window.location.pathname;
    const firstSeg = path.replace(/^\/+/, "").split("/")[0]?.toLowerCase() || "";

    if (path === "/" || path === "") {
      replacePathKeepSuffix(pathFor(currentSection));
      return;
    }

    if (firstSeg === "solver") {
      replacePathKeepSuffix("/solutions");
    }
  }, []);

  useEffect(() => {
    const onPop = () => setSection(readPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (next: Section, replace = false) => {
    const url = pathFor(next);
    if (replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
    setSection(next);
  };

  const goToEquity = () => {
    navigate("equity");
  };
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
