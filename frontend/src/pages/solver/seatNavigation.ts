// src/pages/solver/seatNavigation.ts
//
// "Put this seat back on the spot" — the navigation behind clicking a seat.
//
// Two surfaces offer it and must agree, so the rule lives here rather than in
// either of them: the Line strip's seat cards, and the seats around the
// single-range view's poker table. A seat resolves one of two ways:
//
//   - It has not acted yet: skip ahead, folding (else checking, else calling)
//     every seat in front of it until it is the one to act. Only possible when
//     the seat currently on the spot has some way to pass the action on - a
//     node offering nothing but bets cannot be walked past.
//   - It has already acted, folded seats included: rewind the line to just
//     before its FIRST decision, so a seat that acted twice unwinds everything
//     it did. Earliest rather than latest also means the first seat's card
//     always reaches the root, which is what stands in for a reset control.
import { useMemo } from "react";
import type { PokerTableSeat } from "@/components/PokerTable";
import type { JsonData } from "@/lib/solver/utils";
import { passiveAction, plateActions } from "@/lib/solver/utils";

export interface SeatLineIndex {
  /** Seat -> the action it most recently took (highlights the taken option). */
  takenBySeat: Record<string, string>;
  /** Seat -> how many actions preceded its FIRST decision, i.e. the rewind
   *  target that puts that seat back on the spot. */
  actionsBeforeSeat: Record<string, number>;
}

/**
 * Replay `line` over the acting order — folds drop the seat, everything else
 * passes to the next one — to learn what each seat did and when.
 */
export function indexLineBySeat(line: string[], positions: string[]): SeatLineIndex {
  const takenBySeat: Record<string, string> = {};
  const actionsBeforeSeat: Record<string, number> = {};
  const alive = [...positions];
  let idx = 0;
  line.slice(1).forEach((action, i) => {
    const seat = alive[idx];
    if (!seat) return;
    takenBySeat[seat] = action;
    if (actionsBeforeSeat[seat] == null) actionsBeforeSeat[seat] = i;
    if (action === "Fold") {
      alive.splice(idx, 1);
      if (idx >= alive.length) idx = 0;
    } else if (alive.length > 0) {
      idx = (idx + 1) % alive.length;
    }
  });
  return { takenBySeat, actionsBeforeSeat };
}

/** Can the seat on the spot get out of the way (fold / check / call)? */
export function canPassAction(activeData?: JsonData): boolean {
  return !!passiveAction(plateActions(activeData));
}

export interface SeatNavTarget {
  /** Perform the navigation. */
  run: () => void;
  /** Tooltip / accessible hint describing where the click goes. */
  title: string;
}

export interface ResolveSeatNavArgs {
  /** Seat being resolved, and the full acting order it sits in. */
  pos: string;
  positions: string[];
  activePlayer: string;
  /** False once the seat has folded out of the hand. */
  alive: boolean;
  /** Whether the seat currently on the spot can pass the action on. */
  activeCanPass: boolean;
  actionsBeforeSeat: Record<string, number>;
  onSkipToSeat?: (pos: string) => void;
  onRewindTo?: (actionCount: number) => void;
}

/**
 * What a click on `pos` should do, or null when that seat is not reachable
 * from here (it is already on the spot, or it is ahead of a seat that has no
 * way to pass).
 */
export function resolveSeatNav({
  pos,
  positions,
  activePlayer,
  alive,
  activeCanPass,
  actionsBeforeSeat,
  onSkipToSeat,
  onRewindTo,
}: ResolveSeatNavArgs): SeatNavTarget | null {
  if (pos === activePlayer) return null;

  const activeIdx = positions.indexOf(activePlayer);
  const idx = positions.indexOf(pos);
  if (onSkipToSeat && alive && activeIdx >= 0 && idx > activeIdx && activeCanPass) {
    return { run: () => onSkipToSeat(pos), title: `Skip ahead to ${pos}` };
  }

  const before = actionsBeforeSeat[pos];
  if (onRewindTo && before != null) {
    return { run: () => onRewindTo(before), title: `Back to ${pos}'s decision` };
  }
  return null;
}

/**
 * Decorate <PokerTable> seats with the same navigation, for the single-range
 * views. Seat keys are positions on both seat sources the views use (the
 * derived sim seats and the hand-history seat_meta override), which is what
 * lets one position-keyed resolver serve both.
 *
 * Returns `onSeatClick: undefined` when nothing is navigable, so the table
 * renders exactly as it did before this existed.
 */
export function useSeatNavigation(
  seats: PokerTableSeat[],
  seatNav?: (pos: string) => SeatNavTarget | null
): { seats: PokerTableSeat[]; onSeatClick?: (index: number) => void } {
  return useMemo(() => {
    if (!seatNav) return { seats };
    const targets = seats.map((s) => seatNav(String(s.key)));
    if (targets.every((t) => !t)) return { seats };
    return {
      seats: seats.map((s, i) =>
        targets[i]
          ? { ...s, interactive: true, title: targets[i]!.title }
          : { ...s, interactive: false }
      ),
      onSeatClick: (index: number) => targets[index]?.run(),
    };
  }, [seats, seatNav]);
}
