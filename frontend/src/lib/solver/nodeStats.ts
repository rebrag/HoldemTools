// Range-wide numbers for both seats at one postflop node: EV, equity and
// weighted combo count.
//
// The values themselves come straight from `doc.seat_stats`, which the watcher
// fills from Pio (`calc_eq_node` for equity, `show_range` for the weighted
// combo count, the range-weighted mean of `calc_ev` for EV). Nothing here
// recomputes them; this only picks the EV unit and guards against nulls.
import type { PioSolutionDoc, SeatStats } from "./postflopClient";

export interface SeatNodeStats {
  role: "oop" | "ip";
  seat: string;
  /** Weighted combo count - fractional for a partially weighted range. */
  combos: number | null;
  /** Share of the pot this range wins on average, 0..1. */
  equity: number | null;
  /** EV in the solve's own units. */
  ev: number | null;
  /** EV in bb, only when the solve is chip-denominated (see `chipEv`). */
  evBB: number | null;
}

export interface NodeStats {
  oop: SeatNodeStats;
  ip: SeatNodeStats;
  /**
   * Whether EV is chip-denominated, so `evBB` is meaningful. ICM solves report
   * EV in tournament-equity units instead, which have no bb conversion.
   */
  chipEv: boolean;
}

/** bb are 100 chips everywhere in the postflop pipeline. */
const CHIPS_PER_BB = 100;

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Build the display stats for both seats.
 *
 * `potChips` is only used to decide whether EV is in chips, which decides
 * whether a bb conversion is meaningful. ICM boards report EV in
 * tournament-equity units - one of ours sums to 3.93 against a 550-chip pot -
 * so dividing those by 100 would produce a confident-looking wrong number.
 */
export function buildNodeStats(
  doc: PioSolutionDoc | null | undefined,
  seats: { oop: string; ip: string },
  potChips?: number | null
): NodeStats | null {
  const stats = doc?.seat_stats;
  if (!stats) return null;

  const evSum =
    finite(stats.oop?.ev) && finite(stats.ip?.ev)
      ? stats.oop!.ev! + stats.ip!.ev!
      : null;

  /* Same-unit test rather than trusting a flag: on chip solves the EV sum
     lands within a few percent of the pot, while an ICM solve is off by orders
     of magnitude, so a wide band separates them cleanly. */
  const chipEv =
    finite(evSum) &&
    finite(potChips) &&
    potChips > 0 &&
    evSum >= potChips * 0.5 &&
    evSum <= potChips * 2;

  const seatStats = (role: "oop" | "ip"): SeatNodeStats => {
    const s: SeatStats | null | undefined = stats[role];
    const ev = finite(s?.ev) ? s!.ev! : null;
    return {
      role,
      seat: seats[role],
      combos: finite(s?.combos) ? s!.combos! : null,
      equity: finite(s?.equity) ? s!.equity! : null,
      ev,
      evBB: chipEv && ev != null ? ev / CHIPS_PER_BB : null,
    };
  };

  return { oop: seatStats("oop"), ip: seatStats("ip"), chipEv };
}
