import { JSX, useMemo, useRef } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { usePageVisible } from "@/hooks/usePageVisible";

/**
 * Magic-UI style meteor shower. Purely decorative; skipped under
 * reduced-motion. Meteors are cheap CSS-animated streaks, paused while
 * off-screen or in a hidden tab so they don't composite forever.
 */
export function Meteors({ count = 14 }: { count?: number }): JSX.Element | null {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const pageVisible = usePageVisible();
  const running = inView && pageVisible;

  const meteors = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        left: `${Math.floor(Math.random() * 100)}%`,
        delay: `${(Math.random() * 4).toFixed(2)}s`,
        duration: `${(3 + Math.random() * 4).toFixed(2)}s`,
      })),
    [count],
  );

  if (reduce) return null;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {meteors.map((m) => (
        <span
          key={m.id}
          className="animate-meteor absolute top-0 h-0.5 w-0.5 rounded-full bg-emerald-200 shadow-[0_0_0_1px_rgba(255,255,255,0.1)]"
          style={{
            left: m.left,
            animationDelay: m.delay,
            animationDuration: m.duration,
            animationPlayState: running ? "running" : "paused",
          }}
        >
          <span className="absolute top-1/2 h-px w-16 -translate-y-1/2 bg-gradient-to-r from-emerald-300/70 to-transparent" />
        </span>
      ))}
    </div>
  );
}
