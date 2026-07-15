 // useWindowDimensions.ts
import { useEffect, useRef, useState } from "react";

function readViewport() {
  // Use the *layout* viewport so pinch-zoom doesn't affect sizes
  const width =
    document.documentElement.clientWidth || window.innerWidth;
  const height =
    document.documentElement.clientHeight || window.innerHeight;
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

        // Ignore small height jiggle (mobile URL bar show/hide)
        if (!widthChanged && heightDelta < 120) return;

        last.current = next;
        setDims(next);
      });
    };

    // Note: do NOT listen to visualViewport.resize (fires on pinch)
    window.addEventListener("orientationchange", onResize);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return dims;
}
