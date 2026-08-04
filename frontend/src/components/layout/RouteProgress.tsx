import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  useLocation,
  useNavigate,
  type NavigateOptions,
  type To,
} from "react-router-dom";

/**
 * Feedback for in-app navigation.
 *
 * Route components are code-split, so moving between tools waits on a chunk
 * fetch. The <Suspense> fallback in AppShell cannot cover that wait: React
 * Router wraps navigation in React.startTransition, and React deliberately
 * keeps already-visible content on screen rather than replacing it with a
 * fallback. The result was a tap that appeared to do nothing until the new page
 * abruptly swapped in.
 *
 * Showing the fallback instead would be worse — it would blank the page you are
 * still reading. So the wait gets a progress bar at the top of the viewport,
 * and the pending window is driven from the click rather than observed:
 * useLocation only updates once the transition commits, and the router owns its
 * startTransition call internally, so there is no isPending to read.
 */

type RouteProgressValue = {
  pending: boolean;
  startNavigation: () => void;
};

const RouteProgressContext = createContext<RouteProgressValue | null>(null);

/** Backstop so a chunk that never resolves cannot strand the bar on screen. */
const SAFETY_TIMEOUT_MS = 8000;

const ProgressBar: React.FC<{ active: boolean }> = ({ active }) => {
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="fixed inset-x-0 top-0 z-90 h-0.5 bg-transparent pointer-events-none"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          role="progressbar"
          aria-label="Loading page"
        >
          <motion.div
            className="h-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
            // Ease out towards 90% and hold: the real duration is a network
            // fetch we cannot predict, so the bar conveys "started, working"
            // rather than a percentage. The exit fade covers the last 10%.
            initial={{ width: reduce ? "100%" : "0%" }}
            animate={{ width: reduce ? "100%" : "90%" }}
            transition={
              reduce ? { duration: 0 } : { duration: 0.8, ease: [0.22, 1, 0.36, 1] }
            }
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const RouteProgressProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [pending, setPending] = useState(false);
  const location = useLocation();

  const startNavigation = useCallback(() => setPending(true), []);

  // The new route has committed. location.key changes on every navigation,
  // including a push to the path already showing.
  useEffect(() => {
    setPending(false);
  }, [location.key]);

  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => setPending(false), SAFETY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pending]);

  return (
    <RouteProgressContext.Provider value={{ pending, startNavigation }}>
      {children}
      <ProgressBar active={pending} />
    </RouteProgressContext.Provider>
  );
};

type AppNavigate = {
  (to: To, options?: NavigateOptions): void;
  (delta: number): void;
};

/**
 * Drop-in replacement for useNavigate that also shows the progress bar.
 *
 * Same call signature, so swapping it in is mechanical. Outside a
 * RouteProgressProvider it degrades to plain navigation rather than throwing.
 */
export function useAppNavigate(): AppNavigate {
  const navigate = useNavigate();
  const location = useLocation();
  const ctx = useContext(RouteProgressContext);
  // Read through a ref so the returned callback stays stable — several call
  // sites list it in effect/callback dependency arrays.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") {
        navigate(to);
        return;
      }
      // A push to the current path resolves instantly; a bar would just blink.
      if (to !== pathRef.current) ctx?.startNavigation();
      navigate(to, options);
    },
    [navigate, ctx]
  ) as AppNavigate;
}

export default RouteProgressProvider;
