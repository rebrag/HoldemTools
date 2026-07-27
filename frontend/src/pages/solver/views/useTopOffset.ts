// views/useTopOffset.ts
import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Distance from the document top to the single-range wrapper (i.e. the height
 * of the nav / folder / line chrome above it). Scroll-invariant via scrollY,
 * so the mobile range can be sized to exactly fill the remaining viewport.
 *
 * Attach the returned ref to the view's outermost wrapper.
 */
export function useTopOffset() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState(0);
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setTop(el.getBoundingClientRect().top + window.scrollY);
  }, []);
  // Re-measure after every commit so the mobile range budget reflects late
  // layout changes (the Line row grows once solver data loads, without any prop
  // whose identity we could depend on). Cheap + idempotent: the wrapper's top
  // is invariant to its own content, so setState bails once it settles - no
  // loop.
  useLayoutEffect(() => {
    measure();
  });
  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);
  return { ref, top };
}

export default useTopOffset;
