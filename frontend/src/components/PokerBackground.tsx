import React, { useEffect, useState } from "react";

/**
 * Renders the poker table rail + felt as before,
 * but now exposes an interactive overlay (children) that is positioned
 * exactly on top of the felt so you can place seats, board, etc.
 */
const PokerBackground: React.FC<React.PropsWithChildren<{ ledOn?: boolean }>> = ({
  children,
  ledOn = true,
}) => {
  const [vw, setVw] = useState<number>(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  const [vh, setVh] = useState<number>(
    typeof window !== "undefined" ? window.innerHeight : 800
  );

  useEffect(() => {
    const onResize = () => { setVw(window.innerWidth); setVh(window.innerHeight); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const railPortrait = vw * 1.3 < vh;

  return (
    <div className="poker-table-bg absolute inset-0 flex justify-center items-center z-0">
      <div
        className={`poker-rail ${railPortrait ? "portrait" : ""} ${
          ledOn ? "led-on" : ""
        } relative`}
      >
        <div className="poker-felt" />
        {/* Interactive overlay that matches the rail’s bounds */}
        <div className="absolute inset-0 z-10 pointer-events-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

export default PokerBackground;
