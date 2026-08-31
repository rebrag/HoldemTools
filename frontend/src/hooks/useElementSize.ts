// hooks/useElementSize.ts
import { useLayoutEffect, useRef, useState } from "react";

/**
 * An element's content box, kept current by a ResizeObserver.
 *
 * `hysteresis` exists because callers turn this width into pixel layout
 * budgets: re-rendering the matrix for a 1px reflow is pure churn.
 *
 * This used to drop every observation while `visualViewport.scale != 1`, to
 * "ignore transient changes" during a pinch. Pinch-zoom moves the *visual*
 * viewport, though - it does not resize an element's layout box, so there was
 * nothing to ignore. What the guard actually did was discard real layout
 * changes that happened to land while the user was zoomed in, freezing the
 * size at its pre-change value: zoom in on a phone, turn it to portrait, and
 * the solver's mobile dock kept budgeting for the landscape width, hanging
 * 200px of matrix off both edges of the screen where nothing could scroll to
 * it. If a browser really does reflow the page during a pinch, the element
 * changed size and the new size is the one to render at.
 */
export default function useElementSize<T extends HTMLElement>(opts?: { hysteresis?: number }) {
  const hysteresis = opts?.hysteresis ?? 6; // px before we accept a change
  const [node, setNode] = useState<T | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const [, force] = useState(0);

  useLayoutEffect(() => {
    if (!node) return;

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      const { w: pw, h: ph } = sizeRef.current;
      if (Math.abs(w - pw) > hysteresis || Math.abs(h - ph) > hysteresis) {
        sizeRef.current = { w, h };
        force((x) => x + 1);
      }
    });

    ro.observe(node);
    return () => ro.disconnect();
  }, [node, hysteresis]);

  const rect = sizeRef.current;
  return { ref: setNode as React.RefCallback<T>, width: rect.w, height: rect.h };
}
