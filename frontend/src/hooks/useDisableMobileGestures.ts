/* eslint-disable @typescript-eslint/no-explicit-any */
// hooks/useDisableMobileGestures.ts
import { useEffect } from "react";

export function useDisableMobileGestures() {
  useEffect(() => {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isIOS = /iPad|iPhone|iPod/.test(ua);

    if (!isIOS) return;

    let startX = 0, startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      // 1) Prevent history edge-swipe from left/right edge
      const edge = 20; // px from screen edge
      const w = window.innerWidth;
      const fromLeft  = startX <= edge && dx > 0;
      const fromRight = startX >= w - edge && dx < 0;
      if (fromLeft || fromRight) {
        e.preventDefault();
        return;
      }

      // 2) Prevent pull-to-refresh: at top, dragging down
      if (window.scrollY <= 0 && dy > 0) {
        e.preventDefault();
      }
    };

    // IMPORTANT: passive:false so preventDefault works
    document.addEventListener("touchstart", onTouchStart, { passive: false });
    document.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      document.removeEventListener("touchstart", onTouchStart as any);
      document.removeEventListener("touchmove", onTouchMove as any);
    };
  }, []);
}
