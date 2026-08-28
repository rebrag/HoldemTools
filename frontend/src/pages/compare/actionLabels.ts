// src/pages/compare/actionLabels.ts
//
// /compare's action-label formatter. Pure, and kept out of SolverCompare.tsx
// so the Playwright pure-logic specs can import it without React - the same
// reason treeConfigText.ts and compareLineNodes.ts sit beside it.
import { facingBet, priorStreetCommitChips } from "@/lib/solver/postflopNode";

/**
 * One raw action segment -> its readable label, given the node it is taken AT.
 *
 * THE page's single action-label authority, and it has to stay that way: the
 * output doubles as the key the two solvers' action columns are joined on (the
 * grids match by label and never by index) and as the key DecisionMatrix and
 * ActionSummary colour by. Both solvers emit identical node ids - a deliberate
 * convergence, see watcher/engine_compare.py's engine_colon_ids - so one
 * formatter over both keeps that join valid by construction. Do NOT reach for
 * postflopNode's formatPioAction alongside it.
 *
 * Amounts stay in the payload's own chips ("Bet 50", "Raise to 300"), matching
 * the pot and stacks shown beside them. formatPioAction divides by chip_scale,
 * which on this page would print "Bet 4" next to a pot of 100.
 *
 * Two things it does that the first version did not, both of which showed up
 * as wrong COLOURS rather than as wrong text:
 *
 *  - "ALLIN" when the bet commits the effective stack. isAllin (solver/utils)
 *    matches only that literal word and gives it a flat dark red rather than a
 *    ramp shade. Getting the jam out of the ramp matters beyond the jam
 *    itself: spreadRamp's gap is min(0.19, 1/(n-1)), so an extra member
 *    re-shades every other bet at the same node.
 *  - Netting out the completed streets. bNNN is HAND-cumulative, so on a turn
 *    or river tree the raw number keeps climbing across streets and reads as a
 *    far bigger bet than it is.
 *
 * `effStack` comes from the payload's spot block and is absent from payloads
 * written before engine_compare.py started carrying it; those simply never say
 * ALLIN, which is the old behaviour rather than a wrong one.
 */
export const displayLabelWith =
  (effStack: number | null | undefined) =>
  (segment: string, parentId: string): string => {
    if (segment === "f") return "Fold";
    /* Street-aware, unlike a look at the last segment alone: after a deal the
     * new street opens with nobody facing anything. */
    const facing = facingBet(parentId);
    if (segment === "c") return facing ? "Call" : "Check";
    const chips = Number(segment.slice(1));
    // 1 chip of tolerance - the smallest amount a solve can express.
    if (effStack != null && effStack > 0 && chips >= effStack - 1) return "ALLIN";
    const net = chips - priorStreetCommitChips(parentId);
    return facing ? `Raise to ${net}` : `Bet ${net}`;
  };
