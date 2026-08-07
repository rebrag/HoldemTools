import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import LoadingIndicator from "@/components/LoadingIndicator";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";

type Props = {
  /** Whether the wait is in progress. */
  active: boolean;
  /** Extra classes on the overlay (e.g. a scrim, or a different z-index). */
  className?: string;
  size?: number;
};

/**
 * Brand spinner centred over the nearest positioned ancestor, mounted only
 * while it is actually shown.
 *
 * These overlays used to stay mounted permanently at `opacity-0`, which kept
 * the ring rotation and the 3D chip flip compositing the whole time a user was
 * studying a range.
 *
 * Timings differ from the branch case on purpose. An overlay sits *on top of*
 * content, so delaying it would reveal the empty grid underneath — the flash we
 * are trying to remove. So it shows immediately and instead holds for a minimum
 * once shown, which is what actually prevents a strobe on a fast response.
 */
const LoadingOverlay: React.FC<Props> = ({ active, className, size }) => {
  const visible = useDelayedLoading(active, { showAfterMs: 0, minVisibleMs: 300 });

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          className={`absolute inset-0 z-50 flex items-center justify-center ${className ?? ""}`}
        >
          <LoadingIndicator size={size} />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default LoadingOverlay;
