import { JSX } from "react";
import type { PreviewId } from "../content";
import { RangeGridPreview } from "./RangeGridPreview";
import { EquityDuelPreview } from "./EquityDuelPreview";
import { BankrollSparkline } from "./BankrollSparkline";
import { CourseProgressPreview } from "./CourseProgressPreview";

/** Renders the live "internals" preview for a given tool. */
export function ToolPreview({
  id,
  className,
}: {
  id: PreviewId;
  className?: string;
}): JSX.Element {
  switch (id) {
    case "range":
      return <RangeGridPreview className={className} />;
    case "equity":
      return <EquityDuelPreview className={className} />;
    case "bankroll":
      return <BankrollSparkline className={className} />;
    case "course":
      return <CourseProgressPreview className={className} />;
  }
}
