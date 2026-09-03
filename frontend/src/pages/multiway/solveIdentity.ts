// src/pages/multiway/solveIdentity.ts
//
// How a solve is DESCRIBED to a person: which phase it is, where the team
// sits, how deep the stacks are. Every list of solves on /multiway (the
// Recent strip, the Solves drawer, the simulator's pickers and rotation)
// reads these so the same solve looks the same everywhere, and so the
// vocabulary - "P1 baseline", "P2 team SB+BB" - is defined once.
//
// Phase 1 is the no-team baseline the opponents are frozen at; phase 2 is
// the hand-sharing team's own solve on top of it. The engine's config puts
// the team in `agents.partition`, which the server reads into `spot.teamSeats`.
import { fmtCount } from "./pushfoldResult";
import { ago, jobTime, type CompareJob, type JobSpot } from "./compareJob";

export interface SolvePhase {
  phase: 1 | 2;
  /** "P1" / "P2" - the badge. */
  short: string;
  /** "baseline" / "team SB+BB" - what follows the badge. */
  what: string;
  /** The full sentence, for tooltips. */
  long: string;
  /** "SB+BB" for a team solve, null for a baseline. */
  teamLabel: string | null;
}

const seatName = (spot: JobSpot, seat: number): string => spot.seats[seat] ?? `P${seat}`;

export const teamLabel = (spot: JobSpot): string | null =>
  spot.teamSeats && spot.teamSeats.length === 2
    ? spot.teamSeats.map((s) => seatName(spot, s)).join("+")
    : null;

export const phaseOf = (spot: JobSpot | null | undefined): SolvePhase | null => {
  if (!spot) return null;
  const team = teamLabel(spot);
  if (team) {
    const aware = spot.awareness === "aware";
    return {
      phase: 2,
      short: "P2",
      what: `team ${team}${aware ? " (aware)" : ""}`,
      long: aware
        ? `Phase 2: ${team} share hole cards, and the opponents adapt to them (aware).`
        : `Phase 2: ${team} share hole cards against opponents frozen at the phase-1 baseline.`,
      teamLabel: team,
    };
  }
  return {
    phase: 1,
    short: "P1",
    what: "baseline",
    long: "Phase 1: the no-team baseline every seat plays alone. Team solves of this spot freeze their opponents at it.",
    teamLabel: null,
  };
};

const trimNum = (v: number, digits = 1): string => {
  const s = v.toFixed(digits);
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
};

/** Stacks in big blinds: "10bb each" when equal, "10/10/15/20bb" otherwise.
 *  Chips when the config carries no big blind to divide by. */
export const stacksText = (spot: JobSpot): string => {
  const bb = spot.bigBlind > 0 ? spot.bigBlind : null;
  const inBb = spot.stacks.map((s) => (bb ? s / bb : s));
  const unit = bb ? "bb" : " chips";
  const first = inBb[0];
  if (inBb.every((s) => s === first)) return `${trimNum(first)}${unit} each`;
  return `${inBb.map((s) => trimNum(s)).join("/")}${unit}`;
};

/** The shortest honest stack description, for chips and option text:
 *  "10bb" when equal, "10-20bb" as a range otherwise. */
export const stacksShort = (spot: JobSpot): string => {
  const bb = spot.bigBlind > 0 ? spot.bigBlind : null;
  const inBb = spot.stacks.map((s) => (bb ? s / bb : s));
  const unit = bb ? "bb" : "c";
  const lo = Math.min(...inBb);
  const hi = Math.max(...inBb);
  return lo === hi ? `${trimNum(lo)}${unit}` : `${trimNum(lo)}-${trimNum(hi)}${unit}`;
};

export const blindsText = (spot: JobSpot): string =>
  `${trimNum(spot.smallBlind)}/${trimNum(spot.bigBlind)}${
    spot.ante > 0 ? ` +${trimNum(spot.ante)} ante` : ""
  }`;

/** Identity of the SPOT: everything but the team. Solves sharing it are the
 *  same game with the team in different seats, which is what a rotation
 *  is - so this is what the Solves drawer groups by. Not the engine's
 *  solve key: that also folds in budget and batch, which are a solve's
 *  identity and not the spot's. */
export const spotKey = (spot: JobSpot | null | undefined): string =>
  spot
    ? `${spot.players}|${spot.stacks.join(",")}|${spot.smallBlind}/${spot.bigBlind}/${spot.ante}|btn${spot.button}`
    : "";

/** "4-way · 10bb each · blinds 1/2 · button BTN": the drawer's section title. */
export const spotTitle = (spot: JobSpot): string =>
  `${spot.players}-way · ${stacksText(spot)} · blinds ${blindsText(spot)} · button ${seatName(
    spot,
    spot.button
  )}`;

/** "4-way 10bb": the spot in the space of a chip. */
export const spotShort = (spot: JobSpot): string => `${spot.players}-way ${stacksShort(spot)}`;

/** Describe a row for a text-only slot such as a <select> option: phase,
 *  team, spot, how far it got, and when. A row with no spot summary falls
 *  back to what the strip has always shown. */
export const jobLabel = (job: CompareJob): string => {
  const phase = phaseOf(job.spot);
  const when = ago(jobTime(job));
  if (!phase || !job.spot) {
    return [job.solveId ?? job.id.slice(0, 8), job.board || "preflop", when]
      .filter(Boolean)
      .join(" · ");
  }
  const parts = [`${phase.short} ${phase.what}`, spotShort(job.spot)];
  if (job.iterations != null) parts.push(`${fmtCount(job.iterations)} iters`);
  if (when) parts.push(when);
  return parts.join(" · ");
};
