// Range-wide numbers for both seats at the current postflop node: EV, equity,
// equity realisation and weighted combo count, GTO Wizard style.
//
// Each metric is arrowed against the other seat, since head-to-head is the
// comparison that means something here: postflop is zero-sum, so one seat's
// equity is the other's shortfall and the arrows read as "who is winning this
// node". Absolute colouring would need a baseline that does not exist.
import React from "react";
import type { NodeStats, SeatNodeStats } from "@/lib/solver/nodeStats";

interface SeatStatsPanelProps {
  stats: NodeStats | null;
  /** Seat that acts at this node, badged so it is obvious whose turn it is. */
  actorSeat?: string;
  className?: string;
}

type Metric = {
  label: string;
  /** Rendered value, or null when the data cannot support it. */
  text: (s: SeatNodeStats, chipEv: boolean) => string | null;
  /** Sort key for the head-to-head arrow. */
  value: (s: SeatNodeStats) => number | null;
  /** Tooltip; takes chipEv because the EV unit depends on it. */
  title?: (chipEv: boolean) => string;
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
    // so the unit is dropped rather than implied.
    text: (s, chipEv) =>
      chipEv
        ? s.evBB != null
          ? `${fmt(s.evBB, 2)} bb`
          : null
        : s.ev != null
          ? fmt(s.ev, 2)
          : null,
    value: (s) => s.ev,
    title: (chipEv) =>
      chipEv
        ? "Average chips this range wins at this node, in big blinds."
        : "This solve is ICM, so EV is in tournament-equity units rather than chips - there is no bb conversion.",
  },
  {
    label: "Equity",
    text: (s) => (s.equity != null ? `${fmt(s.equity * 100, 2)}%` : null),
    value: (s) => s.equity,
  },
  {
    label: "EQR",
    title: () =>
      "Equity realisation: the share of its raw equity this range turns into EV. Above 100% means it wins more than the cards alone are worth.",
    text: (s) => (s.eqr != null ? `${fmt(s.eqr * 100, 0)}%` : null),
    value: (s) => s.eqr,
  },
  {
    label: "Combos",
    title: () => "Weighted combo count, so a partially weighted range is fractional.",
    text: (s) => (s.combos != null ? fmt(s.combos, 1) : null),
    value: (s) => s.combos,
  },
];

/** -1 / 0 / 1 for this seat against the other, null when not comparable. */
const compare = (mine: number | null, theirs: number | null): number | null => {
  if (mine == null || theirs == null) return null;
  if (Math.abs(mine - theirs) < 1e-9) return 0;
  return mine > theirs ? 1 : -1;
};

const SeatRow: React.FC<{
  seat: SeatNodeStats;
  other: SeatNodeStats;
  chipEv: boolean;
  isActor: boolean;
}> = ({ seat, other, chipEv, isActor }) => (
  <div
    data-testid="seat-stats-row"
    data-role={seat.role}
    className={`flex min-w-0 items-center gap-1.5 rounded-[4px] px-1.5 py-1 ${
      isActor ? "bg-emerald-400/10 ring-1 ring-emerald-400/40" : "bg-white/[0.04]"
    }`}
  >
    <div className="flex w-[68px] flex-shrink-0 items-baseline gap-1">
      <span className="truncate text-[11px] font-bold text-slate-100">
        {seat.seat}
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
        {seat.role}
      </span>
    </div>

    {METRICS.map((m) => {
      const text = m.text(seat, chipEv);
      const dir = compare(m.value(seat), m.value(other));
      const tone =
        dir === 1
          ? "text-emerald-400"
          : dir === -1
            ? "text-rose-400"
            : "text-slate-200";
      return (
        <div
          key={m.label}
          data-testid="seat-stat"
          data-metric={m.label}
          className="flex min-w-0 flex-1 flex-col leading-tight"
          title={m.title?.(chipEv)}
        >
          <span className="truncate text-[9px] font-medium uppercase tracking-wide text-slate-400">
            {m.label}
          </span>
          <span className={`truncate text-[11px] font-semibold tabular-nums ${tone}`}>
            {dir === 1 ? "▲" : dir === -1 ? "▼" : ""}
            {text ?? "-"}
          </span>
        </div>
      );
    })}
  </div>
);

const SeatStatsPanel: React.FC<SeatStatsPanelProps> = ({
  stats,
  actorSeat,
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
        other={stats.ip}
        chipEv={stats.chipEv}
        isActor={stats.oop.seat === actorSeat}
      />
      <SeatRow
        seat={stats.ip}
        other={stats.oop}
        chipEv={stats.chipEv}
        isActor={stats.ip.seat === actorSeat}
      />
    </div>
  );
};

export default SeatStatsPanel;
