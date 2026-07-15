import { JSX, ReactNode, type MouseEvent } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  /** Max tilt in degrees. */
  max?: number;
  /** Lift on hover (px). */
  lift?: number;
}

/**
 * Pointer-driven 3D tilt with a springy return-to-rest. Used by the Kinetic
 * design to make cards feel physical. Disabled under reduced-motion.
 */
export function TiltCard({
  children,
  className,
  max = 9,
  lift = 6,
}: TiltCardProps): JSX.Element {
  const reduce = useReducedMotion();
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springX = useSpring(rotateX, { stiffness: 160, damping: 16 });
  const springY = useSpring(rotateY, { stiffness: 160, damping: 16 });

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    if (reduce) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    rotateY.set(px * max * 2);
    rotateX.set(-py * max * 2);
  };

  const handleLeave = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <motion.div
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{
        rotateX: springX,
        rotateY: springY,
        transformPerspective: 1000,
        transformStyle: "preserve-3d",
      }}
      whileHover={reduce ? undefined : { y: -lift }}
      transition={{ duration: 0.3 }}
      className={cn("will-change-transform", className)}
    >
      {children}
    </motion.div>
  );
}
