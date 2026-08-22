// src/components/filters/dateBounds.ts
// Date-input parsing shared by every filter consumer, so "from 00:00 local to
// 23:59:59.999 local" means the same thing on the bankroll page and the hand
// list. Partial input (a date being typed) is ignored rather than misparsed.
export function parseDateBound(dateStr: string, endOfDay: boolean): number | null {
  if (!dateStr || dateStr.length < 10) return null; // ignore partial input
  const full = endOfDay ? `${dateStr}T23:59:59.999` : `${dateStr}T00:00:00`;
  const t = new Date(full).getTime();
  return Number.isNaN(t) ? null : t;
}
