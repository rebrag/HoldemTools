import { useEffect, useState } from "react";

/**
 * True while the tab is visible. Decorative animation loops key off this so
 * they stop burning CPU/GPU when the app is backgrounded.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document === "undefined" ? true : !document.hidden,
  );

  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}
