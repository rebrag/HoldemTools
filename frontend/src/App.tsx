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

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-grow">
        <Routes>
          <Route path="/" element={<Homepage />} />
          <Route path="/solver" element={<Navigate to="/solutions" replace />} />
          <Route
            element={
              <AppProvider>
                <AppShell user={user} />
              </AppProvider>
            }
          >
            <Route path="/solutions" element={<Solver user={user} />} />
            <Route path="/equity" element={<EquityCalc />} />
            <Route path="/bankroll" element={<BankrollTracker user={user} />} />
          </Route>
        </Routes>
      </div>
    </div>
  );
}

export default App;
