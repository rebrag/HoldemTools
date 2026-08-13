// src/lib/pointer.ts
/**
 * True on devices whose primary pointer is a finger (phones, tablets).
 *
 * Used where touch devices need a structurally different flow, not just a
 * smaller layout - e.g. Google sign-in goes through a redirect instead of a
 * popup, and replay/solution links navigate in place instead of opening a new
 * tab. Both exist for the same reason: on iOS Safari a page spawned from the
 * app (popup or target=_blank tab) shares the opener's WebContent process, and
 * two live copies of the app in one process is what got those pages killed
 * with "A problem repeatedly occurred".
 *
 * A plain function rather than a hook: pointer coarseness is fixed for the
 * life of the page, so there is nothing to re-render on.
 */
export function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}
