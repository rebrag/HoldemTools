// src/pages/handhistory/create/CreateHandHistory.tsx
// Visual hand recorder. Setup phase: build the table (seats, cards, blinds).
// Action phase: a client-side betting engine steps through each player's
// action; on completion the hand is serialized to a plain-text string.
//
// Two modes:
//   - Page mode (default, standalone route): the finished hand is saved to the
//     server and the user is routed back to the hand-history list.
//   - Embedded mode (onComplete provided): the finished hand's text is handed
//     back to the caller instead of being saved directly. Used by the bankroll
//     session modal, which links the hand to its session on save.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "firebase/auth";
import PokerTable from "@/components/PokerTable";
import CopyButton from "@/components/CopyButton";
import { authedFetch } from "@/lib/api";
import { useLocalHandHistories } from "@/hooks/useLocalHandHistories";
import SeatEditorModal, { type SeatEditResult } from "./SeatEditorModal";
import BoardEditorModal from "./BoardEditorModal";
import ActionPanel from "./ActionPanel";
import { positionLabelsForSeats } from "./positions";
import {
  applyAction,
  buildEngine,
  setWinners,
  type ActionKind,
  type Engine,
} from "./engine";
import { buildTableSeats, potView, TableCenter } from "./tableView";
import { actionsFromEngine, buildReplayData, encodeReplay, rebuildFrames } from "./replay";
import { serializeHand, type EquityInfo, type StreetEquity } from "./serialize";
import { useShowdownEquity, type EquityRequest } from "./useShowdownEquity";
import { evalWinners, exactEquity, type EvalGame } from "@/lib/handEval";
import { parseGameString } from "./parseGameString";
import { parseHandDefaults, type HandDefaults } from "./parseHandDefaults";
import type { HandHistory } from "../types";
import {
  blankSeat,
  createInitialState,
  defaultStraddleAmount,
  handSize,
  isActiveSeat,
  MAX_STRADDLES,
  nextActiveSeat,
  resizeHoleCards,
  resizeSeats,
  straddlesOf,
  usedCards,
  type AdvancedHandState,
} from "./types";

// Setup-phase tap-to-place mode: after arming it, the next seat tap either moves
// the dealer button there or relocates a player from `from`.
type Placement = { kind: "button" } | { kind: "move"; from: number } | null;

// Merge parsed setup defaults (from the most recent saved hand, or app defaults
// on Clear/Reset) into a state: blinds/ante/game/table size and each seat's
// name + stack. Hand-specific fields (button, hero, hole cards, action) are left
// untouched. Hole cards are only resized to match the (possibly new) game.
function applyDefaults(base: AdvancedHandState, d: HandDefaults): AdvancedHandState {
  const next: AdvancedHandState = { ...base };
  if (d.game) next.game = d.game;
  if (d.smallBlind != null) next.smallBlind = d.smallBlind;
  if (d.bigBlind != null) next.bigBlind = d.bigBlind;
  if (d.ante != null) next.ante = d.ante;
  const size =
    d.tableSize && d.tableSize >= 2 && d.tableSize <= 9 ? d.tableSize : next.tableSize;
  next.tableSize = size;
  const cards = handSize(next.game);
  let seats = resizeSeats(next.seats, size).map((s) => ({
    ...s,
    holeCards: resizeHoleCards(s.holeCards, cards),
  }));
  if (d.seats) {
    seats = seats.map((s, i) => {
      const ds = d.seats![i];
      // Carry the sitting-out state so a sat-out player stays sat out next hand
      // (and active seats stay active). Hole cards are left reset above.
      return ds
        ? { ...s, name: ds.name, stack: ds.stack, occupied: true, sittingOut: ds.sittingOut }
        : s;
    });
  }
  next.seats = seats;
  next.buttonSeat = Math.min(next.buttonSeat, size - 1);
  next.heroSeat = Math.min(next.heroSeat, size - 1);
  return next;
}

