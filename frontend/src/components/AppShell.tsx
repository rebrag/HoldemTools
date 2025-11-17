// src/components/AppShell.tsx
import type { User } from "firebase/auth";
import NavBar from "./NavBar";
import Solver from "./Solver";
import EquityCalc from "./EquityCalc";
import BankrollTracker from "./BankrollTracker";
import { TierProvider } from "../context/TierContext";

interface AppShellProps {
  user: User | null;
  section: "solver" | "equity" | "bankroll";
  goToEquity: () => void;
  goToSolver: () => void;
  goToBankroll: () => void;
}

const NavBarWithTier: React.FC<{
  section: "solver" | "equity" | "bankroll";
  goToEquity: () => void;
  goToSolver: () => void;
  goToBankroll: () => void;
}> = ({ section, goToEquity, goToSolver, goToBankroll }) => {
  return (
    <NavBar
      section={section}
      goToEquity={goToEquity}
      goToSolver={goToSolver}
      goToBankroll={goToBankroll}
    />
  );
};

const AppShell: React.FC<AppShellProps> = ({
  user,
  section,
  goToEquity,
  goToSolver,
  goToBankroll,
}) => {
  return (
    <TierProvider user={user}>
      <div className="min-h-screen">
        <NavBarWithTier
          section={section}
          goToEquity={goToEquity}
          goToSolver={goToSolver}
          goToBankroll={goToBankroll}
        />
        <div className="pt-12">
          {section === "solver" && <Solver user={user} />}
          {section === "equity" && <EquityCalc />}
          {section === "bankroll" && <BankrollTracker user={user} />}
        </div>
      </div>
    </TierProvider>
  );
};

export default AppShell;
