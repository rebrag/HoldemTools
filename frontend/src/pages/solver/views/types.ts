// views/types.ts
//
// Shared prop shapes for the four solver view components. Each view is pure
// layout: no mode logic, no data fetching - Solver owns all state and picks
// the view via useSolverLayout.
import type { JsonData } from "@/lib/solver/utils";

export interface SolverRangeBaseProps {
  /** One plate file name per position (may contain "" for unloaded seats). */
  files: string[];
  positions: string[];
  plateData: Record<string, JsonData>;
  loading: boolean;
  alivePlayers: Record<string, boolean>;
  playerBets: Record<string, number>;
  activePlayer: string;
  pot?: number;
  ante?: number;
  isICMSim?: boolean;
  randomFillEnabled: boolean;
  onActionClick: (action: string, file: string) => void;
  /** Inner content div, so Solver can width-match the Line component to it. */
  onPlateContentRef?: (el: HTMLDivElement | null) => void;
}

export interface SingleRangeViewProps extends SolverRangeBaseProps {
  windowWidth: number;
  windowHeight: number;
  /** Board card codes when a postflop board is in play. */
  board?: string[];
}

export interface MultiRangeViewProps extends SolverRangeBaseProps {
  windowWidth: number;
  windowHeight: number;
}
