import { JSX, useMemo } from "react";
import { useReducedMotion } from "framer-motion";
import PlayingCard from "@/components/PlayingCard";
import { CardBack } from "@/components/PokerTable";

/**
 * Decorative "cards flying around" backdrop for the Hand History page.
 * Purely cosmetic; skipped under reduced-motion. Mirrors the Meteors pattern:
 * a fixed set of face-up cards and rose card backs drift slowly across the
 * page at low opacity, driven by the CSS `animate-card-drift` keyframes.
 */

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7"];
const SUITS = ["s", "h", "d", "c"];

function randomCode(): string {
  const r = RANKS[Math.floor(Math.random() * RANKS.length)];
  const s = SUITS[Math.floor(Math.random() * SUITS.length)];
  return `${r}${s}`;
}

export function FlyingCards({ count = 20 }: { count?: number }): JSX.Element | null {
  const reduce = useReducedMotion();

  const cards = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        left: `${Math.floor(Math.random() * 100)}%`,
        top: `${Math.floor(Math.random() * 100)}%`,
        delay: `${(Math.random() * 12).toFixed(2)}s`,
        duration: `${(18 + Math.random() * 14).toFixed(2)}s`,
        rotate: `${Math.floor(Math.random() * 60) - 30}deg`,
        width: 34 + Math.floor(Math.random() * 30),
        isBack: i % 2 === 0,
        code: randomCode(),
      })),
    [count]
  );

  if (reduce) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-[5] overflow-hidden opacity-[0.14]"
    >
      {cards.map((c) => (
        <div
          key={c.id}
          className="animate-card-drift absolute drop-shadow-[0_8px_20px_rgba(0,0,0,0.35)]"
          style={{
            left: c.left,
            top: c.top,
            animationDelay: c.delay,
            animationDuration: c.duration,
            // seeds the diagonal tilt the keyframes rotate around
            ["--card-rotate" as string]: c.rotate,
          }}
        >
          {c.isBack ? (
            <CardBack w={c.width} />
          ) : (
            <PlayingCard code={c.code} size="sm" width={c.width} />
          )}
        </div>
      ))}
    </div>
  );
}

export default FlyingCards;
