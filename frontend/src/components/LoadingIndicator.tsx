import React from "react";

type Props = {
  size?: number;        // px — overall diameter
  spin?: boolean;       // master on/off for motion
  durationMs?: number;  // ring rotation period (flip is derived from this)
};

const LoadingIndicator: React.FC<Props> = ({ size = 100, spin = true, durationMs = 1400 }) => {
  const logo = Math.round(size * 0.52); // center chip diameter
  const flipMs = Math.round(durationMs * 3.1);

  return (
    <div
      style={{ display: "grid", placeItems: "center", padding: "0.75rem" }}
      aria-busy="true"
      aria-live="polite"
    >
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          // expose timings to CSS
          ["--ht-ring-ms" as string]: `${durationMs}ms`,
          ["--ht-flip-ms" as string]: `${flipMs}ms`,
        } as React.CSSProperties}
      >
        {/* sweeping arc ring */}
        <svg
          className={spin ? "ht-ring" : undefined}
          width={size}
          height={size}
          viewBox="0 0 128 128"
          fill="none"
          style={{ position: "absolute", inset: 0 }}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="htRingGrad" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>
          <circle
            cx="64"
            cy="64"
            r="44"
            stroke="url(#htRingGrad)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray="60 220"
          />
        </svg>

        {/* flipping logo chip */}
        <div
          className={spin ? "ht-flip" : undefined}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: logo,
            height: logo,
            marginTop: -logo / 2,
            marginLeft: -logo / 2,
            borderRadius: "50%",
            overflow: "hidden",
            backgroundColor: "#111827",
          }}
        >
          <img
            src="/holdemtools-logo.png"
            alt="Loading…"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
      </div>

      <style>
        {`
          @keyframes ht-ring-spin { to { transform: rotate(360deg); } }
          @keyframes ht-flip-spin {
            0%, 55%   { transform: rotateY(0deg); }
            78%, 100% { transform: rotateY(360deg); }
          }
          @keyframes ht-fade { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }

          .ht-ring {
            transform-origin: 50% 50%;
            animation: ht-ring-spin var(--ht-ring-ms) linear infinite;
          }
          .ht-flip {
            transform-origin: 50% 50%;
            transform-style: preserve-3d;
            animation: ht-flip-spin var(--ht-flip-ms) cubic-bezier(0.6, 0, 0.35, 1) infinite;
          }

          @media (prefers-reduced-motion: reduce) {
            .ht-ring, .ht-flip {
              animation: ht-fade 1.4s ease-in-out infinite;
            }
          }
        `}
      </style>
    </div>
  );
};

export default LoadingIndicator;
