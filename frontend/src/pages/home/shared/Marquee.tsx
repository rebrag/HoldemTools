import { JSX, ReactNode, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface MarqueeProps {
  children: ReactNode;
  /** Seconds for one full loop. */
  durationSec?: number;
  reverse?: boolean;
  className?: string;
}

/**
 * Infinite horizontal marquee. Renders the children twice and translates the
 * track by -50% so the loop is seamless; edges are faded via `.marquee-mask`.
 * Pauses on hover.
 */
export function Marquee({
  children,
  durationSec = 40,
  reverse = false,
  className,
}: MarqueeProps): JSX.Element {
  return (
    <div className={cn("marquee-mask group relative overflow-hidden", className)}>
      <div
        className="flex w-max animate-marquee items-center group-hover:[animation-play-state:paused]"
        style={
          {
            "--marquee-duration": `${durationSec}s`,
            animationDirection: reverse ? "reverse" : "normal",
          } as CSSProperties
        }
      >
        <div className="flex shrink-0 items-center">{children}</div>
        <div className="flex shrink-0 items-center" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}
