import type { User } from "firebase/auth";
import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import NavBar from "@/components/layout/NavBar";
import LoadingIndicator from "@/components/LoadingIndicator";
import { RouteProgressProvider } from "@/components/layout/RouteProgress";
import { TierProvider } from "@/context/TierContext";
import { AuthGateProvider } from "@/context/AuthGate";
import { AuroraBackground } from "@/pages/home/shared/AuroraBackground";

/** Lightweight fallback shown in the content area while a lazy route chunk
 *  loads. Uses the ring variant deliberately: it pulls no image, so it never
 *  competes with the chunk fetch it is covering for. The navbar + backdrop stay
 *  mounted around it.
 *
 *  Note this only renders on a hard load. React Router wraps navigation in a
 *  transition, and React withholds a fallback for content already on screen, so
 *  in-app navigation is covered by <RouteProgress> instead. */
const RouteFallback: React.FC = () => (
  <div className="flex min-h-[60vh] items-center justify-center">
    <LoadingIndicator variant="ring" size={32} className="text-emerald-400" />
  </div>
);

interface AppShellProps {
  user: User | null;
}

const AppShell: React.FC<AppShellProps> = ({ user }) => {
  return (
    <TierProvider user={user}>
      {/* Outside AuthGateProvider so the gate's own navigations show the bar. */}
      <RouteProgressProvider>
        <AuthGateProvider user={user}>
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
        </AuthGateProvider>
      </RouteProgressProvider>
    </TierProvider>
  );
};

export default AppShell;
