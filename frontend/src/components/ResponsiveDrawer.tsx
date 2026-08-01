// src/components/ResponsiveDrawer.tsx
// Shared overlay shell: bottom sheet on mobile (<640px), centered modal on
// desktop. Extracted from LoginSignupModal so every drawer-style surface
// (login, tree building, solve prompt) shares one backdrop / motion /
// Escape / scroll-lock implementation.
//
// AnimatePresence lives INSIDE this component and wraps the `open &&`
// conditional, so parents must stay mounted and toggle `open` for the exit
// animation to play. A parent that conditionally mounts the drawer itself
// still works, but its close skips the exit animation.
import { useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import useWindowDimensions from "@/hooks/useWindowDimensions";

export interface ResponsiveDrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Desktop panel width, e.g. "sm:max-w-md" (default) or "sm:max-w-2xl". */
  desktopMaxWidthClassName?: string;
  /** Stacking context for the whole overlay (backdrop + panel). */
  zClassName?: string;
  /** "panel": padded panel that scrolls itself (forms).
   *  "custom": unpadded `flex flex-col overflow-hidden` panel; children own
   *  the header / scroll region / pinned footer. */
  scrollMode?: "panel" | "custom";
  /** Extra classes merged onto the panel, after the defaults. */
  panelClassName?: string;
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  ariaLabelledBy?: string;
  ariaLabel?: string;
}

const ResponsiveDrawer: React.FC<ResponsiveDrawerProps> = ({
  open,
  onClose,
  children,
  desktopMaxWidthClassName = "sm:max-w-md",
  zClassName = "z-50",
  scrollMode = "panel",
  panelClassName = "",
  showCloseButton = true,
  closeOnBackdrop = true,
  ariaLabelledBy,
  ariaLabel,
}) => {
  const { windowWidth } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const isMobile = windowWidth < 640; // Tailwind `sm` breakpoint

  /* ---------- close on Escape + lock body scroll (only while open) ---------- */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  /* ---------- entrance motion (slide-up on mobile, scale on desktop) ------- */
  const panelVariants = reduceMotion
    ? {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { duration: 0.15 } },
        exit: { opacity: 0, transition: { duration: 0.1 } },
      }
    : isMobile
    ? {
        hidden: { opacity: 0, y: 48 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const },
        },
        exit: { opacity: 0, y: 48, transition: { duration: 0.2 } },
      }
    : {
        hidden: { opacity: 0, scale: 0.96, y: 8 },
        show: {
          opacity: 1,
          scale: 1,
          y: 0,
          transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
        },
        exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15 } },
      };

  const scrollClasses =
    scrollMode === "panel"
      ? "px-5 pt-3 pb-8 sm:px-8 sm:py-8 overflow-y-auto"
      : "flex flex-col overflow-hidden";

  return (
    <AnimatePresence>
      {open && (
        <div className={`fixed inset-0 ${zClassName}`}>
          {/* screen-dimming, click-to-close backdrop */}
          <motion.div
            key="backdrop"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onMouseDown={closeOnBackdrop ? onClose : undefined}
            aria-hidden="true"
          />

          {/* positioning wrapper — bottom sheet on mobile, centered on desktop */}
          <div className="absolute inset-0 flex justify-center items-end sm:items-center pointer-events-none">
            <motion.div
              key="panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby={ariaLabelledBy}
              aria-label={ariaLabel}
              variants={panelVariants}
              initial="hidden"
              animate="show"
              exit="exit"
              className={`
                pointer-events-auto relative
                w-full rounded-t-3xl
                sm:w-full ${desktopMaxWidthClassName} sm:rounded-2xl sm:m-4
                bg-surface/80 backdrop-blur-xl border border-hairline
                shadow-2xl text-slate-100
                max-h-[92vh]
                ${scrollClasses}
                ${panelClassName}
              `}
            >
              {/* mobile grab handle */}
              {scrollMode === "panel" ? (
                <div className="sm:hidden mx-auto mb-4 h-1.5 w-10 rounded-full bg-white/20" />
              ) : (
                <div className="sm:hidden mx-auto mt-3 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-white/20" />
              )}

              {/* close button */}
              {showCloseButton && (
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="absolute right-3 top-3 sm:right-4 sm:top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <X size={16} strokeWidth={2.2} />
                </button>
              )}

              {children}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default ResponsiveDrawer;
