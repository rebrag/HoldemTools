import type { User } from "firebase/auth";
import { Outlet } from "react-router-dom";
import NavBar from "@/components/layout/NavBar";
import { TierProvider } from "@/context/TierContext";
import { AuroraBackground } from "@/pages/home/shared/AuroraBackground";

interface AppShellProps {
  user: User | null;
}

const AppShell: React.FC<AppShellProps> = ({ user }) => {
  return (
    <TierProvider user={user}>
      {/* Shared cinematic backdrop behind every page (fixed, -z-10) so the
          site's background stays consistent with the homepage. */}
      <AuroraBackground variant="table" />
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
