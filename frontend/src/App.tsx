import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import LoadingIndicator from "@/components/LoadingIndicator";
import { AppProvider } from "@/components/AppContext";
import AppShell from "@/components/layout/AppShell";
import Homepage from "@/pages/home/Homepage";
import Solver from "@/pages/solver/Solver";
import EquityCalc from "@/pages/equity/EquityCalc";
import BankrollTracker from "@/pages/bankroll/BankrollTracker";
import HandHistoryTool from "@/pages/handhistory/HandHistoryTool";
import CreateHandHistory from "@/pages/handhistory/create/CreateHandHistory";
import Course from "@/pages/course/Course";
import CourseSection from "@/pages/course/CourseSection";
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
            <Route path="/course" element={<Course user={effectiveUser} />} />
            <Route path="/course/:sectionId" element={<CourseSection user={effectiveUser} />} />
          </Route>
        </Routes>
      </div>
    </div>
  );
}

export default App;
