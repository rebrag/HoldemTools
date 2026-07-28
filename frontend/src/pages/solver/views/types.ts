// views/types.ts
//
// Shared prop shapes for the four solver view components. Each view is pure
// layout: no mode logic, no data fetching - Solver owns all state and picks
// the view via useSolverLayout.
import type { JsonData } from "@/lib/solver/utils";
import type { ComboDetail } from "@/lib/solver/comboDetail";
import type { MatrixHeightMode } from "@/lib/solver/matrixHeight";
import type { NodeStats } from "@/lib/solver/nodeStats";

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
  /** How tall each matrix cell's strategy bar renders (GTO Wizard style). */
  heightMode: MatrixHeightMode;
  /** Plate file -> per-hand-class reach 0..1 at the displayed node. Absent
   *  preflop and on pre-schema-4 solves, where cells render full height. */
  reachByFile?: Record<string, Map<string, number> | null>;
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
  /** Per-combo detail for the displayed range, when it is the postflop acting
   *  seat at a schema-4 node. Drives the hand breakdown's real per-combo mixes;
   *  without it the breakdown falls back to the hand-class average. */
  comboDetail?: ComboDetail | null;
  /** Range-wide per-seat numbers for the current postflop node. */
  nodeStats?: NodeStats | null;
  /** Seat acting at that node, badged in the stats panel. */
  actorSeat?: string;
}

export interface MultiRangeViewProps extends SolverRangeBaseProps {
  windowWidth: number;
  windowHeight: number;
}