// Map the recorder's game label to the evaluator's game id (null = can't eval).
function evalGameId(game: string): EvalGame | null {
  if (game === "Holdem") return "texas-holdem";
  if (game === "PLO") return "omaha4";
  if (game === "PLO5") return "omaha5";
  return null;
}


interface Props {
  user: User | null;
  // Embedded mode: when provided, the finished hand's serialized text is handed
  // back to the caller instead of being saved to the server. Enables reuse
  // inside the bankroll session modal as an overlay.
  onComplete?: (rawText: string) => void;
  // Called when the user leaves the recorder in embedded mode.
  onClose?: () => void;
  // Free-form game string (e.g. a bankroll session's "2/5 NL") used to seed the
  // setup's blinds/ante/game. Unrecognized tokens are ignored.
  defaultGameString?: string;
  // Session location shown as the site name in the serialized header. Falls
  // back to a generic site name when absent (standalone builder).
  location?: string | null;
}

const TABLE_SIZES = [9, 8, 7, 6, 5, 4, 3, 2];

const inputCls =
  "w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition";

const CreateHandHistory: React.FC<Props> = ({
  user,
  onComplete,
  onClose,
  defaultGameString,
  location,
}) => {
  const navigate = useNavigate();
  const embedded = !!onComplete;
  // Signed-out saves go to the device-local store (migrated on sign-in). We also
  // read localHands to seed defaults from the most recent hand when signed out.
  const { addLocal, localHands } = useLocalHandHistories();
  const setupDefaults = useMemo(
    () => (defaultGameString ? parseGameString(defaultGameString) : undefined),
    [defaultGameString]
  );
  const [state, setState] = useState<AdvancedHandState>(() =>
    createInitialState(9, setupDefaults)
  );
  const [editingSeat, setEditingSeat] = useState<number | null>(null);
  const [editingBoard, setEditingBoard] = useState(false);
  const [editingBoard2, setEditingBoard2] = useState(false);
  const [phase, setPhase] = useState<"setup" | "action">("setup");
  const [placement, setPlacement] = useState<Placement>(null);

  const [engine, setEngine] = useState<Engine | null>(null);
  const [history, setHistory] = useState<Engine[]>([]);
  const [winnerSel, setWinnerSel] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [unitMode, setUnitMode] = useState<"bb" | "chips">("chips");
  const autoSavedRef = useRef(false);
  // Defaults seeding (standalone mode): copy the most recent saved hand's setup
  // once, unless the user has already touched the form or hit Clear all.
  const seededRef = useRef(false);
  const touchedRef = useRef(false);
  const clearedRef = useRef(false);
  const rememberedRef = useRef<HandDefaults | null>(null);

  const labels = useMemo(
    () =>
      positionLabelsForSeats(
        state.seats.map((s) => s.occupied && !s.sittingOut),
        state.buttonSeat
      ),
    [state.seats, state.buttonSeat]
  );

  // Seats dealt into the hand (occupied and not sitting out) — gates Start.
  const activeCount = state.seats.filter((s) => isActiveSeat(s)).length;

  const evalGame = useMemo(() => evalGameId(state.game), [state.game]);
  const cardsPerHand = handSize(state.game);

  // Showdown analysis: which live players/boards can be auto-evaluated.
  const showdown = useMemo(() => {
    if (!engine || !engine.done) return null;
    const live = engine.players
      .map((p, i) => ({ p, i }))
      .filter((x) => !x.p.folded);
    if (live.length < 2) return null; // won by fold — engine already set the winner
    const handsAssigned = live.map((x) => x.p.hole.filter((c): c is string => !!c));
    const board1Full = state.board.filter((c): c is string => !!c);
    const board2Full = state.board2.filter((c): c is string => !!c);
    const canEval =
      evalGame != null &&
      handsAssigned.every((h) => h.length === cardsPerHand) &&
      board1Full.length === 5 &&
      (state.numBoards === 1 || board2Full.length === 5);
    return { live, handsAssigned, board1Full, board2Full, canEval };
  }, [engine, state, evalGame, cardsPerHand]);

  // Flop and turn equity are exact and cheap to enumerate, so compute them
  // synchronously. (Preflop is far larger, so it runs in the worker below.)
  const postflopEquity = useMemo(() => {
    if (!showdown || !showdown.canEval || !evalGame) return null;
    const hands = showdown.handsAssigned;
    const at = (cards: number) => {
      const e1 = exactEquity(evalGame, showdown.board1Full.slice(0, cards), hands);
      if (state.numBoards === 2) {
        const e2 = exactEquity(evalGame, showdown.board2Full.slice(0, cards), hands);
        return e1.map((v, k) => (v + e2[k]) / 2);
      }
      return e1;
    };
    return { flop: at(3), turn: at(4) };
  }, [showdown, evalGame, state.numBoards]);

  // Preflop equity via the Monte-Carlo worker (empty board).
  const equityReq: EquityRequest | null = useMemo(() => {
    if (!showdown || !showdown.canEval || !evalGame) return null;
    const hands = showdown.handsAssigned.map((h) => h.join(" "));
    return {
      game: evalGame,
      hands,
      board1: "",
      board2: state.numBoards === 2 ? "" : null,
      key: JSON.stringify({ evalGame, hands, nb: state.numBoards }),
    };
  }, [showdown, evalGame, state.numBoards]);

  const { pct: preEq, computing: equityComputing } = useShowdownEquity(equityReq);

  // Assemble per-street equity keyed by engine player index for serialization.
  const equityInfo: EquityInfo | undefined = useMemo(() => {
    if (!showdown || !postflopEquity) return undefined;
    const byPlayer: Record<number, StreetEquity> = {};
    showdown.live.forEach((x, k) => {
      byPlayer[x.i] = {
        pre: preEq ? preEq[k] : undefined,
        flop: postflopEquity.flop[k],
        turn: postflopEquity.turn[k],
      };
    });
    return { byPlayer };
  }, [showdown, postflopEquity, preEq]);

  const serialized = useMemo(
    () =>
      engine && engine.done && engine.winners
        ? serializeHand(state, engine, equityInfo, { location })
        : "",
    [engine, state, equityInfo, location]
  );

  const update = (partial: Partial<AdvancedHandState>) => {
    touchedRef.current = true;
    setState((prev) => ({ ...prev, ...partial }));
  };

  const onTableSizeChange = (size: number) => {
    touchedRef.current = true;
    setState((prev) => ({
      ...prev,
      tableSize: size,
      seats: resizeSeats(prev.seats, size),
      buttonSeat: Math.min(prev.buttonSeat, size - 1),
      heroSeat: Math.min(prev.heroSeat, size - 1),
    }));
  };

  // Changing the game resizes every seat's hole cards to the new hand size
  // (2 = Hold'em, 4 = PLO, 5 = PLO5).
  const onGameChange = (game: string) => {
    touchedRef.current = true;
    const cards = handSize(game);
    setState((prev) => ({
      ...prev,
      game,
      seats: prev.seats.map((s) => ({ ...s, holeCards: resizeHoleCards(s.holeCards, cards) })),
    }));
  };

  const saveSeat = (index: number, result: SeatEditResult) => {
    touchedRef.current = true;
    const { seat, makeButton, makeHero, makeStraddle, straddleAmount } = result;
    const seats = state.seats.map((s, i) => (i === index ? seat : s));
    // A seat that just sat out can't hold the button, hero, or straddle —
    // walk the marker to the next active seat (mirrors emptySeatAt).
    const satOut = !!seat.sittingOut;
    const reassign = (idx: number) =>
      satOut && idx === index && seats.some((s) => isActiveSeat(s))
        ? nextActiveSeat(seats, index)
        : idx;
    // Straddles keep their posting order: an existing straddle updates its
    // amount in place; a new one joins the end of the chain (as the double or
    // triple straddle); unchecking removes it and lets the later ones move up.
    const priorStraddles = straddlesOf(state);
    const straddles = makeStraddle
      ? priorStraddles.some((s) => s.seat === index)
        ? priorStraddles.map((s) =>
            s.seat === index ? { ...s, amount: straddleAmount } : s
          )
        : [...priorStraddles, { seat: index, amount: straddleAmount }]
      : priorStraddles.filter((s) => s.seat !== index);
    const nextState: AdvancedHandState = {
      ...state,
      seats,
      buttonSeat: makeButton ? index : reassign(state.buttonSeat),
      heroSeat: makeHero ? index : reassign(state.heroSeat),
      straddles,
    };
    setState(nextState);
    // Mid-hand edits (stack, revealed hole cards, name, straddle) are applied by
    // rebuilding the engine from the edited setup and replaying the recorded
    // actions, so retroactive changes propagate through the whole hand. The undo
    // stack is rebuilt from the same frames, and any resolved winners are
    // re-applied to the final frame.
    if (engine) {
      const frames = rebuildFrames(nextState, actionsFromEngine(engine));
      let last = frames[frames.length - 1];
      if (engine.winners) last = setWinners(last, engine.winners, 1);
      if (engine.winners2) last = setWinners(last, engine.winners2, 2);
      frames[frames.length - 1] = last;
      setEngine(last);
      setHistory(frames.slice(0, -1));
    }
    setEditingSeat(null);
  };

  // Relocate a player to another seat, swapping the two seats' full state (the
  // destination's player, if any, moves back). The button/hero/straddle markers
  // travel with their seats so positions stay consistent.
  const moveSeat = (from: number, to: number) => {
    touchedRef.current = true;
    const swap = (idx: number) => (idx === from ? to : idx === to ? from : idx);
    setState((prev) => ({
      ...prev,
      seats: prev.seats.map((s, i) =>
        i === from ? prev.seats[to] : i === to ? prev.seats[from] : s
      ),
      buttonSeat: swap(prev.buttonSeat),
      heroSeat: swap(prev.heroSeat),
      straddles: straddlesOf(prev).map((s) => ({ ...s, seat: swap(s.seat) })),
    }));
  };

  // Remove the player at a seat, leaving it empty, and move any button/hero it
  // held to the next occupied seat (dropping a straddle it posted).
  const emptySeatAt = (index: number) => {
    touchedRef.current = true;
    setState((prev) => {
      const seats = prev.seats.map((s, i) =>
        i === index ? blankSeat(handSize(prev.game)) : s
      );
      const reassign = (idx: number) =>
        idx === index && seats.some((s) => isActiveSeat(s))
          ? nextActiveSeat(seats, index)
          : idx;
      return {
        ...prev,
        seats,
        buttonSeat: reassign(prev.buttonSeat),
        heroSeat: reassign(prev.heroSeat),
        straddles: straddlesOf(prev).filter((s) => s.seat !== index),
      };
    });
    setEditingSeat(null);
  };

  // Tap-to-place: a seat tap while `placement` is armed either moves the dealer
  // button to that seat (occupied seats only) or relocates a player there.
  const handlePlacementTarget = (i: number) => {
    if (!placement) return;
    if (placement.kind === "button") {
      if (isActiveSeat(state.seats[i]) && i !== state.buttonSeat) update({ buttonSeat: i });
      setPlacement(null);
      return;
    }
    const from = placement.from;
    setPlacement(null);
    if (i !== from) moveSeat(from, i);
  };

  const reset = () => {
    // Restart the hand, but keep the remembered setup (blinds/game/seats) from
    // the most recent saved hand where we have it, so the table isn't wiped.
    const base = createInitialState(state.tableSize, setupDefaults);
    const remembered = rememberedRef.current;
    setState(!embedded && remembered ? applyDefaults(base, remembered) : base);
    setEngine(null);
    setHistory([]);
    setWinnerSel([]);
    setSaveError(null);
    autoSavedRef.current = false;
    setPhase("setup");
    setPlacement(null);
  };

  // "Clear all": wipe the fields the setup remembers - blinds, ante, table size,
  // game, and every seat's name + stack - back to app defaults, and forget the
  // remembered last hand so it doesn't repopulate. Hole cards / board / comment
  // are left in place.
  const clearAll = () => {
    touchedRef.current = true;
    clearedRef.current = true;
    rememberedRef.current = null;
    setState((prev) =>
      applyDefaults(prev, {
        smallBlind: "0.5",
        bigBlind: "1",
        ante: "0",
        game: "Holdem",
        tableSize: 9,
        seats: Array.from({ length: 9 }, () => ({ name: "", stack: "" })),
      })
    );
  };

  // Standalone mode: seed the setup from the most recent saved hand (blinds,
  // ante, game, table size, seat names + stacks) so the user doesn't re-enter a
  // similar table each time. Candidates come from the device-local store (works
  // signed out) and, when signed in, the server; the newest across both wins.
  // Runs once; skipped if the user has already touched the form or hit Clear all.
  // Embedded mode keeps using defaultGameString.
  useEffect(() => {
    if (embedded || seededRef.current) return;
    let cancelled = false;
    void (async () => {
      const candidates: { rawText: string; createdAt: string }[] = [...localHands];
      if (user) {
        try {
          const res = await authedFetch("/api/handhistory");
          if (res.ok) {
            const data = (await res.json()) as HandHistory[];
            if (Array.isArray(data)) candidates.push(...data);
          }
        } catch {
          // Best-effort: server defaults are a convenience, so failures are silent.
        }
      }
      const newest = candidates
        .filter((h) => h?.rawText && h?.createdAt)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (cancelled || !newest) return;
      const parsed = parseHandDefaults(newest.rawText);
      rememberedRef.current = parsed;
      if (cancelled || seededRef.current || touchedRef.current || clearedRef.current) return;
      seededRef.current = true;
      setState((prev) => applyDefaults(prev, parsed));
    })();
    return () => {
      cancelled = true;
    };
  }, [embedded, user, localHands]);

  const start = () => {
    if (activeCount < 2) return;
    setPlacement(null);
    setEngine(buildEngine(state));
    setHistory([]);
    setWinnerSel([]);
    setPhase("action");
  };

  const act = (kind: ActionKind, amountTo?: number) => {
    if (!engine) return;
    setHistory((h) => [...h, engine]);
    setEngine(applyAction(engine, kind, amountTo));
  };

  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setEngine(prev);
      return h.slice(0, -1);
    });
  };

  const confirmWinners = () => {
    if (!engine || winnerSel.length === 0) return;
    const board = engine.winners === null ? 1 : 2;
    setEngine(setWinners(engine, winnerSel, board));
    setWinnerSel([]);
  };

  const saveHand = async () => {
    if (!serialized || !engine) return;
    // The persisted text carries an invisible, machine-readable replay payload
    // appended after the human-readable history. It rides through both the
    // server API and localStorage unchanged, and is stripped from every
    // user-facing display. Only the on-screen `serialized` stays clean.
    const toSave = serialized + encodeReplay(buildReplayData(state, engine));
    // Embedded: hand the text back to the caller (e.g. the bankroll session
    // modal), which is responsible for persisting/linking it.
    if (onComplete) {
      onComplete(toSave);
      onClose?.();
      return;
    }
    // Signed out: save to the device-local store instead of the server. It's
    // synchronous, so we skip the saving/error state and route to the list.
    if (!user) {
      addLocal(toSave);
      navigate("/hand-history");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await authedFetch("/api/handhistory", {
        method: "POST",
        body: JSON.stringify({ rawText: toSave, sessionId: null }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      navigate("/hand-history");
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  // Decide the winner(s) from the actual cards instead of asking the user.
  // Falls back to the manual picker when cards/boards are incomplete (canEval).
  useEffect(() => {
    if (!engine || !engine.done || !showdown || !showdown.canEval || !evalGame) return;
    const needB1 = engine.winners === null;
    const needB2 = engine.numBoards === 2 && engine.winners2 === null;
    if (!needB1 && !needB2) return;
    const handsForEval = engine.players.map((p) =>
      p.folded ? null : p.hole.filter((c): c is string => !!c)
    );
    let ne = engine;
    if (needB1) ne = setWinners(ne, evalWinners(evalGame, showdown.board1Full, handsForEval), 1);
    if (needB2) ne = setWinners(ne, evalWinners(evalGame, showdown.board2Full, handsForEval), 2);
    setEngine(ne);
  }, [engine, showdown, evalGame]);

  // Once the hand is fully resolved (winners on every board) and any all-in
  // equity has been computed, save it automatically. The ref guards re-firing.
  // Skipped in embedded mode, where the user confirms with an explicit button.
  useEffect(() => {
    if (embedded) return;
    const isComplete =
      !!engine &&
      engine.done &&
      !!engine.winners &&
      (engine.numBoards === 1 || !!engine.winners2);
    const equityReady = !equityReq || preEq != null;
    if (isComplete && equityReady && serialized && !autoSavedRef.current && !saving) {
      autoSavedRef.current = true;
      void saveHand();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, serialized, equityReq, preEq]);

  const needWinner =
    !!engine &&
    engine.done &&
    (engine.winners === null || (engine.numBoards === 2 && engine.winners2 === null));
  const winnerBoard: 1 | 2 = engine && engine.winners === null ? 1 : 2;
  const complete =
    !!engine &&
    engine.done &&
    !!engine.winners &&
    (engine.numBoards === 1 || !!engine.winners2);

  const tableSeats = buildTableSeats({ state, engine, labels, unitMode });
  // While placing, highlight the seats a tap can target: occupied seats for a
  // button move, every other seat for a player move.
  const displayedSeats = placement
    ? tableSeats.map((s, i) => {
        const targetable =
          placement.kind === "button" ? isActiveSeat(state.seats[i]) : i !== placement.from;
        return targetable ? { ...s, highlighted: true } : s;
      })
    : tableSeats;
  const pot = potView(engine, unitMode);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {embedded && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-white">Create Hand History</h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-black/30 text-white/80 transition hover:bg-black/50 hover:text-white"
          >
            <span className="text-sm">✕</span>
          </button>
        </div>
      )}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
      {/* ───────── Table (left column) ───────── */}
      <div className="w-full lg:flex-1 lg:min-w-0 relative pt-2">
      {/* Placement banner overlays the table top so it takes no flow height —
          arming never shifts the layout. The idle "move button" affordance
          lives on the D badge itself. */}
      {placement && (
        <div className="pointer-events-none absolute left-1/2 top-1 z-40 -translate-x-1/2">
          <div className="pointer-events-auto inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow">
            <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            {placement.kind === "button"
              ? "Tap a seat to move the button"
              : "Tap a seat to move this player"}
            <button
              type="button"
              onClick={() => setPlacement(null)}
              className="ml-1 underline underline-offset-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <PokerTable
        size={state.tableSize}
        seats={displayedSeats}
        onSeatClick={(i) => (placement ? handlePlacementTarget(i) : setEditingSeat(i))}
        onDealerBadgeClick={
          phase === "setup"
            ? () =>
                setPlacement((p) => (p?.kind === "button" ? null : { kind: "button" }))
            : undefined
        }
        dealerBadgeArmed={placement?.kind === "button"}
        maxWidthClassName="max-w-2xl"
        potAmount={pot?.amount}
        potLabel={pot?.label}
        potWinnerSeatIndex={pot?.winnerSeatIndex}
        center={
          <TableCenter
            state={state}
            engine={engine}
            editable
            onEditBoard={() => setEditingBoard(true)}
            onEditBoard2={() => setEditingBoard2(true)}
            onAddBoard={() => update({ numBoards: 2 })}
            onRemoveBoard={() => update({ numBoards: 1 })}
          />
        }
      />
      </div>

      {/* ───────── Controls (right column) ───────── */}
      <div className="w-full lg:w-[400px] lg:flex-shrink-0">
      {/* ───────── Action phase ───────── */}
      {phase === "action" && engine && (
        <>
          {!engine.done && (
            <>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setUnitMode((u) => (u === "bb" ? "chips" : "bb"))}
                  className="rounded-full border border-emerald-300/40 bg-slate-900/70 px-3 py-1 text-[11px] font-medium text-emerald-100 transition hover:bg-slate-800 active:scale-95"
                >
                  Show in {unitMode === "bb" ? "chip amounts" : "BB"}
                </button>
              </div>
              <ActionPanel
                engine={engine}
                unitMode={unitMode}
                onAction={act}
                onUndo={undo}
                canUndo={history.length > 0}
              />
            </>
          )}

          {engine.done && !!showdown?.canEval && (needWinner || equityComputing) && (
            <div className="mt-3 rounded-2xl border border-emerald-300/40 bg-slate-900/70 p-3 text-sm text-emerald-100">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                {needWinner ? "Evaluating showdown…" : "Calculating equities…"}
              </span>
            </div>
          )}

          {needWinner && !showdown?.canEval && (
            <div className="mt-3 rounded-2xl border border-amber-300/40 bg-amber-950/40 p-3 text-sm text-amber-100">
              <p className="mb-2 font-semibold">
                Showdown — who won?
                {engine.numBoards === 2 && <span className="ml-1 text-amber-200/80">(Board {winnerBoard})</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {engine.players.map((p, i) =>
                  p.folded ? null : (
                    <button
                      key={i}
                      type="button"
                      onClick={() =>
                        setWinnerSel((sel) =>
                          sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]
                        )
                      }
                      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                        winnerSel.includes(i)
                          ? "bg-emerald-500 text-white ring-emerald-300"
                          : "bg-slate-800 text-slate-200 ring-slate-600 hover:bg-slate-700"
                      }`}
                    >
                      {p.name}
                    </button>
                  )
                )}
              </div>
              <button
                type="button"
                disabled={winnerSel.length === 0}
                onClick={confirmWinners}
                className="mt-3 inline-flex rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                Confirm winner{winnerSel.length > 1 ? "s (split)" : ""}
              </button>
            </div>
          )}

          {complete && (
            <div className="mt-3 rounded-2xl border border-emerald-300/40 bg-white/95 p-3 shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Hand history</h3>
                <CopyButton
                  text={serialized}
                  className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                />
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-gray-800">
                {serialized}
              </pre>
              {saveError && (
                <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
                  {saveError}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
                >
                  Record another
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveHand}
                  className="inline-flex items-center rounded-full bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/40 transition hover:bg-emerald-500 disabled:opacity-60"
                >
                  {embedded ? "Add to session" : saving ? "Saving…" : "Save hand history"}
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setEngine(null);
              setPhase("setup");
            }}
            className="mt-3 text-xs text-emerald-200/80 underline underline-offset-2 hover:text-white"
          >
            ← Back to setup
          </button>
        </>
      )}

      {/* ───────── Setup phase: config form ───────── */}
      {phase === "setup" && (
        <div className="rounded-2xl border border-emerald-300/40 bg-white/95 p-4 shadow-lg shadow-emerald-500/20 backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-end">
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] text-gray-400 underline underline-offset-2 transition hover:text-gray-600"
            >
              Clear all
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Table size">
              <select
                className={inputCls}
                value={state.tableSize}
                onChange={(e) => onTableSizeChange(Number(e.target.value))}
              >
                {TABLE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n} Players
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Game">
              <select className={inputCls} value={state.game} onChange={(e) => onGameChange(e.target.value)}>
                <option>Holdem</option>
                <option>PLO</option>
                <option>PLO5</option>
                <option>Other</option>
              </select>
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field label="Small blind">
              <input type="tel" inputMode="decimal" className={inputCls} value={state.smallBlind} onChange={(e) => update({ smallBlind: e.target.value })} />
            </Field>
            <Field label="Big blind">
              <input type="tel" inputMode="decimal" className={inputCls} value={state.bigBlind} onChange={(e) => update({ bigBlind: e.target.value })} />
            </Field>
            <Field label="Ante (total)">
              <input type="tel" inputMode="decimal" className={inputCls} value={state.ante} onChange={(e) => update({ ante: e.target.value })} />
            </Field>
          </div>

          <div className="mt-3 flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Comment</label>
            <textarea
              rows={1}
              className={`${inputCls} resize-y`}
              value={state.comment}
              onChange={(e) => update({ comment: e.target.value })}
              placeholder="Optional note about this hand…"
            />
          </div>

          <p className="mt-3 text-[11px] text-gray-500">
            Tap each seat to set its name, stack, and hole cards. Mark the dealer
            button, your own seat (hero), or straddles (up to a triple straddle —
            each defaults to double the last). Use the “+ 2nd board” chip
            on the table to play a double board. Then press Start to record the action.
          </p>

          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 transition"
            >
              ⟲ Reset
            </button>
            <button
              type="button"
              disabled={activeCount < 2}
              onClick={start}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-6 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/40 transition hover:-translate-y-[1px] hover:bg-emerald-500 active:translate-y-[1px] disabled:opacity-50"
            >
              ▷ Start
            </button>
          </div>
        </div>
      )}
      </div>
      </div>

      {editingSeat !== null && (() => {
        // This seat's slot in the straddle chain: its existing position, or the
        // next open one (straddle → double → triple). The amount handed to the
        // modal is the posted amount, or the doubled default for a fresh one.
        const straddles = straddlesOf(state);
        const existingIdx = straddles.findIndex((s) => s.seat === editingSeat);
        const straddleOrder = existingIdx >= 0 ? existingIdx : straddles.length;
        const straddleAmount =
          existingIdx >= 0
            ? straddles[existingIdx].amount
            : defaultStraddleAmount(straddles, straddleOrder, state.bigBlind);
        return (
        <SeatEditorModal
          positionLabel={labels[editingSeat] || `Seat ${editingSeat + 1}`}
          seat={state.seats[editingSeat]}
          isButton={state.buttonSeat === editingSeat}
          isHero={state.heroSeat === editingSeat}
          isStraddle={existingIdx >= 0}
          straddleOrder={straddleOrder}
          straddleAmount={straddleAmount}
          canStraddle={existingIdx >= 0 || straddles.length < MAX_STRADDLES}
          capacity={cardsPerHand}
          otherUsed={usedCards(state, state.seats[editingSeat].holeCards)}
          onSave={(result) => saveSeat(editingSeat, result)}
          onClose={() => setEditingSeat(null)}
          allowStructural={phase === "setup"}
          onEmpty={() => emptySeatAt(editingSeat)}
          onMove={() => {
            const from = editingSeat;
            setEditingSeat(null);
            setPlacement({ kind: "move", from });
          }}
        />
        );
      })()}

      {editingBoard && (
        <BoardEditorModal
          board={state.board}
          otherUsed={usedCards(state, state.board)}
          onSave={(board) => {
            update({ board });
            setEditingBoard(false);
          }}
          onClose={() => setEditingBoard(false)}
        />
      )}

      {editingBoard2 && (
        <BoardEditorModal
          board={state.board2}
          otherUsed={usedCards(state, state.board2)}
          onSave={(board2) => {
            update({ board2 });
            setEditingBoard2(false);
          }}
          onClose={() => setEditingBoard2(false)}
        />
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-gray-700">{label}</label>
    {children}
  </div>
);

export default CreateHandHistory;
