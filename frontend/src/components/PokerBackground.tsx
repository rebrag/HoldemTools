import React, { useEffect, useRef, useState } from "react";

/**
 * Container-sized poker table.
 * Mount this inside a parent with `position:relative` and it will fill only that box.
 * Portrait/wide toggles via a ResizeObserver on the parent.
 */
const PokerBackground: React.FC<React.PropsWithChildren<{ ledOn?: boolean }>> = ({
  children,
  ledOn = true,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    const el = wrapRef.current?.parentElement; // observe the container we fill
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setPortrait(width * 1.3 < height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="poker-table-bg">
      <div className={`poker-rail ${portrait ? "portrait" : ""} ${ledOn ? "led-on" : ""} relative`}>
        <div className="studs" />
        <div className="pips" />
        <div className="poker-felt">
          <div className="sweep" />
        </div>
        <div className="absolute inset-0 z-10 pointer-events-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

export default PokerBackground;
