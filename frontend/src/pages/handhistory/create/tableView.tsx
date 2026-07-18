// src/pages/handhistory/create/tableView.tsx
// Shared Engine→PokerTable mapping used by BOTH the hand recorder and the hand
// replayer, so the two surfaces render an identical table (seats, stacks, bets,
// pot, board reveals, folds, active seat). Extracted verbatim from the recorder
// to keep them in lock-step.
import React from "react";
import PlayingCard from "@/components/PlayingCard";
import { CardBack, type PokerTableSeat } from "@/components/PokerTable";
import { displayedPot, fmtUnit, revealedBoardCount, STREET_NAMES, type Engine } from "./engine";
import { straddlesOf, type AdvancedHandState } from "./types";

// Compact numeric label for preview badges: "0.5", "1", "2.5" (no trailing zeros).
const fmtNum = (n: number) => (Number.isFinite(n) ? String(n) : "");

// Build the seat descriptors for <PokerTable>. When `engine` is null the table
// is in the recorder's setup phase and shows a forced-bet preview (SB/BB/
// straddle) derived from the same position labels buildEngine uses; when an
// engine is present it reflects live stacks/bets/folds/turn for that snapshot.
export function buildTableSeats(args: {
  state: AdvancedHandState;
  engine: Engine | null;
  labels: string[];
  unitMode: "bb" | "chips";
  /** Replayer-only: seats whose hole cards should render face-down (card
   *  backs) on this frame. The recorder never passes this. */
  concealSeats?: boolean[];
  /** Replayer-only: per-seat equity string (e.g. "16%") shown inline in the name
   *  badge. Indexed by seat. The recorder never passes this. */
  seatEquities?: (string | undefined)[];
}): PokerTableSeat[] {
  const { state, engine, labels, unitMode, concealSeats, seatEquities } = args;

  // Forced-bet preview shown during setup (before the engine exists). Derived
  // from the same position labels as buildEngine's blind assignment, so the
  // SB/BB/straddle badges land on the right seats and follow the dealer button.
  const setupPosts: Record<number, { amount: number; label: string }> = {};
  if (!engine) {
    const sb = parseFloat(state.smallBlind);
    const bb = parseFloat(state.bigBlind);
    const occ = (pos: string) =>
      state.seats.findIndex((s, i) => s.occupied && labels[i] === pos);
    const bbIdx = occ("BB");
    if (bbIdx >= 0 && bb > 0) setupPosts[bbIdx] = { amount: bb, label: `BB ${fmtNum(bb)}` };
    const sbIdx = occ("SB") >= 0 ? occ("SB") : occ("BTN"); // heads-up: button posts SB
    if (sbIdx >= 0 && sb > 0 && !(sbIdx in setupPosts))
      setupPosts[sbIdx] = { amount: sb, label: `SB ${fmtNum(sb)}` };
    const STR_BADGES = ["Str", "2Str", "3Str"];
    straddlesOf(state).forEach((s, k) => {
      const amt = parseFloat(s.amount);
      const seat = state.seats[s.seat];
      if (seat?.occupied && !seat.sittingOut && amt > 0) {
        // A straddle badge wins over a blind badge on the same seat.
        setupPosts[s.seat] = { amount: amt, label: `${STR_BADGES[k] ?? "Str"} ${fmtNum(amt)}` };
      }
    });
  }

  return Array.from({ length: state.tableSize }, (_, i): PokerTableSeat => {
    const seat = state.seats[i];
    const empty = !seat.occupied;
    const sittingOut = !empty && !!seat.sittingOut;
    // Sitting-out seats have no position label; fall back to a status label so
    // an unnamed seat's badge isn't blank.
    const label = seat.name.trim() || labels[i] || (sittingOut ? "Sitting out" : "");
    const ep = engine?.players.find((p) => p.seat === i) ?? null;
    const isActive =
      !!engine && engine.toAct != null && engine.players[engine.toAct]?.seat === i;
    const stackText = ep
      ? `${fmtUnit(ep.stack, engine!.bb, unitMode)}${unitMode === "bb" ? " BB" : ""}`
      : seat.stack.trim();
    // At showdown every wager has been swept into the pot, so no seat keeps
    // chips in front (the fold-out path leaves `committed` set, so force it).
    const committed = engine?.done ? 0 : ep?.committed ?? 0;
    const post = setupPosts[i];
    // Bet shown on the table: live committed chips during the hand, or the
    // forced-bet preview (SB/BB/straddle) during setup. Both render as a
    // ChipStack pushed toward center, labelled per the current unit mode.
    const committedAmount = committed > 0 ? committed : post?.amount;
    const committedText =
      committed > 0
        ? `${fmtUnit(committed, engine!.bb, unitMode)}${unitMode === "bb" ? " BB" : ""}`
        : post?.label;
    return {
      key: i,
      label: empty ? "Empty" : label,
      stackText: empty ? undefined : stackText || undefined,
      committedAmount: empty || sittingOut ? undefined : committedAmount,
      committedText: empty || sittingOut ? undefined : committedText,
      // Sitting out = not dealt in (no card row); concealed = dealt but shown
      // face-down (null slots render as CardBacks).
      holeCards:
        empty || sittingOut
          ? undefined
          : concealSeats?.[i]
          ? seat.holeCards.map(() => null)
          : seat.holeCards,
      isButton: !empty && !sittingOut && state.buttonSeat === i,
      isHero: !empty && state.heroSeat === i,
      isActive,
      folded: ep?.folded ?? false,
      sittingOut,
      // Unseated during a live hand (empty or not dealt in) — but keep
      // sitting-out seats visible (inert, grayed) throughout the hand.
      hidden: !!engine && !ep && !sittingOut,
      isEmpty: empty,
      // Replayer equity shown inline in the name badge; undefined on the recorder.
      equityText: empty || sittingOut ? undefined : seatEquities?.[i],
    };
  });
}

