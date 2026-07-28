// Range-wide numbers for both seats at the current postflop node: EV, equity
// and weighted combo count. The acting seat is ringed.
import React from "react";
import type { NodeStats, SeatNodeStats } from "@/lib/solver/nodeStats";
import type { MoneyDisplay } from "./boardDisplay";

type MoneyOpts = Pick<MoneyDisplay, "mode" | "bbSize">;

interface SeatStatsPanelProps {
  stats: NodeStats | null;
  /** Seat that acts at this node, badged so it is obvious whose turn it is. */
  actorSeat?: string;
  /** Position -> real player name (hand-history solves). */
  names?: Record<string, string>;
  /** Chips/bb display (hand-history solves): EVs convert with it. */
  money?: MoneyOpts;
  className?: string;
}

type Metric = {
  label: string;
  /** Rendered value, or null when the data cannot support it. */
  text: (s: SeatNodeStats, chipEv: boolean, money?: MoneyOpts) => string | null;
  /** Tooltip; takes chipEv because the EV unit depends on it. */
  title?: (chipEv: boolean, money?: MoneyOpts) => string;
};

const fmt = (n: number, digits: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const METRICS: Metric[] = [
  {
    label: "EV",
    // ICM solves report EV in tournament equity, which has no bb conversion,
    // so the unit is dropped rather than implied. Hand-history solves can
    // additionally convert bb EV into the hand's real chips.
    text: (s, chipEv, money) => {
      if (!chipEv) return s.ev != null ? fmt(s.ev, 2) : null;
      if (s.evBB == null) return null;
      return money && money.mode === "chips"
        ? fmt(s.evBB * money.bbSize, 2)
        : `${fmt(s.evBB, 2)} bb`;
    },
    title: (chipEv, money) =>
      chipEv
        ? money && money.mode === "chips"
          ? "Average amount this range wins at this node, in the hand's own chips."
          : "Average chips this range wins at this node, in big blinds."
        : "This solve is ICM, so EV is in tournament-equity units rather than chips - there is no bb conversion.",
  },
  {
    label: "Equity",
    text: (s) => (s.equity != null ? `${fmt(s.equity * 100, 2)}%` : null),
  },
  {
    label: "Combos",
    title: () => "Weighted combo count, so a partially weighted range is fractional.",
    text: (s) => (s.combos != null ? fmt(s.combos, 1) : null),
  },
];

const SeatRow: React.FC<{
  seat: SeatNodeStats;
  chipEv: boolean;
  isActor: boolean;
  name?: string;
  money?: MoneyOpts;
}> = ({ seat, chipEv, isActor, name, money }) => (
  <div
    data-testid="seat-stats-row"
    data-role={seat.role}
    className={`flex min-w-0 items-center gap-1.5 rounded-[4px] px-1.5 py-1 ${
      isActor ? "bg-emerald-400/10 ring-1 ring-emerald-400/40" : "bg-white/[0.04]"
    }`}
  >
    <div
      className="flex w-[68px] flex-shrink-0 items-baseline gap-1"
      title={name ? `${name} (${seat.seat})` : undefined}
    >
      <span className="truncate text-[11px] font-bold text-white">
        {name ?? seat.seat}
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
        {name ? seat.seat : seat.role}
      </span>
    </div>

    {METRICS.map((m) => (
      <div
        key={m.label}
        data-testid="seat-stat"
        data-metric={m.label}
        className="flex min-w-0 flex-1 flex-col leading-tight"
        title={m.title?.(chipEv, money)}
      >
        <span className="truncate text-[9px] font-medium uppercase tracking-wide text-slate-400">
          {m.label}
        </span>
        <span className="truncate text-[11px] font-semibold tabular-nums text-white">
          {m.text(seat, chipEv, money) ?? "-"}
        </span>
      </div>
    ))}
  </div>
);

const SeatStatsPanel: React.FC<SeatStatsPanelProps> = ({
  stats,
  actorSeat,
  names,
  money,
  className,
}) => {
  if (!stats) return null;
  return (
    <div
      data-testid="seat-stats"
      className={`flex flex-shrink-0 flex-col gap-1 rounded-md border border-white/15 bg-slate-950/35 p-1 ${
        className ?? ""
      }`}
    >
      <SeatRow
        seat={stats.oop}
        chipEv={stats.chipEv}
        isActor={stats.oop.seat === actorSeat}
        name={names?.[stats.oop.seat]}
        money={money}
      />
      <SeatRow
        seat={stats.ip}
        chipEv={stats.chipEv}
        isActor={stats.ip.seat === actorSeat}
        name={names?.[stats.ip.seat]}
        money={money}
      />
    </div>
  );
};

export default SeatStatsPanel;
