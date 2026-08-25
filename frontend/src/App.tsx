import { lazy, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { getRedirectResult, onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import LoadingIndicator from "@/components/LoadingIndicator";
import OrientationGate from "@/components/OrientationGate";
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
const PlayersPage = lazy(routeImports["/hand-history/players"]);
const EditHandHistory = lazy(routeImports["/hand-history/edit"]);
const HandReplay = lazy(routeImports["/hand-history/replay"]);
const Course = lazy(routeImports["/course"]);
const CourseSection = lazy(routeImports["/course/section"]);
const PrivatePage = lazy(routeImports["/private"]);
// Hidden solver-verification page: no NavBar entry, reachable only by URL.
const SolverCompare = lazy(routeImports["/compare"]);
import { DEV_AUTH_BYPASS, useDevAuthUser } from "@/lib/devAuth";
import "./index.css";

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Dev-only: a dummy user that the login/logout flows toggle (null in prod and
  // when signed out). Kept above the early return so the hook runs every render.
  const devUser = useDevAuthUser();

  useEffect(() => {
    // Mobile signs in via signInWithRedirect (see lib/firebase.ts), which lands
    // back here after the Google round trip. The session completes on its own
    // through onAuthStateChanged; this call exists because it is the only place
    // a redirect sign-in ERROR is ever reported. Resolves null on ordinary
    // loads, so it is free when there is no round trip to finish.
    getRedirectResult(auth).catch((e) => {
      console.error("Google sign-in (redirect) failed:", e);
    });
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

  // A shared replay is public: it resolves through the anonymous
  // /api/shared/{token} endpoint and renders the same view for everyone, so
  // it must not sit behind Firebase restoring a session it will never use.
  // Reading location directly (rather than useLocation) keeps this above the
  // Router and costs nothing - a shared link is always a fresh document load.
  const isPublicRoute =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/hand-history/shared/");

  if (loading && !isPublicRoute) {
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
              path="/hand-history/players"
              element={<PlayersPage user={effectiveUser} />}
            />
            <Route
              path="/hand-history/edit/:key"
              element={<EditHandHistory user={effectiveUser} />}
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
            <Route path="/private" element={<PrivatePage user={effectiveUser} />} />
            <Route path="/compare" element={<SolverCompare />} />
          </Route>
        </Routes>
      </div>
      {/* Portrait "lock": blocks the UI while a phone is held landscape. */}
      <OrientationGate />
    </div>
  );
}

export default App;
