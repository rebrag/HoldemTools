import { useEffect, useState } from "react";

const COARSE = "(pointer: coarse)";
const SMALL = "(max-width: 767px)";

function saveData(): boolean {
  // NetworkInformation is not in lib.dom for every TS config; feature-detect.
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
  return conn?.saveData === true;
}

function detect(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia(COARSE).matches ||
    window.matchMedia(SMALL).matches ||
    saveData()
  );
}

/**
 * True on devices where battery beats decoration: touch-primary devices
 * (phones, tablets), small viewports, or Data Saver. Decorative *infinite*
 * animations (aurora drift, flying cards) consult this and freeze or unmount;
 * event-driven interaction animations cost nothing while idle and stay.
 *
 * This is the width-OR-touch flavour; see useIsMobile for the pure width test
 * and OrientationGate for pure touch.
 */
export function usePowerFriendly(): boolean {
  const [powerFriendly, setPowerFriendly] = useState<boolean>(detect);

  useEffect(() => {
    const coarse = window.matchMedia(COARSE);
    const small = window.matchMedia(SMALL);
    const sync = () => setPowerFriendly(detect());
    let raf = 0;
    // Emulated viewports (DevTools, e2e drivers) resize without always firing
    // the media query's `change`, so listen to `resize` too - coalesced
    // through rAF like useWindowDimensions so URL-bar jiggle stays cheap.
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };
    coarse.addEventListener("change", sync);
    small.addEventListener("change", sync);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      coarse.removeEventListener("change", sync);
      small.removeEventListener("change", sync);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return powerFriendly;
}
