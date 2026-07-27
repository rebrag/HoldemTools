// useSolverLayout.ts
//
// The single source of truth for which of the solver page's four layouts is
// active. Every desktop/mobile decision for the solver flows through here.
//
// The two view families deliberately define "mobile" differently:
// - single-range: a plain width breakpoint (matches Tailwind lg).
// - multi-range: an aspect-ratio check plus a plate-count condition, so a
//   landscape phone or a small (<=4 player) sim keeps the desktop plate rows.
// This asymmetry is long-standing shipped behavior - do not "unify" it here
// without a deliberate product decision.
import useWindowDimensions from "@/hooks/useWindowDimensions";

export type SolverLayoutMode =
  | "single-desktop" // singleRangeView && width >= 1024
  | "single-mobile" // singleRangeView && width < 1024
  | "multi-desktop" // !singleRangeView && !(narrow portrait && plateCount > 4)
  | "multi-mobile"; // !singleRangeView && narrow portrait && plateCount > 4

export interface SolverLayout {
  mode: SolverLayoutMode;
  windowWidth: number;
  windowHeight: number;
}

// plateCount is an argument because the multi-range decision depends on data
// (how many plates the sim shows), not just the viewport.
//
// Historical note: the old PlateGrid computation special-cased 2-player sims
// (inverting the aspect check), but its isNarrow also required
// files.length > 4, so the inversion could never matter. The plain
// `w * 1.3 < h && plateCount > 4` below is behavior-identical.
export function useSolverLayout(
  singleRangeView: boolean,
  plateCount: number
): SolverLayout {
  const { windowWidth, windowHeight } = useWindowDimensions();

  let mode: SolverLayoutMode;
  if (singleRangeView) {
    mode = windowWidth >= 1024 ? "single-desktop" : "single-mobile";
  } else {
    const narrow = windowWidth * 1.3 < windowHeight && plateCount > 4;
    mode = narrow ? "multi-mobile" : "multi-desktop";
  }

  return { mode, windowWidth, windowHeight };
}

export default useSolverLayout;
