// src/components/AppShell.tsx
import type { User } from "firebase/auth";
import NavBar from "./NavBar";
import Solver from "./Solver";
import EquityCalc from "./EquityCalc";
import { TierProvider } from "../context/TierContext";

interface AppShellProps {
  user: User | null;
  section: "solver" | "equity";
  goToEquity: () => void;
  goToSolver: () => void;
}

const NavBarWithTier: React.FC<{
  section: "solver" | "equity";
  goToEquity: () => void;
  goToSolver: () => void;
}> = ({ section, goToEquity, goToSolver }) => {
  return (
    <NavBar
      section={section}
      goToEquity={goToEquity}
      goToSolver={goToSolver}
    />
  );
};

const AppShell: React.FC<AppShellProps> = ({ user, section, goToEquity, goToSolver }) => {
  return (
    <TierProvider user={user}>
      <div className="min-h-screen">
        <NavBarWithTier section={section} goToEquity={goToEquity} goToSolver={goToSolver} />
        <div className="pt-12">
          {section === "solver" ? <Solver user={user} /> : <EquityCalc />}
        </div>
      </div>
    </TierProvider>
  );
};

export default AppShell;