/**
 * Pot presentation for <PokerTable>: the displayed amount (current-street bets
 * are excluded until the street ends — see displayedPot), a "<Street> · Pot <n>"
 * label, and, once the hand is won by a single seat, that seat index so the pot
 * chips slide toward it. Returns null during setup (no engine).
 */
export function potView(
  engine: Engine | null,
  unitMode: "bb" | "chips"
): { amount: number; label: string; winnerSeatIndex: number | null } | null {
  if (!engine) return null;
  const amount = displayedPot(engine);
  const label = `${STREET_NAMES[engine.street]} · Pot ${fmtUnit(amount, engine.bb, unitMode)}${
    unitMode === "bb" ? " BB" : ""
  }`;
  // Slide the pot to the winner only for an unambiguous single-seat, single-board
  // result; splits and run-it-twice stay centered.
  let winnerSeatIndex: number | null = null;
  if (engine.done && engine.numBoards === 1 && engine.winners && engine.winners.length === 1) {
    winnerSeatIndex = engine.players[engine.winners[0]].seat;
  }
  return { amount, label, winnerSeatIndex };
}

// A row of 5 board cards (face-up when revealed, else a card back). In the
// recorder it opens the board editor on tap (onEdit); in the read-only replayer
// onEdit is omitted and the row renders as a plain, non-interactive element.
export const BoardRow: React.FC<{
  board: (string | null)[];
  revealCount: number;
  live: boolean;
  onEdit?: () => void;
  ariaLabel: string;
}> = ({ board, revealCount, live, onEdit, ariaLabel }) => {
  const cards = [0, 1, 2, 3, 4].map((i) => {
    const revealed = !live || i < revealCount;
    const c = board[i];
    return revealed && c ? (
      <PlayingCard key={i} code={c} size="sm" width={36} />
    ) : (
      <CardBack key={i} w={36} />
    );
  });
  if (!onEdit) {
    return (
      <div className="flex gap-1" aria-label={ariaLabel}>
        {cards}
      </div>
    );
  }
  return (
    <button type="button" onClick={onEdit} className="flex gap-1" aria-label={ariaLabel}>
      {cards}
    </button>
  );
};

// The center slot of the table: pot/street badge (live) or an edit hint (setup),
// an ante preview during setup, and one or two board rows. Editable mode (the
// recorder) wires the board editors and the +2nd-board / remove-board controls;
// read-only mode (the replayer) shows the same layout without interactivity.
export const TableCenter: React.FC<{
  state: AdvancedHandState;
  engine: Engine | null;
  editable?: boolean;
  onEditBoard?: () => void;
  onEditBoard2?: () => void;
  onAddBoard?: () => void;
  onRemoveBoard?: () => void;
}> = ({
  state,
  engine,
  editable = false,
  onEditBoard,
  onEditBoard2,
  onAddBoard,
  onRemoveBoard,
}) => {
  const revealCount = engine ? revealedBoardCount(engine.street) : 0;
  return (
    <>
      {/* The pot (chips + label) is rendered by <PokerTable> as its own movable
          layer so it can slide toward the winner; see potView() below. Here we
          only show the setup hint before the hand begins. */}
      {!engine && (
        <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/80">
          Tap a card to edit
        </span>
      )}
      {!engine && parseFloat(state.ante) > 0 && (
        <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[9px] font-bold text-amber-950">
          Ante ${fmtNum(parseFloat(state.ante))}
        </span>
      )}
      <BoardRow
        board={state.board}
        revealCount={revealCount}
        live={!!engine}
        onEdit={editable ? onEditBoard : undefined}
        ariaLabel="Edit board"
      />
      {state.numBoards === 2 ? (
        <div className="flex items-center gap-1">
          <BoardRow
            board={state.board2}
            revealCount={revealCount}
            live={!!engine}
            onEdit={editable ? onEditBoard2 : undefined}
            ariaLabel="Edit board 2"
          />
          {editable && !engine && (
            <button
              type="button"
              onClick={onRemoveBoard}
              aria-label="Remove second board"
              className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-600/90 text-[10px] font-bold text-white hover:bg-rose-500"
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        editable &&
        !engine && (
          <button
            type="button"
            onClick={onAddBoard}
            className="rounded-full border border-white/25 bg-black/40 px-2 py-0.5 text-[9px] font-semibold text-white/80 hover:bg-black/60"
          >
            + 2nd board
          </button>
        )
      )}
      <span className="text-[9px] font-semibold uppercase tracking-widest text-white/25">
        HoldemTools
      </span>
    </>
  );
};
