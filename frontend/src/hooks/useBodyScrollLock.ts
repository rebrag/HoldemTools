// src/hooks/useBodyScrollLock.ts
// Freezes background scrolling while an overlay is open.
//
// Ref-counted on purpose. The naive per-component version - save
// `document.body.style.overflow`, set "hidden", restore the saved value on
// cleanup - breaks the moment two overlays are open at once, because the
// second one saves the *first one's* "hidden" as the value to restore. React
// runs child cleanups before parent cleanups, so the parent then puts
// "hidden" back after the child has already cleared it and the page stays
// frozen for the rest of the session, across route changes (body is global).
// That is exactly what a drawer nested inside a page that also locked scroll
// used to do on the bankroll page.
//
// With a shared counter, only the first locker records the page's real
// overflow and only the last one to release restores it, so any nesting or
// unmount order is safe.
import { useEffect } from "react";

let lockCount = 0;
let restoreValue = "";

function acquire(): void {
  if (typeof document === "undefined") return;
  if (lockCount === 0) {
    restoreValue = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
}

function release(): void {
  if (typeof document === "undefined") return;
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = restoreValue;
}

/** Locks body scroll while `locked` is true. Safe to nest. */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    acquire();
    return release;
  }, [locked]);
}

export default useBodyScrollLock;
