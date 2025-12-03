// src/bankroll/AnimatedNumber.tsx
"use client";

import React from "react";
import type { SpringOptions } from "motion/react";
import { SlidingNumber } from "../components/ui/shadcn-io/sliding-number";

type AnimatedNumberProps = {
  value: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  decimalPlaces?: number;
  animate?: boolean;
  inView?: boolean;
  transition?: SpringOptions;
};

const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  className,
  prefix,
  suffix,
  decimalPlaces = 0,
  animate = true,
  inView = true,
  transition,
}) => {
  const formatWithGrouping = (val: number) => {
    if (decimalPlaces != null) {
      return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }).format(val);
    }
    return new Intl.NumberFormat("en-US").format(val);
  };

  // If animation is disabled, just render a formatted number with commas.
  if (!animate) {
    const formatted = formatWithGrouping(value);

    return (
      <span className={className}>
        {prefix}
        {formatted}
        {suffix}
      </span>
    );
  }

  return (
    <span className={className}>
      {prefix && <span className="mr-0.5">{prefix}</span>}
      <SlidingNumber
        number={value}
        decimalPlaces={decimalPlaces}
        inView={inView}
        transition={
          transition ?? {
            stiffness: 200,
            damping: 20,
            mass: 0.4,
          }
        }
      />
      {suffix && <span className="ml-0.5">{suffix}</span>}
    </span>
  );
};

export default AnimatedNumber;
