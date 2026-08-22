// src/bankroll/desktop/useIsDesktop.ts
import { useEffect, useState } from "react";

const QUERY = "(min-width: 1024px)"; // Tailwind lg

/** True on lg+ viewports; drives the mobile/desktop layout switch. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    // Also listen to plain resize: emulated viewports (devtools, automation)
    // don't always dispatch MediaQueryList "change" events. rAF-coalesced so
    // mobile URL-bar show/hide doesn't spam state updates.
    const update = () => setIsDesktop(mql.matches);
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    mql.addEventListener("change", update);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      mql.removeEventListener("change", update);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return isDesktop;
}
