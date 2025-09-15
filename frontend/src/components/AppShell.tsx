import React, { useState } from "react";
import type { User } from "firebase/auth";
import NavBar from "./NavBar";
import Solver from "./Solver";
import EquityCalc from "./EquityCalc";

interface AppShellProps {
  user: User | null;
  section: "solver" | "equity";
  goToEquity: () => void;
  goToSolver: () => void;
}

const AppShell: React.FC<AppShellProps> = ({ user, section, goToEquity, goToSolver }) => {
  const [folders] = useState<string[]>([]);
  const [currentFolder, setCurrentFolder] = useState("");

  const startWalkthrough = () => console.log("start walkthrough");

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar
        section={section}
        folders={folders}
        currentFolder={currentFolder}
        onFolderSelect={setCurrentFolder}
        startWalkthrough={startWalkthrough}
        goToEquity={goToEquity}
        goToSolver={goToSolver}
      />
      <div className="pt-12">
        {section === "solver" ? <Solver user={user} /> : <EquityCalc />}
      </div>
    </div>
  );
};

export default AppShell;
