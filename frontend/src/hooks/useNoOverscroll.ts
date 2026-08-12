// src/hooks/useNoOverscroll.ts
import { useEffect } from "react";

/**
 * Suppress document-level overscroll (the touch rubber-band and scroll
 * chaining) for as long as the calling page is mounted.
 *
 * Pages that budget their layout to the viewport - the solver, the hand
 * recorder, the replayer - gain nothing from the bounce: it only reveals
 * backdrop and makes the page feel unmoored from the table it is showing.
 * Inner scrollers (dropdowns, drawers, the raw-text panes) keep their own
 * physics; this only stops the bounce from chaining to the document.
 *
 * The class has to live on <html> because the document, not an inner
 * container, is the scroller (see `html.no-overscroll` in index.css).
 */

const CLASS_NAME = "no-overscroll";

// Mounts can overlap - the bankroll session modal hosts the recorder over a
// page of its own - so the class is reference counted. Without this the first
// unmount would drop it while another consumer is still on screen.
let mounted = 0;

export function useNoOverscroll(): void {
  useEffect(() => {
    mounted += 1;
    document.documentElement.classList.add(CLASS_NAME);
    return () => {
      mounted -= 1;
      if (mounted === 0) document.documentElement.classList.remove(CLASS_NAME);
    };
  }, []);
}

export default useNoOverscroll;
