import { CSSProperties, JSX } from "react";
import { useReducedMotion } from "framer-motion";
import { usePageVisible } from "@/hooks/usePageVisible";
import { cn } from "@/lib/utils";

interface AuroraBackgroundProps {
  /** "aurora" = soft multi-hue drift; "table" = darker cinematic felt glow. */
  variant?: "aurora" | "table";
  className?: string;
}

/**
 * Fixed full-bleed animated backdrop. GPU-cheap: a few large blurred radial
 * blobs on CSS keyframe drift, a faint grid, and a vignette - no WebGL.
 * Sits behind everything at -z-10 and blends with the app's dark scheme.
 */
export function AuroraBackground({
  variant = "aurora",
  className,
}: AuroraBackgroundProps): JSX.Element {
  const reduce = useReducedMotion();
  const pageVisible = usePageVisible();
  const drift = reduce ? "" : "animate-aurora";
  // The blurred blobs are the priciest layers to composite; freeze the drift
  // while the tab is hidden.
  const driftStyle: CSSProperties = pageVisible
    ? {}
    : { animationPlayState: "paused" };

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-slate-950",
        className,
      )}
    >
      {/* faint tactical grid */}
      <div
        className="absolute inset-0 opacity-[0.6]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse 90% 70% at 50% 0%, black 40%, transparent 85%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 90% 70% at 50% 0%, black 40%, transparent 85%)",
        }}
      />

      {variant === "aurora" ? (
        <>
          <div
            className={cn(
              "absolute -top-40 left-[8%] h-[38rem] w-[38rem] rounded-full blur-[130px]",
              drift,
            )}
            style={{ background: "rgba(16,185,129,0.28)", ...driftStyle }}
          />
          <div
            className={cn(
              "absolute top-[18%] right-[4%] h-[34rem] w-[34rem] rounded-full blur-[130px]",
              drift,
            )}
            style={{ background: "rgba(56,189,248,0.20)", animationDelay: "-6s", ...driftStyle }}
          />
          <div
            className={cn(
              "absolute bottom-[-12%] left-[30%] h-[36rem] w-[36rem] rounded-full blur-[140px]",
              drift,
            )}
            style={{ background: "rgba(167,139,250,0.18)", animationDelay: "-11s", ...driftStyle }}
          />
        </>
      ) : (
        <>
          <div
            className={cn(
              "absolute -top-52 left-1/2 h-[46rem] w-[60rem] -translate-x-1/2 rounded-full blur-[150px]",
              drift,
            )}
            style={{ background: "rgba(16,185,129,0.22)", ...driftStyle }}
          />
          <div
            className={cn(
              "absolute bottom-[-20%] right-[-6%] h-[40rem] w-[40rem] rounded-full blur-[150px]",
              drift,
            )}
            style={{ background: "rgba(20,184,166,0.16)", animationDelay: "-8s", ...driftStyle }}
          />
        </>
      )}

      {/* vignette so content stays readable */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(2,6,23,0.55)_70%,rgba(2,6,23,0.92)_100%)]" />
    </div>
  );
}
