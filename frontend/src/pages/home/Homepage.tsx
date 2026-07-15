import { JSX, useEffect } from "react";
import KineticArcade from "./designs/KineticArcade";

/**
 * Homepage shell. Renders the Kinetic Arcade design and fires a best-effort
 * backend warm-up so the visitor's first tool click is fast.
 */
export default function Homepage(): JSX.Element {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;

  // Best-effort SQL warm-up so the first tool click is fast (throttled hourly).
  useEffect(() => {
    if (!API_BASE_URL) return;

    const WARM_KEY = "ht_sql_warmup_last_hit_v1";
    const now = Date.now();
    const last = Number(window.localStorage.getItem(WARM_KEY) ?? 0);
    const WARM_INTERVAL_MS = 55 * 60 * 1000;

    if (Number.isFinite(last) && now - last < WARM_INTERVAL_MS) return;

    window.localStorage.setItem(WARM_KEY, String(now));
    void fetch(`${API_BASE_URL}/api/warmup/sql`, {
      method: "GET",
      cache: "no-store",
      keepalive: true,
    }).catch(() => {
      // Warm-up is best-effort and should never affect homepage UX.
    });
  }, [API_BASE_URL]);

  return <KineticArcade />;
}
