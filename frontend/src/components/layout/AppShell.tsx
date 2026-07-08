import type { User } from "firebase/auth";
import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import NavBar from "@/components/layout/NavBar";
import { TierProvider } from "@/context/TierContext";
import { AuroraBackground } from "@/pages/home/shared/AuroraBackground";

/** Lightweight fallback shown in the content area while a lazy route chunk
 *  loads. Kept minimal (no heavy assets) so it never adds to the critical path;
 *  the navbar + backdrop stay mounted around it. */
const RouteFallback: React.FC = () => (
  <div className="flex min-h-[60vh] items-center justify-center">
    <div
      className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400"
      role="status"
      aria-label="Loading"
    />
  </div>
);

interface AppShellProps {
  user: User | null;
}

const AppShell: React.FC<AppShellProps> = ({ user }) => {
  return (
    <TierProvider user={user}>
      {/* Shared cinematic backdrop behind every page (fixed, -z-10) so the
          site's background stays consistent with the homepage. */}
      <AuroraBackground variant="table" />
      <div>
        <NavBar />
        <div className="pt-12">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </div>
      </div>
    </TierProvider>
  );
};

export default AppShell;
