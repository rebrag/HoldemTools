// src/lib/solver/treeParamsView.ts
//
// Adapter between TreeParams (Pio integer chips, optional size fields, ICM)
// and the shared tree-building view model (display money as typed strings,
// required "" fields). Pure and React-free so the Playwright pure-logic specs
// can import it the same way money-units.spec.ts imports treeConfig.ts.
//
// The whole point of this file is that
//
//     buildTreeConfigText(mergeTreeParams(split(p)), flop) === buildTreeConfigText(p, flop)
//
// byte for byte, for every reachable p. The watcher pastes that text verbatim
// into PioSOLVER, so a drift here is a silent solve corruption rather than a
// visible bug. e2e/tree-params-view.spec.ts states exactly that as a test.
import {
  emptySeatView,
  parseBoardCards,
  type TreeBuildingView,
  type TreeSeatView,
  type TreeStreetView,
} from "@/components/treeBuildingView";
import type { StreetSizes, TreeParams, TreeSizes } from "./treeConfig";

/**
 * Everything in TreeParams the shared panel does not edit and which must
 * survive a round trip untouched.
 *
 * `chipScale` is FROZEN at extract time and is carried, never re-derived: the
 * seat stacks and the ICM stacks literal were scaled with it (see
 * pages/handhistory/create/solveBridge.ts) and are not editable here, so
 * recomputing it from an edited pot would desync them into a wrong solve.
 * That is also why it is deliberately absent from TreeBuildingView.
 */
export interface TreeParamsCarry {
  chipScale: number;
  mergeSimilarBets: boolean;
  mergeSimilarBetsThreshold: number;
  icm: TreeParams["icm"];
  /** Kept so an unparseable threshold box falls back to the original value,
   *  matching the pre-refactor `Number(x) || previous` behaviour. */
  allinThreshold: number;
  addAllinOnlyIfLessThanThisTimesThePot: number;
}

/* ---------- undefined -> "" ---------- */

const toStreetView = (s: StreetSizes): TreeStreetView => ({
  bet: s.betSize ?? "",
  raise: s.raiseSize ?? "",
  donk: s.donkBetSize ?? "",
  addAllin: s.addAllin,
  // Not representable in TreeParams or in Pio's config text. The solver call
  // site hides the control, so this can only ever be false on the way back.
  noThreeBet: false,
});

const toSeatView = (s: TreeSizes): TreeSeatView => ({
  flop: toStreetView(s.flop),
  turn: toStreetView(s.turn),
  river: toStreetView(s.river),
});

/* ---------- "" -> undefined ---------- */

/**
 * `x || undefined` and NOT `x ?? undefined`, and no `.trim()`.
 *
 * treeConfig.ts gates every emitted line on plain truthiness of the untrimmed
 * string (`if (sizes.betSize)`). `|| undefined` only rewrites values that are
 * already falsy, and falsy values already skip their line - so no `#...Size#`
 * line can appear or disappear and no emitted text can change. A pathological
 * " " survives as " " and still emits its line exactly as before.
 *
 * Adding a trim here would look like a cleanup and would silently change what
 * PioSOLVER receives. Don't.
 *
 * v.noThreeBet is dropped because TreeParams has nowhere to put it and Pio's
 * config text has no key for it. That is safe rather than lossy only because
 * the solver call site passes showNoThreeBet={false}, so the control that sets
 * it is never rendered on this screen; turning that flag on there means giving
 * the flag a home here first.
 */
const toStreetSizes = (v: TreeStreetView): StreetSizes => ({
  betSize: v.bet || undefined,
  raiseSize: v.raise || undefined,
  donkBetSize: v.donk || undefined,
  addAllin: v.addAllin,
});

const toTreeSizes = (v: TreeSeatView): TreeSizes => ({
  flop: toStreetSizes(v.flop),
  turn: toStreetSizes(v.turn),
  river: toStreetSizes(v.river),
});

/* ---------- the two directions ---------- */

/** Split TreeParams into the editable view and the untouched carry. */
export const splitTreeParams = (
  params: TreeParams,
  boardCards: string[]
): { view: TreeBuildingView; carry: TreeParamsCarry } => {
  // The same `|| 100` fallback the modal used before the refactor.
  const scale = params.chipScale || 100;

  const view: TreeBuildingView = {
    oopRange: params.rangeOOP,
    ipRange: params.rangeIP,
    board: boardCards.join(" "),
    pot: String(params.potChips / scale),
    effectiveStacks: String(params.effectiveStackChips / scale),
    allinThresholdPct: String(params.allinThreshold),
    addAllinCapPct: String(params.addAllinOnlyIfLessThanThisTimesThePot),
    oop: toSeatView(params.oop),
    ip: toSeatView(params.ip),
    // Controls hidden on this screen; kept at their inert values so the shape
    // stays uniform and nothing downstream has to special-case them.
    maxRaises: "",
    preflopAggressor: "none",
    betStructureOnly: false,
  };

  return {
    view,
    carry: {
      chipScale: scale,
      mergeSimilarBets: params.mergeSimilarBets,
      mergeSimilarBetsThreshold: params.mergeSimilarBetsThreshold,
      icm: params.icm,
      allinThreshold: params.allinThreshold,
      addAllinOnlyIfLessThanThisTimesThePot:
        params.addAllinOnlyIfLessThanThisTimesThePot,
    },
  };
};

/** Reassemble TreeParams from the edited view plus the carry. */
export const mergeTreeParams = (
  carry: TreeParamsCarry,
  view: TreeBuildingView
): { params: TreeParams; boardCards: string[] } => ({
  params: {
    rangeOOP: view.oopRange,
    rangeIP: view.ipRange,
    potChips: Math.round(Number(view.pot) * carry.chipScale),
    effectiveStackChips: Math.round(Number(view.effectiveStacks) * carry.chipScale),
    chipScale: carry.chipScale,
    allinThreshold: Number(view.allinThresholdPct) || carry.allinThreshold,
    addAllinOnlyIfLessThanThisTimesThePot:
      Number(view.addAllinCapPct) || carry.addAllinOnlyIfLessThanThisTimesThePot,
    mergeSimilarBets: carry.mergeSimilarBets,
    mergeSimilarBetsThreshold: carry.mergeSimilarBetsThreshold,
    oop: toTreeSizes(view.oop),
    ip: toTreeSizes(view.ip),
    icm: carry.icm,
  },
  boardCards: parseBoardCards(view.board),
});

/** A view with no sizes at all - only used as a defensive initial value. */
export const emptyTreeView = (): TreeBuildingView => ({
  oopRange: {},
  ipRange: {},
  board: "",
  pot: "",
  effectiveStacks: "",
  allinThresholdPct: "",
  addAllinCapPct: "",
  oop: emptySeatView(),
  ip: emptySeatView(),
  maxRaises: "",
  preflopAggressor: "none",
  betStructureOnly: false,
});
