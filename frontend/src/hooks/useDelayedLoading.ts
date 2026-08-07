import { useEffect, useRef, useState } from "react";

type Options = {
  /** Wait this long before showing the spinner at all. A response that beats
   *  this never flashes one. */
  showAfterMs?: number;
  /** Once shown, keep it up at least this long. Without this, a response that
   *  lands just past `showAfterMs` produces a one-frame strobe. */
  minVisibleMs?: number;
};

/**
 * Decides whether a spinner should be *visible* for a wait that is already
 * happening.
 *
 * IMPORTANT: this gates the spinner inside the loading branch — it must not
 * choose the branch. That is:
 *
 *     loading ? (showSpinner ? <LoadingIndicator/> : <div className="h-40" />)
 *             : rows.length === 0 ? <Empty/> : <Data/>
 *
 * and never `showSpinner ? <LoadingIndicator/> : rows.length === 0 ? ...`,
 * which would render the empty state during the delay window and reintroduce
 * the "you have no data" flash these delays exist alongside. During the delay
 * we render a correctly-sized blank box, never the empty state.
 */
export function useDelayedLoading(
  active: boolean,
  { showAfterMs = 150, minVisibleMs = 400 }: Options = {}
): boolean {
  const [visible, setVisible] = useState(false);
  // When the spinner actually became visible, so we can honour minVisibleMs.
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    let showTimer: number | undefined;
    let hideTimer: number | undefined;

    if (active) {
      if (shownAt.current === null) {
        showTimer = window.setTimeout(() => {
          shownAt.current = Date.now();
          setVisible(true);
        }, showAfterMs);
      }
    } else if (shownAt.current !== null) {
      // Was visible — hold it for the remainder of the minimum, if any.
      const elapsed = Date.now() - shownAt.current;
      const remaining = Math.max(0, minVisibleMs - elapsed);
      hideTimer = window.setTimeout(() => {
        shownAt.current = null;
        setVisible(false);
      }, remaining);
    } else {
      // Never became visible (the wait beat showAfterMs) — nothing to hide.
      setVisible(false);
    }

    return () => {
      if (showTimer !== undefined) clearTimeout(showTimer);
      if (hideTimer !== undefined) clearTimeout(hideTimer);
    };
  }, [active, showAfterMs, minVisibleMs]);

  return visible;
}

export default useDelayedLoading;
