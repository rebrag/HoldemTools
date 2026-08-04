import { lazy, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import LoadingIndicator from "@/components/LoadingIndicator";
import { AppProvider } from "@/components/AppContext";
import AppShell from "@/components/layout/AppShell";
// Route components are code-split (React.lazy) so each page ships its own chunk
// instead of loading the whole app up front. AppShell/NavBar stay eager so the
// shell paints immediately; a <Suspense> inside AppShell covers the page area.
//
// The importers come from routeImports so NavBar can warm the same chunk on
// hover — a preload and the lazy render then share one module-registry entry.
import { routeImports } from "@/lib/routePreload";

const Homepage = lazy(routeImports["/"]);
const Solver = lazy(routeImports["/solutions"]);
const EquityCalc = lazy(routeImports["/equity"]);
const BankrollTracker = lazy(routeImports["/bankroll"]);
const HandHistoryTool = lazy(routeImports["/hand-history"]);
const CreateHandHistory = lazy(routeImports["/hand-history/create"]);
const HandReplay = lazy(routeImports["/hand-history/replay"]);
const Course = lazy(routeImports["/course"]);
const CourseSection = lazy(routeImports["/course/section"]);
import { DEV_AUTH_BYPASS, useDevAuthUser } from "@/lib/devAuth";
import "./index.css";

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Dev-only: a dummy user that the login/logout flows toggle (null in prod and
  // when signed out). Kept above the early return so the hook runs every render.
  const devUser = useDevAuthUser();

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      // In dev bypass mode the dummy auth owns login state; don't let a lingering
      // real Firebase session bleed in — sign it out so "logout" truly logs out.
      if (DEV_AUTH_BYPASS && u) {
        signOut(auth).catch(() => {});
        setUser(null);
        setLoading(false);
        return;
      }
      setUser(u);
      setLoading(false);
    });
  }, []);

  // Site-wide: when a field with existing text is focused, highlight its
  // contents so it's easy to overwrite. Registered once at the document level
  // (focusin bubbles, so this also covers inputs rendered inside modals/portals).
  useEffect(() => {
    const TYPES_TO_SKIP = new Set([
      "checkbox", "radio", "range", "color", "file",
      "date", "datetime-local", "month", "week", "time",
      "button", "submit", "reset", "image",
    ]);
    const handleFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      const isTextArea = el instanceof HTMLTextAreaElement;
      const isInput = el instanceof HTMLInputElement;
      if (!isTextArea && !isInput) return;
      if (isInput && TYPES_TO_SKIP.has(el.type)) return;
      if (!el.value) return; // nothing to highlight
      // Defer so mobile Safari doesn't clear the selection on the trailing tap.
      requestAnimationFrame(() => {
        try {
          el.select();
        } catch {
          /* some input types disallow select() */
        }
      });
    };
    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, []);

  if (loading) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-300">
        <LoadingIndicator />
      </div>
    );
  }

  // In dev bypass, the dummy auth is authoritative (real sessions are cleared
  // above); otherwise use the real Firebase user.
  const effectiveUser = DEV_AUTH_BYPASS ? devUser : user;

  return (
    <div className="min-h-dvh flex flex-col">
      <div className="flex-grow">
        <Routes>
          <Route path="/solver" element={<Navigate to="/solutions" replace />} />
          <Route
            element={
              <AppProvider>
                <AppShell user={effectiveUser} />
              </AppProvider>
            }
          >
            <Route path="/" element={<Homepage />} />
            <Route path="/solutions" element={<Solver user={effectiveUser} />} />
            <Route path="/equity" element={<EquityCalc />} />
            <Route path="/bankroll" element={<BankrollTracker user={effectiveUser} />} />
            <Route path="/hand-history" element={<HandHistoryTool user={effectiveUser} />} />
            <Route
              path="/hand-history/create"
              element={<CreateHandHistory user={effectiveUser} />}
            />
            <Route
              path="/hand-history/advanced"
              element={<Navigate to="/hand-history/create" replace />}
            />
            <Route
              path="/hand-history/replay/:key"
              element={<HandReplay user={effectiveUser} />}
            />
            <Route
              path="/hand-history/shared/:token"
              element={<HandReplay user={effectiveUser} shared />}
            />
            <Route path="/course" element={<Course user={effectiveUser} />} />
            <Route path="/course/:sectionId" element={<CourseSection user={effectiveUser} />} />
          </Route>
        </Routes>
      </div>
    </div>
  );
}

export default App;
