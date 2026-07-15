// src/context/AuthGate.tsx
// App-level gate for auth-protected navigation. Instead of routing a signed-out
// user into a protected page and logging them in there, callers use
// `requireAuth(dest)`: if signed in, it navigates immediately; if not, it opens
// the login modal *on the current page* and only navigates to `dest` after a
// successful sign-in. One shared modal is rendered here so any component (navbar,
// homepage CTAs, ...) can trigger it.
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "firebase/auth";
import LoginSignupModal from "@/components/LoginSignupModal";

type AuthGateValue = {
  /** Navigate to `dest` if signed in; otherwise open the login modal here and
   *  navigate to `dest` once the user signs in. */
  requireAuth: (dest: string) => void;
  /** Open the login modal with no pending redirect. */
  openLogin: () => void;
};

const AuthGateContext = createContext<AuthGateValue | null>(null);

export const AuthGateProvider: React.FC<{
  user: User | null;
  children: ReactNode;
}> = ({ user, children }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const pendingDest = useRef<string | null>(null);

  const requireAuth = useCallback(
    (dest: string) => {
      if (user) {
        navigate(dest);
        return;
      }
      pendingDest.current = dest;
      setOpen(true);
    },
    [user, navigate]
  );

  const openLogin = useCallback(() => {
    pendingDest.current = null;
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    pendingDest.current = null;
    setOpen(false);
  }, []);

  const handleSuccess = useCallback(() => {
    const dest = pendingDest.current;
    pendingDest.current = null;
    setOpen(false);
    if (dest) navigate(dest);
  }, [navigate]);

  return (
    <AuthGateContext.Provider value={{ requireAuth, openLogin }}>
      {children}
      {open && (
        <LoginSignupModal onClose={handleClose} onSuccess={handleSuccess} />
      )}
    </AuthGateContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthGate(): AuthGateValue {
  const ctx = useContext(AuthGateContext);
  if (!ctx) {
    throw new Error("useAuthGate must be used within an AuthGateProvider");
  }
  return ctx;
}
