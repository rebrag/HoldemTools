import type { User } from "firebase/auth";
import { Outlet } from "react-router-dom";
import NavBar from "@/components/layout/NavBar";
import { TierProvider } from "@/context/TierContext";

interface AppShellProps {
  user: User | null;
}

const AppShell: React.FC<AppShellProps> = ({ user }) => {
  return (
    <TierProvider user={user}>
      <div className="min-h-screen">
        <NavBar />
        <div className="pt-12">
          <Outlet />
        </div>
      </div>
    </TierProvider>
  );
};

export default AppShell;
