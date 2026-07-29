// views/useActiveRange.ts
import { useMemo } from "react";
import {
  combineDataByHand,
  type HandCellData,
  type JsonData,
} from "@/lib/solver/utils";
import type { PokerTableSeat } from "@/components/PokerTable";
import { fmtMoney, type MoneyOpts } from "../boardDisplay";

export interface ActiveRange {
  activeFile?: string;
  activeData?: JsonData;
  activeGrid: HandCellData[];
  tableSeats: PokerTableSeat[];
}

/**
 * Data for the single-range views: the active player's plate resolved to a
 * 13x13 grid, plus the seat descriptors for the shared PokerTable.
 */
export function useActiveRange(args: {
  positions: string[];
  files: string[];
  plateData: Record<string, JsonData>;
  alivePlayers: Record<string, boolean>;
  playerBets: Record<string, number>;
  /** Chips each seat has already put in the pot (see views/types.ts). */
  potCommitted?: Record<string, number>;
  activePlayer: string;
  /** Position -> real player name (hand-history solves). */
  seatNames?: Record<string, string>;
  /** Chips/bb display; absent for sims, which always read as big blinds. */
  money?: MoneyOpts | null;
}): ActiveRange {
  const {
    positions,
    files,
    plateData,
    alivePlayers,
    playerBets,
    potCommitted,
    activePlayer,
    seatNames,
    money,
  } = args;

  const activeIndex = positions.findIndex((p) => p === activePlayer);
  const activeFile = activeIndex >= 0 ? files[activeIndex] : undefined;
  const activeData = activeFile ? plateData[activeFile] : undefined;
  const activeGrid: HandCellData[] = useMemo(
    () => (activeData ? combineDataByHand(activeData) : []),
    [activeData]
  );

  const tableSeats: PokerTableSeat[] = positions.map((pos, i) => {
    const file = files[i];
    const data = file ? plateData[file] : undefined;
    const alive = alivePlayers[pos] ?? true;
    const bet = playerBets[pos] ?? 0;
    // data.bb is the seat's starting stack, so both the chips in front of them
    // and the ones already swept into the pot have to come off it.
    const committed = potCommitted?.[pos] ?? 0;
    const stackBB = data ? (data.bb ?? 0) - committed - bet : null;
    return {
      key: pos,
      label: seatNames?.[pos] ?? pos,
      stackText: stackBB != null ? fmtMoney(stackBB, money) : undefined,
      // Numeric bet drives the shared ChipStack + pill (matching the hand
      // recorder); committedText is the pill label.
      committedAmount: bet > 0 ? bet : undefined,
      committedText: bet > 0 ? fmtMoney(bet, money) : undefined,
      holeCards: alive ? [null, null] : undefined,
      isButton: pos === "BTN",
      isActive: pos === activePlayer,
      folded: !alive,
    };
  });

  return { activeFile, activeData, activeGrid, tableSeats };
}

export default useActiveRange;
