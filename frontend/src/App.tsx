import { lazy, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import LoadingIndicator from "@/components/LoadingIndicator";
import { AppProvider } from "@/components/AppContext";
import AppShell from "@/components/layout/AppShell";
// Route components are code-split (React.lazy) so each page ships its own chunk
// instead of loading the whole app up front. AppShell/NavBar stay eager so the
// shell paints immediately; a <Suspense> inside AppShell covers the page area.
const Homepage = lazy(() => import("@/pages/home/Homepage"));
const Solver = lazy(() => import("@/pages/solver/Solver"));
const EquityCalc = lazy(() => import("@/pages/equity/EquityCalc"));
const BankrollTracker = lazy(() => import("@/pages/bankroll/BankrollTracker"));
const HandHistoryTool = lazy(() => import("@/pages/handhistory/HandHistoryTool"));
const CreateHandHistory = lazy(() => import("@/pages/handhistory/create/CreateHandHistory"));
const HandReplay = lazy(() => import("@/pages/handhistory/HandReplay"));
const Course = lazy(() => import("@/pages/course/Course"));
const CourseSection = lazy(() => import("@/pages/course/CourseSection"));
import { DEV_AUTH_BYPASS, mockDevUser } from "@/lib/devAuth";
import "./index.css";

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
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

  // Dev-only: stand in a mock signed-in user when nobody is authenticated.
  const effectiveUser = user ?? (DEV_AUTH_BYPASS ? mockDevUser : null);

  return (
    <div className="min-h-screen flex flex-col">
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
            <Route path="/course" element={<Course user={effectiveUser} />} />
            <Route path="/course/:sectionId" element={<CourseSection user={effectiveUser} />} />
          </Route>
        </Routes>
      </div>
    </div>
  );
}

export default App;
