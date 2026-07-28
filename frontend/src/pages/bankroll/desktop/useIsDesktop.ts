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
    // don't always dispatch MediaQueryList "change" events.
    const update = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mql.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return isDesktop;
}
