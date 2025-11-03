/* eslint-disable @typescript-eslint/no-explicit-any */
// hooks/useElementSize.ts
import { useLayoutEffect, useRef, useState } from "react";

export default function useElementSize<T extends HTMLElement>(opts?: { hysteresis?: number }) {
  const hysteresis = opts?.hysteresis ?? 6; // px before we accept a change
  const [node, setNode] = useState<T | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const [, force] = useState(0);

  useLayoutEffect(() => {
    if (!node) return;
    const update = (w: number, h: number) => {
      const { w: pw, h: ph } = sizeRef.current;
      if (Math.abs(w - pw) > hysteresis || Math.abs(h - ph) > hysteresis) {
        sizeRef.current = { w, h };
        force((x) => x + 1);
      }
    };

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      // If user is pinched in/out, ignore transient changes
       
      const scale = (window as any).visualViewport?.scale ?? 1;
      if (scale && Math.abs(scale - 1) > 0.01) return;
      const cr = entry.contentRect;
      update(Math.round(cr.width), Math.round(cr.height));
    });

    ro.observe(node);

    // If you want to *freeze* during pinch, also listen to visualViewport:
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    const onVV = () => {
      if (!vv) return;
      if (Math.abs(vv.scale - 1) > 0.01) return; // ignore while zoomed
      // when returning to 1.0, force a refresh using current box size
      const rect = node.getBoundingClientRect();
      update(Math.round(rect.width), Math.round(rect.height));
    };
    vv?.addEventListener("resize", onVV, { passive: true });

    return () => {
      ro.disconnect();
      vv?.removeEventListener("resize", onVV as any);
    };
  }, [node, hysteresis]);

  const rect = sizeRef.current;
  return { ref: setNode as React.RefCallback<T>, width: rect.w, height: rect.h };
}
