// src/bankroll/AnimatedNumber.tsx
import React, { useEffect, useRef, useState } from "react";

type AnimatedNumberProps = {
  value: number;
  format?: (value: number) => string;
  className?: string;
  animate?: boolean;
  durationMs?: number;
};

const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  format = (v) => v.toString(),
  className,
  animate = true,
  durationMs = 0,
}) => {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValueRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!animate || durationMs <= 0) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      previousValueRef.current = value;
      setDisplayValue(value);
      return;
    }

    const start = previousValueRef.current;
    const end = value;

    if (start === end) return;

    const startTime = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out
      const next = start + (end - start) * eased;
      setDisplayValue(next);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    previousValueRef.current = end;

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [value, animate, durationMs]);

  return <span className={className}>{format(displayValue)}</span>;
};

export default AnimatedNumber;
