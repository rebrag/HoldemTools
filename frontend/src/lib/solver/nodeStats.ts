// Range-wide numbers for both seats at one postflop node: EV, equity, equity
// realisation and weighted combo count.
//
// Everything here is derived from what the watcher already uploads
// (`doc.seat_stats`); EQR in particular is a ratio of values that are both
// present, so storing it would only create something that could drift.
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
  /**
   * Equity realisation: the fraction of its raw equity the range actually
   * converts into EV. 1 = realises exactly, above 1 = wins more than the cards
   * alone are worth (position and initiative), below 1 = the reverse.
   */
  eqr: number | null;
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
 * `potChips` is only used to decide whether EV is in chips. It is not used to
 * compute EQR: postflop is zero-sum, so the two seats' EVs sum to the pot *in
 * whatever unit the solve used*, and dividing by that sum makes EQR correct
 * without knowing the unit at all. That matters because ICM boards report EV
 * in tournament equity - one of ours sums to 3.93 against a 550-chip pot - and
 * an EQR taken against the chip pot would be off by two orders of magnitude.
 * Using the EV sum instead, the equity-weighted EQR comes out to exactly 1 on
 * every board, chipEV and ICM alike.
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
    const equity = finite(s?.equity) ? s!.equity! : null;
    return {
      role,
      seat: seats[role],
      combos: finite(s?.combos) ? s!.combos! : null,
      equity,
      ev,
      evBB: chipEv && ev != null ? ev / CHIPS_PER_BB : null,
      eqr:
        ev != null && equity != null && equity > 0 && finite(evSum) && evSum !== 0
          ? ev / (equity * evSum)
          : null,
    };
  };

  return { oop: seatStats("oop"), ip: seatStats("ip"), chipEv };
}
