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

// Optional: let NavBar consume the tier from context (no prop-drill)
const NavBarWithTier: React.FC<{
  section: "solver" | "equity";
  goToEquity: () => void;
  goToSolver: () => void;
}> = ({ section, goToEquity, goToSolver }) => {
  // const { tier, loading } = useCurrentTier();
  return (
    <NavBar
      section={section}
      goToEquity={goToEquity}
      goToSolver={goToSolver}
      // If your NavBar needs it as prop (otherwise, it can call useCurrentTier itself)
      // tier={tier}
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
