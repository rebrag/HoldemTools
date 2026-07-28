// src/bankroll/desktop/shared.tsx
// Small presentational atoms shared by the desktop layout variants.
import React from "react";
import { SlidingNumber } from "@/components/ui/shadcn-io/sliding-number";
import type { BankrollStats, BankrollSession, CumulativePoint, FilterState } from "../types";

/** Everything a desktop layout needs from BankrollTracker. */
export interface DesktopLayoutProps {
  stats: BankrollStats;
  displayStats: BankrollStats;
  isHoveringChart: boolean;
  loading: boolean;
  error: string | null;
  cumulativePoints: CumulativePoint[];
  chartNonce: number;
  onHoverIndexChange: (idx: number | null) => void;
  filteredSessions: BankrollSession[];
  totalSessions: number;
  filteredCount: number;
  isFiltering: boolean;
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  knownLocations: string[];
  knownGames: string[];
  onResetFilters: () => void;
  onThisYear: () => void;
  onAddSession: () => void;
  onEditSession: (s: BankrollSession) => void;
  onDeleteSession: (id: string) => void;
}

export const GlassCard: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className = "", children }) => (
  <div
    className={`rounded-2xl border border-white/10 bg-white/[0.06] shadow-xl shadow-black/20 backdrop-blur-md ${className}`}
  >
    {children}
  </div>
);

/** Signed money value rendered with the SlidingNumber roller. */
export const SlidingMoney: React.FC<{
  value: number;
  decimalPlaces?: number;
  className?: string;
}> = ({ value, decimalPlaces = 0, className = "" }) => {
  const positive = value >= 0;
  return (
    <span
      className={`tabular-nums inline-flex items-baseline whitespace-nowrap ${
        positive ? "text-emerald-300" : "text-rose-300"
      } ${className}`}
    >
      <span className="mr-0.5">{positive ? "+$" : "-$"}</span>
      <SlidingNumber
        number={Math.abs(value)}
        decimalPlaces={decimalPlaces}
        inView={true}
      />
    </span>
  );
};

export function humanHoursLabel(totalHours: number): string {
  if (!Number.isFinite(totalHours) || totalHours <= 0) {
    return "0 Hrs 0 Mins";
  }
  const totalMinutes = Math.round(totalHours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h} Hrs ${String(m).padStart(2, "0")} Mins`;
}

export const AddSessionButton: React.FC<{
  onClick: () => void;
  className?: string;
}> = ({ onClick, className = "" }) => (
  <button
    type="button"
    onClick={onClick}
    className={`group inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 px-5 py-2 text-sm font-semibold text-emerald-950 shadow-lg shadow-emerald-500/30 ring-1 ring-emerald-300/60 transition hover:from-emerald-400 hover:to-emerald-300 hover:shadow-emerald-400/40 active:scale-[0.98] ${className}`}
  >
    <span className="text-base leading-none transition-transform group-hover:rotate-90">
      ＋
    </span>
    Add Session
  </button>
);

export const ErrorBanner: React.FC<{ message: string }> = ({ message }) => (
  <div className="rounded-lg border border-rose-500/40 bg-rose-950/60 px-3 py-2 text-sm text-rose-100 shadow-sm shadow-rose-500/20">
    {message}
  </div>
);

/** Small segmented pill control, dark-theme styled. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}): React.ReactElement {
  return (
    <div className="inline-flex items-center rounded-full bg-white/10 p-[2px] text-[11px]">
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`px-2.5 py-1 rounded-full transition text-[11px] ${
              active
                ? "bg-emerald-400 text-emerald-950 font-semibold shadow-sm"
                : "text-emerald-100/80 hover:text-emerald-50"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export const FilterToggleButton: React.FC<{
  active: boolean;
  isFiltering: boolean;
  onClick: () => void;
}> = ({ active, isFiltering, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
      active
        ? "border-emerald-300/60 bg-emerald-400/20 text-emerald-200"
        : "border-white/15 bg-white/5 text-emerald-100/85 hover:bg-white/10"
    }`}
  >
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M3 4h14v2l-5 5v4l-4 2v-6L3 6V4z" fill="currentColor" />
    </svg>
    <span>Filter</span>
    {isFiltering && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
  </button>
);
