// src/hooks/useDismissOnOutside.ts
// The dismissal half of an anchored popover: an outside press or Escape closes
// it. Listeners are attached only while `open`, so a closed popover costs
// nothing at idle (see "Battery discipline" in frontend/CLAUDE.md).
//
// mousedown/touchstart rather than click, so the popover closes on press
// instead of waiting for a release that may land somewhere else entirely.
import { useEffect } from "react";

export function useDismissOnOutside(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void
): void {
  useEffect(() => {
    if (!open) return;

    const onPress = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", onPress);
    document.addEventListener("touchstart", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPress);
      document.removeEventListener("touchstart", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onClose]);
}

export default useDismissOnOutside;
