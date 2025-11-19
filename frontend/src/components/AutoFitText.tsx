// src/components/AutoFitText.tsx
import React, { ReactNode, useEffect, useRef, useState } from "react";

export interface AutoFitTextProps {
  children: ReactNode;
  minPx?: number;
  maxPx?: number;
  className?: string;
  title?: string;
}

/**
 * AutoFitText
 * - Measures available width in its container and shrinks text to fit.
 * - Used in Plate badges and Bankroll tables to avoid x-overflow.
 */
const AutoFitText: React.FC<AutoFitTextProps> = ({
  children,
  minPx = 6,
  maxPx = 14,
  className = "",
  title,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<number>(maxPx);
  const [scale, setScale] = useState<number>(1);

  const fit = () => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;

    const maxW = wrap.clientWidth;
    if (maxW <= 0) return;

    inner.style.fontSize = `${maxPx}px`;
    inner.style.whiteSpace = "nowrap";
    inner.style.transform = "scale(1)";
    inner.style.transformOrigin = "center";

    let lo = minPx;
    let hi = maxPx;
    let best = minPx;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      inner.style.fontSize = `${mid}px`;
      const tooWide = inner.scrollWidth > maxW;
      if (!tooWide) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    setSize(best);
    inner.style.fontSize = `${best}px`;

    const widthAtBest = inner.scrollWidth;
    setScale(widthAtBest > maxW ? Math.max(0.75, maxW / widthAtBest) : 1);
  };

  useEffect(() => {
    fit();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  return (
    <div
      ref={wrapRef}
      className={`w-full overflow-visible ${className}`}
      title={title}
      style={{ lineHeight: 1.00 }}
    >
      <span
        ref={innerRef}
        style={{
          fontSize: size,
          display: "inline-block",
          whiteSpace: "nowrap",
          transform: `scale(${scale})`,
          transformOrigin: "center",
          willChange: "transform",
        }}
      >
        {children}
      </span>
    </div>
  );
};

export default AutoFitText;
