// views/types.ts
//
// Shared prop shapes for the four solver view components. Each view is pure
// layout: no mode logic, no data fetching - Solver owns all state and picks
// the view via useSolverLayout.
import type { JsonData } from "@/lib/solver/utils";
import type { ComboDetail } from "@/lib/solver/comboDetail";
import type { MatrixHeightMode } from "@/lib/solver/matrixHeight";
import type { MatrixDisplayMode } from "@/lib/solver/matrixDisplayMode";
import type { NodeStats } from "@/lib/solver/nodeStats";
import type { PokerTableSeat } from "@/components/PokerTable";
import type { MoneyDisplay } from "../boardDisplay";

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
  /** Position -> real player name (hand-history solves); seats fall back to
   *  their position label when absent. */
  seatNames?: Record<string, string>;
  /** Complete replacement for the derived table seats (hand-history solves
   *  render the hand's real table: every player, names, stacks, cards). */
  tableSeatsOverride?: PokerTableSeat[];
  /** Chips/bb display toggle (hand-history solves only). */
  money?: MoneyDisplay;
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
  /** Pio chips per unit of display money at the current postflop node
   *  (manifest chip_scale; 100 for sims). Converts per-combo EVs for display. */
  chipScale?: number;
  /** Seat acting at that node, badged in the stats panel. */
  actorSeat?: string;
  /** Matrix display mode (Strategy / EV / Equity) - desktop study view only. */
  displayMode?: MatrixDisplayMode;
  onDisplayModeChange?: (mode: MatrixDisplayMode) => void;
  /** Display label of the action actually taken in the hand behind this
   *  solve, badged PLAYED on the action summary. Only set while the displayed
   *  range is the acting seat's. */
  playedAction?: string | null;
}

/**
 * The mobile study view (tabbed dock) shows the same information as desktop,
 * so it needs the cell-height setter (its own controls row owns the pill) and
 * the auto-pin seed. The single-range toggle is not here: it rides in the sim
 * panel, which every layout shares - see SimSelect.
 */
export interface SingleRangeMobileViewProps extends SingleRangeViewProps {
  onHeightModeChange?: (mode: MatrixHeightMode) => void;
  /** Seat -> the hand that seat actually held, for hand-history solves. */
  autoPinBySeat?: Record<string, { hand: string; combo: string }>;
}

/**
 * The desktop study view owns the control row above the matrix (display mode,
 * cell height), so it needs the setters the multi-range layouts get from the
 * row Solver renders under the top strip.
 */
export interface SingleRangeDesktopViewProps extends SingleRangeViewProps {
  onHeightModeChange: (mode: MatrixHeightMode) => void;
  /** Seat -> the hand that seat actually held, for hand-history solves. The
   *  study view opens on it (per seat, so OOP and IP each get their own) and
   *  the breakdown highlights the exact combo. Empty for sim solves. */
  autoPinBySeat?: Record<string, { hand: string; combo: string }>;
}

export interface MultiRangeViewProps extends SolverRangeBaseProps {
  windowWidth: number;
  windowHeight: number;
}
