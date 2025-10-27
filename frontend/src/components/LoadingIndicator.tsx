import React from "react";

type Props = {
  size?: number;        // px
  spin?: boolean;       // rotate animation on/off
  durationMs?: number;  // rotation speed
};

const LoadingIndicator: React.FC<Props> = ({ size = 100, spin = true, durationMs = 800 }) => {
  return (
    <div
      style={{ display: "grid", placeItems: "center", padding: "0.75rem" }}
      aria-busy="true"
      aria-live="polite"
    >
      <img
        src="/holdemtools-spinner.svg"
        alt="Loading…"
        width={size}
        height={size}
        style={{
          // IMPORTANT: include the animation NAME, not just duration
          animation: spin ? ` ${durationMs}ms linear infinite` : undefined,
          imageRendering: "auto",
        }}
      />
      <style>
        {`
          @keyframes ht-spin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

export default LoadingIndicator;
