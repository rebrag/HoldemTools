// src/components/PokerTableSurface.tsx
// The visual "surface" of a poker table, styled as a perspective "poker-cam"
// table: an elliptical emerald felt sunk inside a top-lit slate rail with a
// visible front-edge thickness, a specular gloss, and a soft cast shadow, so
// the table reads as a solid 3D object tilted slightly toward the viewer.
// Colors follow the app's emerald / slate / blue theme (design-kit tokens).
// PokerTable renders through this; it can also fill an arbitrary sized
// container as a decorative backdrop.
import React from "react";

/** Top-lit slate rail: lighter along the top edge, darker toward the front. */
export const RAIL_SLATE =
  "linear-gradient(to bottom, #334155 0%, #1e293b 52%, #0b1120 100%)";

/** Default emerald felt shared by every table on the site. */
export const DEFAULT_FELT: React.CSSProperties = {
  background:
    "radial-gradient(ellipse at 50% 34%, #178a63 0%, #0d6b4c 58%, #063a29 100%)",
  boxShadow:
    "inset 0 8px 26px rgba(0,0,0,0.45), inset 0 -4px 12px rgba(0,0,0,0.35)",
};

export interface PokerTableSurfaceProps {
  /** Override the default green felt. */
  feltStyle?: React.CSSProperties;
  /** Extra classes on the outer wrapper. */
  className?: string;
  /**
   * Classes on the relative content box that holds the felt + children.
   * PokerTable passes its aspect-ratio box; fill mode uses the default
   * "relative h-full w-full".
   */
  innerClassName?: string;
  /**
   * Stretch the wrapper to h-full so the surface fills a sized parent
   * (the parent must have a definite height, e.g. `absolute inset-0`).
   */
  fill?: boolean;
  children?: React.ReactNode;
}

/** Shared classes for every elliptical layer stacked to build the table. */
const LAYER = "pointer-events-none absolute rounded-[50%]";

const PokerTableSurface: React.FC<PokerTableSurfaceProps> = ({
  feltStyle,
  className,
  innerClassName,
  fill = false,
  children,
}) => (
  <div className={`relative ${fill ? "h-full" : ""} ${className ?? ""}`}>
    <div className={innerClassName ?? "relative h-full w-full"}>
      {/* soft cast shadow beneath the table.
          `filter: blur` is one of the most expensive things to composite on
          mobile GPUs, so keep it light on phones and full-strength on ≥sm. */}
      <div
        className={`${LAYER} blur-[2px] sm:blur-[7px]`}
        style={{
          inset: "2% 1%",
          transform: "translateY(3.5%)",
          background: "rgba(0,0,0,0.45)",
        }}
        aria-hidden="true"
      />

      {/* front-edge thickness peeking below the rail -> sense of depth */}
      <div
        className={LAYER}
        style={{
          inset: "3%",
          transform: "translateY(1.8%)",
          background: "#060a14",
        }}
        aria-hidden="true"
      />

      {/* slate rail */}
      <div
        className={LAYER}
        style={{
          inset: "3%",
          background: RAIL_SLATE,
          boxShadow:
            "inset 0 3px 6px rgba(148,163,184,0.28), inset 0 -14px 28px rgba(0,0,0,0.6)",
        }}
        aria-hidden="true"
      />

      {/* rail top-edge highlight bevel (emerald-tinted) */}
      <div
        className={LAYER}
        style={{ inset: "3%", border: "1px solid rgba(52,211,153,0.22)" }}
        aria-hidden="true"
      />

      {/* felt */}
      <div className={LAYER} style={{ inset: "9%", ...(feltStyle ?? DEFAULT_FELT) }} aria-hidden="true" />

      {/* specular gloss near the top of the felt */}
      <div
        className={LAYER}
        style={{
          inset: "9%",
          background:
            "radial-gradient(ellipse at 50% 16%, rgba(255,255,255,0.16), rgba(255,255,255,0) 52%)",
        }}
        aria-hidden="true"
      />

      {/* inner rim ring on the felt (emerald-tinted) */}
      <div
        className={LAYER}
        style={{ inset: "13%", border: "1.5px solid rgba(110,231,183,0.16)" }}
        aria-hidden="true"
      />

      {children}
    </div>
  </div>
);

/**
 * Decorative container-filling table backdrop. Mount inside a
 * `position: relative` parent with definite height; it absorbs no pointer
 * events. Replaces the legacy `.poker-table-bg` / PokerBackground visuals.
 */
export const PokerTableBackdrop: React.FC<{
  feltStyle?: React.CSSProperties;
  className?: string;
}> = ({ feltStyle, className }) => (
  <div
    className={`pointer-events-none absolute inset-0 p-1 ${className ?? ""}`}
    aria-hidden="true"
  >
    <PokerTableSurface fill feltStyle={feltStyle} />
  </div>
);

export default PokerTableSurface;
