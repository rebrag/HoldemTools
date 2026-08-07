import React from "react";

/**
 * The app's one loading spinner, in two renderings.
 *
 * - `brand` (default): the sweeping arc plus the flipping logo chip. Use it for
 *   page- and panel-scale waits, roughly 48px and up, where the wait is the only
 *   thing on screen and there is room for the logo to read.
 * - `ring`: the arc alone, in `currentColor`, with no wrapper padding and no
 *   image. Use it inside buttons and other controls, and anywhere an extra
 *   network request would be wrong — notably the route-level Suspense fallback,
 *   which fires exactly when the browser is busy fetching a route chunk.
 *
 * Keyframes live in index.css so they are not re-injected per instance.
 */
type Props = {
  size?: number;         // px — overall diameter
  spin?: boolean;        // master on/off for motion
  durationMs?: number;   // ring rotation period (flip is derived from this)
  variant?: "brand" | "ring";
  className?: string;    // ring variant: usually a text-* class, since it inherits currentColor
  /** Accessible name. Defaults to "Loading". Set to "" for decorative use when
   *  a nearby element already announces the wait. */
  label?: string;
};

const LoadingIndicator: React.FC<Props> = ({
  size = 100,
  spin = true,
  durationMs = 1400,
  variant = "brand",
  className,
  label = "Loading",
}) => {
  const logo = Math.round(size * 0.52); // center chip diameter
  const flipMs = Math.round(durationMs * 3.1);

  const timings = {
    ["--ht-ring-ms" as string]: `${durationMs}ms`,
    ["--ht-flip-ms" as string]: `${flipMs}ms`,
  } as React.CSSProperties;

  // The arc is shared by both variants; only its stroke differs. The brand
  // variant paints the emerald gradient, the ring variant inherits currentColor
  // so it matches the text of whatever control it sits in.
  const arc = (
    <svg
      className={spin ? "ht-ring" : undefined}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      style={variant === "brand" ? { position: "absolute", inset: 0 } : timings}
      aria-hidden="true"
    >
      {variant === "brand" && (
        <defs>
          <linearGradient id="htRingGrad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
      )}
      <circle
        cx="64"
        cy="64"
        r="44"
        stroke={variant === "brand" ? "url(#htRingGrad)" : "currentColor"}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray="60 220"
      />
    </svg>
  );

  if (variant === "ring") {
    return (
      <span
        className={className}
        role="status"
        aria-label={label || undefined}
        aria-hidden={label ? undefined : true}
        style={{ display: "inline-flex", lineHeight: 0 }}
      >
        {arc}
      </span>
    );
  }

  return (
    <div
      style={{ display: "grid", placeItems: "center", padding: "0.75rem" }}
      className={className}
      role="status"
      aria-label={label || undefined}
      aria-busy="true"
      aria-live="polite"
    >
      <div style={{ position: "relative", width: size, height: size, ...timings }}>
        {arc}

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
            src="/logo-loader.png"
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
      </div>
    </div>
  );
};

export default LoadingIndicator;
