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
  /** Chips still in front of each seat (the live bet), in bb. */
  playerBets: Record<string, number>;
  /** Chips each seat has already pushed into the middle (preflop money and
   *  matched postflop streets once in a postflop session), in bb. Empty
   *  preflop, where bets stay in front of the seats until the flop. */
  potCommitted?: Record<string, number>;
  activePlayer: string;
  /** Inclusive pot (all chips wagered, current bets included) - pot-odds math. */
  pot?: number;
  /** Chips actually pooled in the middle (excludes in-front bets) - display. */
  actualPot?: number;
  isICMSim?: boolean;
  randomFillEnabled: boolean;
  onActionClick: (action: string, file: string) => void;
  /** Inner content div, so Solver can width-match the Line component to it. */
  onPlateContentRef?: (el: HTMLDivElement | null) => void;
}

export interface SingleRangeViewProps extends SolverRangeBaseProps {
  windowWidth: number;
  windowHeight: number;
  /** Board card codes when a postflop board is in play: dealt onto the
   *  table's center slot, and used to name the street on the pot label. */
  board?: string[];
}

export interface MultiRangeViewProps extends SolverRangeBaseProps {
  windowWidth: number;
  windowHeight: number;
}
