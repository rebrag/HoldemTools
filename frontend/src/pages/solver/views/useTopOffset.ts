// views/useTopOffset.ts
import { useCallback, useLayoutEffect, useRef, useState } from "react";

interface WrapperBox {
  /** Distance from the document top to the wrapper. */
  top: number;
  /** Page chrome reserved *below* the wrapper - see `bottomInset` below. */
  bottomInset: number;
}

/**
 * Where the single-range wrapper sits, so a view can size itself to exactly
 * fill the remaining viewport.
 *
 * `top` is the height of the nav / folder / line chrome above it, made
 * scroll-invariant via scrollY.
 *
 * `bottomInset` is the padding and margin the wrapper's *ancestors* reserve
 * beneath it. Without it a view that budgets `viewH - top` fills the viewport
 * and then that reserved space pushes the document past it, so a layout meant
 * to fit exactly scrolls by a few pixels - the solver page wrapper's `p-1`
 * bottom padding did precisely that. Measuring beats a second hardcoded
 * constant: it stays correct when someone changes the padding.
 *
 * Attach the returned ref to the view's outermost wrapper.
 */
export function useTopOffset() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<WrapperBox>({ top: 0, bottomInset: 0 });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;

    let bottomInset = 0;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      bottomInset += parseFloat(cs.paddingBottom) || 0;
      bottomInset += parseFloat(cs.marginBottom) || 0;
    }

    /* Bail on an unchanged box by hand. The effect below runs after every
     * commit, and React only skips a re-render when the new state is
     * identical - a fresh object never is, so returning one unconditionally
     * would loop forever. */
    setBox((prev) =>
      prev.top === top && prev.bottomInset === bottomInset
        ? prev
        : { top, bottomInset }
    );
  }, []);

  // Re-measure after every commit so the budget reflects late layout changes
  // (the Line row grows once solver data loads, without any prop whose
  // identity we could depend on). Cheap + idempotent: the wrapper's top is
  // invariant to its own content, so it settles immediately - no loop.
  useLayoutEffect(() => {
    measure();
  });
  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  return { ref, top: box.top, bottomInset: box.bottomInset };
}

export default useTopOffset;
