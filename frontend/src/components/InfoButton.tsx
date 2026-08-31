// src/components/InfoButton.tsx
// A small "i" affordance that moves an explanation OFF the page and into an
// overlay. Reach for it whenever a block of supporting material - rules,
// derivations, a reference table, a checker - is worth keeping available but
// is not what the page is for: leaving it inline pushes the inputs and the
// results apart, which is the problem this component exists to avoid.
//
// The overlay is ResponsiveDrawer (bottom sheet on mobile, centered modal on
// desktop), so backdrop, Escape, scroll lock and motion are the app's shared
// implementation. Children are only mounted while the panel is open, so an
// expensive or stateful child costs nothing until someone asks for it - and
// it starts fresh each time, which suits reference material.
import React, { useId, useState } from "react";
import { Info } from "lucide-react";
import clsx from "clsx";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";

export interface InfoButtonProps {
  /** Panel heading, and the button's accessible name when there is no label. */
  title: string;
  /** What the panel explains. */
  children: React.ReactNode;
  /** Optional text beside the icon. Without it the button is an icon-only circle. */
  label?: string;
  /** Optional one-line standfirst under the panel heading. */
  description?: string;
  /** Panel width on desktop; wide content (tables, card grids) wants more. */
  desktopMaxWidthClassName?: string;
  size?: "sm" | "md";
  className?: string;
}

const InfoButton: React.FC<InfoButtonProps> = ({
  title,
  children,
  label,
  description,
  desktopMaxWidthClassName = "sm:max-w-2xl",
  size = "sm",
  className,
}) => {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const iconPx = size === "sm" ? 14 : 16;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ? undefined : title}
        title={title}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05]",
          "text-emerald-100/70 transition-colors hover:bg-white/10 hover:text-emerald-100",
          "active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          // Icon-only stays a circle; a labelled button gets a pill.
          label
            ? size === "sm"
              ? "px-2.5 py-1 text-xs"
              : "px-3 py-1.5 text-sm"
            : size === "sm"
              ? "h-6 w-6 justify-center"
              : "h-8 w-8 justify-center",
          className
        )}
      >
        <Info size={iconPx} strokeWidth={2.2} aria-hidden="true" />
        {label && <span>{label}</span>}
      </button>

      <ResponsiveDrawer
        open={open}
        onClose={() => setOpen(false)}
        desktopMaxWidthClassName={desktopMaxWidthClassName}
        ariaLabelledBy={headingId}
      >
        <h2 id={headingId} className="pr-10 text-lg font-semibold text-white">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-emerald-100/70">{description}</p>}
        <div className="mt-4">{children}</div>
      </ResponsiveDrawer>
    </>
  );
};

export default InfoButton;
