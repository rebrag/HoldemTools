import { useEffect, useState } from "react";

/**
 * Tracks the Tailwind `sm` breakpoint, so components can branch on "phone" the
 * same way their classes do. Shared rather than per-component because the sim
 * panel and its dropdown have to agree on the answer: one deciding the trigger
 * is a phone control while the other renders the desktop window would leave
 * the sheet anchored to the wrong thing.
 *
 * Note this is a *width* test, not a touch test - a narrow desktop window
 * counts as mobile. That is what the layout wants; see OrientationGate for the
 * `(pointer: coarse)` flavour when the question is really about touch.
 */
export default function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    let raf = 0;
    // Emulated viewports (DevTools, e2e drivers) resize without always firing
    // the media query's `change`, so listen to `resize` too - same workaround
    // as bankroll's useIsDesktop, rAF-coalesced so mobile URL-bar show/hide
    // doesn't spam state updates.
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };
    mq.addEventListener("change", sync);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener("change", sync);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return isMobile;
}
