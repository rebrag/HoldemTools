// src/App.tsx
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./firebase";
import LoadingIndicator from "./components/LoadingIndicator";
import { AppProvider } from "./components/AppContext";
import AppShell from "./components/AppShell";
import Homepage from "./components/Homepage"; // ⬅️ new
import "./index.css";

type Section = "solver" | "equity" | "bankroll";

const readPath = (): Section => {
  if (typeof window === "undefined") return "solver";
  const seg = window.location.pathname.replace(/^\/+/, "").split("/")[0]?.toLowerCase();

  if (seg === "equity") return "equity";
  if (seg === "bankroll") return "bankroll";
  return "solver";
};

const pathFor = (section: Section) => {
  switch (section) {
    case "equity":
      return "/equity";
    case "bankroll":
      return "/bankroll";
    case "solver":
    default:
      return "/solutions";
  }
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>(() => readPath());
  const [isHome, setIsHome] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const path = window.location.pathname || "/";
    return path === "/";
  });

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
    if (typeof window === "undefined") return;
    const path = window.location.pathname || "/";

    // If we're on the root path, show the homepage and don't redirect
    if (path === "/" || path === "") {
      setIsHome(true);
      return;
    }

    setIsHome(false);

    const firstSeg = path.replace(/^\/+/, "").split("/")[0]?.toLowerCase() || "";
    const currentSection = readPath();
    setSection(currentSection);

    // keep old /solver canonicalized to /solutions
    if (firstSeg === "solver") {
      replacePathKeepSuffix("/solutions");
    }
  }, []);

  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname || "/";
      setIsHome(path === "/" || path === "");
      if (path !== "/" && path !== "") {
        setSection(readPath());
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (next: Section, replace = false) => {
    const url = pathFor(next);
    if (replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
    setIsHome(false);
    setSection(next);
  };

  const goToEquity = () => navigate("equity");
  const goToSolver = () => navigate("solver");
  const goToBankroll = () => navigate("bankroll");

  if (loading) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-300">
        <LoadingIndicator />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-grow">
        {isHome ? (
          <Homepage
            onGoToSolutions={goToSolver}
            onGoToEquity={goToEquity}
            onGoToBankroll={goToBankroll}
          />
        ) : (
          <AppProvider>
            <AppShell
              user={user}
              section={section}
              goToEquity={goToEquity}
              goToSolver={goToSolver}
              goToBankroll={goToBankroll}
            />
          </AppProvider>
        )}
      </div>
    </div>
  );

}

export default App;
