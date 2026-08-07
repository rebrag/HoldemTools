// Shared state for the single-range study layouts (desktop and mobile):
// which hand the breakdown shows (pin/hover), the auto-pin seeding from a
// recorded hand, the display-mode fallback, and the matrix display data.
// Extracted from SingleRangeStudy so the mobile dock behaves identically.
import { useEffect, useMemo, useState } from "react";
import type { HandCellData } from "@/lib/solver/utils";
import type { ComboDetail } from "@/lib/solver/comboDetail";
import {
  buildMatrixDisplayData,
  type MatrixDisplayData,
  type MatrixDisplayMode,
} from "@/lib/solver/matrixDisplayMode";

export interface StudyStateArgs {
  /** Seat whose range is on screen; the pinned hand is tracked per seat. */
  activePlayer?: string;
  /** Seat -> the hand that seat held in the recorded hand (hand-history
   *  solves). Seeds the pin when a board is opened. */
  autoPinBySeat?: Record<string, { hand: string; combo: string }>;
  /** Saved display mode; may fall back to Strategy when data is missing. */
  displayMode?: MatrixDisplayMode;
  comboDetail?: ComboDetail | null;
  activeGrid: HandCellData[];
  board?: string[];
}

export interface StudyState {
  pinnedHand: string | null;
  /** Hand the breakdown shows: the pin, else the last hovered class. */
  shownHand: string | null;
  /** Exact combo to point at while the pin is the recorded hand. */
  highlightCombo: string | null;
  onHandSelect: (hand: string) => void;
  onHandHover: (hand: string | null) => void;
  equityAvailable: boolean;
  effectiveMode: MatrixDisplayMode;
  displayData: MatrixDisplayData | null;
}

export default function useStudyState({
  activePlayer,
  autoPinBySeat,
  displayMode,
  comboDetail,
  activeGrid,
  board,
}: StudyStateArgs): StudyState {
  /* Which hand the breakdown shows. A click pins a class (and clicking it
   * again unpins); while nothing is pinned the pointer drives the panel, and
   * the last hovered class sticks so the panel doesn't blank every time the
   * pointer leaves the grid. The hover is tracked even while pinned, so
   * unpinning lands on whatever the pointer is over rather than on nothing.
   * A pin is kept across node changes, so stepping through a line follows the
   * same hand.
   *
   * Pins are per seat: a hand-history solve opens on what each player actually
   * held, and OOP's KK has nothing to do with IP's AA, so one shared pin would
   * jump to the wrong cell the moment the range toggle is used. */
  const [pinBySeat, setPinBySeat] = useState<Record<string, string | null>>({});
  const [hoveredHand, setHoveredHand] = useState<string | null>(null);

  /* Seed from the recorded hand whenever a different solve is opened. Keyed on
   * the auto-pin map's identity (a new manifest builds a new one), so it does
   * not fight the user's clicks within a board. */
  useEffect(() => {
    setPinBySeat(
      autoPinBySeat
        ? Object.fromEntries(
            Object.entries(autoPinBySeat).map(([seat, p]) => [seat, p.hand])
          )
        : {}
    );
  }, [autoPinBySeat]);

  const seatKey = activePlayer ?? "";
  const pinnedHand = pinBySeat[seatKey] ?? null;
  const shownHand = pinnedHand ?? hoveredHand;
  /* Only point at the exact combo while the pinned class is still the one the
   * player held - once the user picks another cell, there is no combo to
   * single out. */
  const auto = autoPinBySeat?.[seatKey];
  const highlightCombo = auto && auto.hand === shownHand ? auto.combo : null;

  /* Equity needs per-combo data (postflop, acting seat). The saved preference
   * is never overwritten: the effective mode just falls back to Strategy, so
   * navigating back to a postflop node restores Equity by itself. */
  const equityAvailable = !!comboDetail;
  const effectiveMode: MatrixDisplayMode =
    displayMode === "equity" && !equityAvailable
      ? "strategy"
      : displayMode ?? "strategy";

  const displayData = useMemo(
    () => buildMatrixDisplayData(effectiveMode, activeGrid, comboDetail, board),
    [effectiveMode, activeGrid, comboDetail, board]
  );

  return {
    pinnedHand,
    shownHand,
    highlightCombo,
    onHandSelect: (hand) =>
      setPinBySeat((prev) => ({
        ...prev,
        [seatKey]: prev[seatKey] === hand ? null : hand,
      })),
    onHandHover: setHoveredHand,
    equityAvailable,
    effectiveMode,
    displayData,
  };
}
