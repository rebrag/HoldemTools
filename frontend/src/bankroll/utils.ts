// src/bankroll/utils.ts
import type { BankrollSession } from "./types";

export const formatMoney = (val: number | null | undefined): string => {
  if (val == null) return "—";

  const rounded = Math.round(val * 100) / 100;
  if (Number.isInteger(rounded)) {
    return rounded.toLocaleString();
  }

  return rounded.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const formatHours = (val: number | null | undefined): string => {
  if (val == null) return "—";

  const rounded = Math.round(val * 100) / 100;
  if (Number.isInteger(rounded)) {
    return rounded.toString();
  }
  return rounded.toFixed(1);
};

export const toLocalInputValue = (iso: string | null): string => {
  if (!iso) return "";
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "";
  const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

export const buildCumulativePoints = (sessions: BankrollSession[]) => {
  if (!sessions.length) {
    return [{ x: 0, y: 0, session: null }];
  }

  const ordered = [...sessions].sort((a, b) => {
    const aTime = a.start ? new Date(a.start).getTime() : 0;
    const bTime = b.start ? new Date(b.start).getTime() : 0;
    return aTime - bTime;
  });

  const points: { x: number; y: number; session: BankrollSession | null }[] = [
    { x: 0, y: 0, session: null },
  ];

  let cumHours = 0;
  let cumProfit = 0;
  for (const s of ordered) {
    cumHours += s.hours ?? 0;
    cumProfit += s.profit ?? 0;
    points.push({ x: cumHours, y: cumProfit, session: s });
  }
  return points;
};
