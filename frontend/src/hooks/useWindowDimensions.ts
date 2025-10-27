/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";

function readViewport() {
  const vv = (window as any).visualViewport;
  const width = vv?.width ?? window.innerWidth;
  const height = vv?.height ?? window.innerHeight;
  return { windowWidth: Math.round(width), windowHeight: Math.round(height) };
}

export default function useWindowDimensions() {
  const [dims, setDims] = useState(readViewport());
  const last = useRef(dims);

  useEffect(() => {
    let raf = 0;

    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = readViewport();

        const widthChanged = next.windowWidth !== last.current.windowWidth;
        const heightDelta = Math.abs(next.windowHeight - last.current.windowHeight);

        // If only height changed a little (<120px), treat it as URL-bar jiggle → ignore.
        if (!widthChanged && heightDelta < 120) return;

        last.current = next;
        setDims(next);
      });
    };

    // Prefer visualViewport if available; fall back to window resize.
    (window as any).visualViewport?.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.addEventListener("resize", onResize);

    return () => {
      (window as any).visualViewport?.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return dims;
}
