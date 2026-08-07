// src/components/OrientationGate.tsx
// Portrait "lock" for phones: a full-screen prompt that blocks the UI while a
// small touch device is held landscape, so the app effectively only runs in
// portrait. Desktops and tablets are exempt (landscape is their normal state),
// gated by pointer coarseness and the device's smaller dimension.
//
// A browser tab cannot truly lock orientation (screen.orientation.lock() only
// works in fullscreen/PWA contexts), so this overlay is the lock.
import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Smartphone } from "lucide-react";

/* True while the viewport reads as a landscape phone. Uses the orientation
 * media query (aspect-based, resilient to soft-keyboard viewport jiggle on
 * iOS) plus a coarse-pointer check and a size ceiling: phones' smaller
 * dimension tops out well under 640px CSS pixels, iPads start at 744. Not
 * useWindowDimensions - that hook deliberately swallows small height changes
 * and this needs to react to every rotation instantly. */
function useMobileLandscape(): boolean {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const landscapeMq = window.matchMedia("(orientation: landscape)");
    const coarseMq = window.matchMedia("(pointer: coarse)");
    let raf = 0;
    const check = () => {
      const w = document.documentElement.clientWidth;
      const h = document.documentElement.clientHeight;
      setBlocked(
        landscapeMq.matches && coarseMq.matches && Math.min(w, h) < 640
      );
    };
    const evaluate = () => {
      /* Check immediately (rAF never fires in a page that isn't compositing,
       * e.g. a tab loaded in the background), then once more on the next
       * frame - iOS reports stale dimensions while an orientation change is
       * still in flight, and the second read lands after layout settles. */
      check();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(check);
    };
    evaluate();
    landscapeMq.addEventListener("change", evaluate);
    window.addEventListener("resize", evaluate);
    return () => {
      cancelAnimationFrame(raf);
      landscapeMq.removeEventListener("change", evaluate);
      window.removeEventListener("resize", evaluate);
    };
  }, []);

  return blocked;
}

const OrientationGate: React.FC = () => {
  const blocked = useMobileLandscape();
  const reduceMotion = useReducedMotion();

  /* Scroll-lock behind the overlay, same pattern as ResponsiveDrawer. */
  useEffect(() => {
    if (!blocked) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [blocked]);

  return (
    <AnimatePresence>
      {blocked && (
        <motion.div
          /* Above every other surface, SeatEditorModal's z-[1300] included. */
          className="fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-4 bg-slate-950/95"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          role="status"
          aria-live="polite"
        >
          <motion.div
            animate={reduceMotion ? undefined : { rotate: [90, 90, 0, 0, 90] }}
            transition={
              reduceMotion
                ? undefined
                : {
                    duration: 2.6,
                    times: [0, 0.2, 0.4, 0.85, 1],
                    ease: "easeInOut",
                    repeat: Infinity,
                  }
            }
            className="text-emerald-400"
            style={reduceMotion ? undefined : { rotate: 90 }}
          >
            <Smartphone size={56} strokeWidth={1.6} />
          </motion.div>
          <p className="text-sm font-semibold text-white">Rotate your device</p>
          <p className="text-xs text-slate-400">
            HoldemTools plays best in portrait
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OrientationGate;
