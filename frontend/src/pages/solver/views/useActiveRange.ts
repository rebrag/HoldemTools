// views/useActiveRange.ts
import { useMemo } from "react";
import {
  combineDataByHand,
  type HandCellData,
  type JsonData,
} from "@/lib/solver/utils";
import type { PokerTableSeat } from "@/components/PokerTable";

/** "12.5" for fractional bb amounts, "12" for whole ones. */
export const fmtBB = (n: number, decimals = 1) =>
  Math.abs(n % 1) > 1e-9 ? n.toFixed(decimals) : n.toFixed(0);

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
  activePlayer: string;
}): ActiveRange {
  const { positions, files, plateData, alivePlayers, playerBets, activePlayer } =
    args;

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
    const stackBB = data ? (data.bb ?? 0) - bet : null;
    return {
      key: pos,
      label: pos,
      stackText: stackBB != null ? `${fmtBB(stackBB, 1)} bb` : undefined,
      // Numeric bet drives the shared ChipStack + pill (matching the hand
      // recorder); committedText is the pill label.
      committedAmount: bet > 0 ? bet : undefined,
      committedText: bet > 0 ? `${fmtBB(bet, 1)} bb` : undefined,
      holeCards: alive ? [null, null] : undefined,
      isButton: pos === "BTN",
      isActive: pos === activePlayer,
      folded: !alive,
    };
  });

  return { activeFile, activeData, activeGrid, tableSeats };
}

export default useActiveRange;
