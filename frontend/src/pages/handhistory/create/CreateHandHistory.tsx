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
import PlayerAvatar from "@/components/PlayerAvatar";
import { usePlayers } from "@/hooks/usePlayers";
import { authedFetch } from "@/lib/api";
import { useLocalHandHistories } from "@/hooks/useLocalHandHistories";
import { useSavedTableLayout } from "@/hooks/useSavedTableLayout";
import useNoOverscroll from "@/hooks/useNoOverscroll";
import SeatEditorModal, { type SeatEditResult } from "./SeatEditorModal";
import BoardEditorModal from "./BoardEditorModal";
import QuickSetupDrawer, { type QuickSetupRow } from "./QuickSetupDrawer";
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
import { evalWinners, exactEquity } from "@/lib/handEval";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import TreeBuildingModal, { type TreeBuildingInit } from "@/pages/solver/TreeBuildingModal";
import { POSTFLOP_ENABLED } from "@/lib/solver/constants";
import { buildTreeConfigText } from "@/lib/solver/treeConfig";
import { uploadGameTree } from "@/lib/solver/uploadGameTree";
import { fetchSolveJob } from "@/lib/solver/solveJobs";
import { extractHandSolve, type HandSolveExtract } from "./solveBridge";
import { parseGameString } from "./parseGameString";
import { parseHandDefaults, type HandDefaults } from "./parseHandDefaults";
import type { HandHistory } from "../types";
import {
  blankSeat,
  createInitialState,
  DEFAULT_TABLE_SIZE,
  defaultStraddleAmount,
  evalGameId,
  explicitStraddlesOf,
  handSize,
  isActiveSeat,
  MAX_STRADDLES,
  nextActiveSeat,
  resizeHoleCards,
  resizeSeats,
  straddlesOf,
  usedCards,
  utgStraddleAmountOf,
  utgStraddleSeat,
  type AdvancedHandState,
  type StraddlePost,
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
  if (d.utgStraddle != null) next.utgStraddle = d.utgStraddle;
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
      // Carry each seat's occupied + sitting-out state so the whole table layout
      // survives to the next hand: an empty seat stays empty in the same spot and
      // a sat-out player stays sat out. Hole cards are left reset above.
      return ds
        ? {
            ...s,
            name: ds.name,
            // The player link travels with the name it snapshots, so a regular
            // opponent stays identified hand after hand.
            playerId: ds.playerId,
            stack: ds.stack,
            occupied: ds.occupied ?? true,
            sittingOut: ds.sittingOut,
          }
        : s;
    });
  }
  next.seats = seats;
  next.buttonSeat = Math.min(next.buttonSeat, size - 1);
  next.heroSeat = Math.min(next.heroSeat, size - 1);
  // Empties are now carried forward, so the button/hero can land on a seat that
  // isn't in the hand — snap them to the nearest seat that is.
  if (!isActiveSeat(next.seats[next.buttonSeat]))
    next.buttonSeat = nextActiveSeat(next.seats, next.buttonSeat);
  if (!isActiveSeat(next.seats[next.heroSeat]))
    next.heroSeat = nextActiveSeat(next.seats, next.heroSeat);
  return next;
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
}

const TABLE_SIZES = [9, 8, 7, 6, 5, 4, 3, 2];

// In-progress setup is persisted here so it survives navigating away or a reload
// (standalone mode only). Cleared once the hand is saved.
const DRAFT_KEY = "ht_handhistory_draft_v1";

// Read a persisted setup, or null when absent/invalid. Light validation only —
// we trust any object carrying the seats array the recorder needs.
function loadSetupDraft(): AdvancedHandState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdvancedHandState;
    if (parsed && Array.isArray(parsed.seats) && parsed.seats.length >= 2) return parsed;
  } catch {
    // ignore malformed drafts
  }
  return null;
}

function clearSetupDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

const inputCls =
  "w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition";

const CreateHandHistory: React.FC<Props> = ({
  user,
  onComplete,
  onClose,
  defaultGameString,
}) => {
  const navigate = useNavigate();
  const embedded = !!onComplete;
  // Both phases size the table to the viewport, so the rubber-band only ever
  // reveals backdrop and makes the felt feel unanchored.
  useNoOverscroll();
  // Signed-out saves go to the device-local store (migrated on sign-in). We also
  // read localHands to seed defaults from the most recent hand when signed out.
  const { addLocal, localHands } = useLocalHandHistories();
  const setupDefaults = useMemo(
    () => (defaultGameString ? parseGameString(defaultGameString) : undefined),
    [defaultGameString]
  );
  // One-time read of any persisted in-progress setup (standalone only). When a
  // draft is restored we treat the form as already "touched" so the
  // seed-from-last-hand pass below still records the remembered hand (for "New
  // hand") but doesn't overwrite the restored draft.
  const draftRef = useRef<AdvancedHandState | null | undefined>(undefined);
  if (draftRef.current === undefined) {
    draftRef.current = embedded ? null : loadSetupDraft();
  }
  const [state, setState] = useState<AdvancedHandState>(
    () => draftRef.current ?? createInitialState(DEFAULT_TABLE_SIZE, setupDefaults)
  );
  const [editingSeat, setEditingSeat] = useState<number | null>(null);
  // Last seat the editor showed, so the permanently-mounted drawer keeps valid
  // props while its exit animation plays after editingSeat returns to null.
  const lastEditedSeatRef = useRef(0);
  if (editingSeat !== null) lastEditedSeatRef.current = editingSeat;
  const [editingBoard, setEditingBoard] = useState(false);
  const [editingBoard2, setEditingBoard2] = useState(false);
  // When the board sheet was auto-opened by a street arriving, this is the card
  // count that completes the request (flop 3, turn 4, river 5) — the sheet
  // commits itself when the user reaches it. Null for manual opens, which keep
  // the explicit Done button as the only way to finish.
  const [boardAutoClose, setBoardAutoClose] = useState<number | null>(null);
  const [phase, setPhase] = useState<"setup" | "action">("setup");
  const [placement, setPlacement] = useState<Placement>(null);
  const [quickSetupOpen, setQuickSetupOpen] = useState(false);
  // Bumped on every seat rotation; the button's glyph is transformed to
  // `rotateSpin * 360deg`, so each press winds it one more full turn and the
  // CSS transition plays that out as a spin.
  const [rotateSpin, setRotateSpin] = useState(0);

  const [engine, setEngine] = useState<Engine | null>(null);
  const [history, setHistory] = useState<Engine[]>([]);
  const [winnerSel, setWinnerSel] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [unitMode, setUnitMode] = useState<"bb" | "chips">("chips");
  const autoSavedRef = useRef(false);

  // Postflop solve offer: when the completed hand saw a heads-up flop, the
  // tree-building modal opens over the recorder while the auto-save runs in
  // the background; navigation to the list is deferred until it closes.
  const [solveOffer, setSolveOffer] = useState<Extract<
    HandSolveExtract,
    { eligible: true }
  > | null>(null);
  // Yes/no prompt shown before the tree-building modal: accepting moves the
  // extract into solveOffer, declining finishes the flow (navigates once the
  // background save lands).
  const [solvePrompt, setSolvePrompt] = useState<Extract<
    HandSolveExtract,
    { eligible: true }
  > | null>(null);
  const [solveBusy, setSolveBusy] = useState(false);
  const [solveNotice, setSolveNotice] = useState<string | null>(null);
  const [solveError, setSolveError] = useState<string | null>(null);
  const solveOfferedRef = useRef(false);
  // Save/navigation handshake: "ok"/"error" once the deferred save resolves;
  // pendingNavRef is set when the modal closed before the save finished.
  const savedRef = useRef<"idle" | "ok" | "error">("idle");
  const pendingNavRef = useRef(false);
  // Resolves to the saved hand's id, so a solve queued from this hand can be
  // linked back to it in the solved-flops library. The save runs concurrently
  // with the solve prompt, so this is a promise rather than a value. It is
  // armed (made pending) the moment the completed hand is offered a solve —
  // NOT when the save starts: the auto-save waits for showdown equity, so on
  // a showdown hand the user can accept the solve and walk the whole
  // tree-building panel before the save even begins. A promise created at
  // save start was still the initial resolved null in that window, and the
  // solve uploaded unlinked. saveHand resolves the pending promise, arming
  // its own when the hand skipped the solve offer.
  const savedHandIdRef = useRef<Promise<number | null>>(Promise.resolve(null));
  const savedHandIdResolveRef = useRef<((id: number | null) => void) | null>(null);
  const armSavedHandId = () => {
    if (savedHandIdResolveRef.current) return; // already pending
    savedHandIdRef.current = new Promise<number | null>((resolve) => {
      savedHandIdResolveRef.current = resolve;
    });
  };
  const resolveSavedHandId = (id: number | null) => {
    savedHandIdResolveRef.current?.(id);
    savedHandIdResolveRef.current = null;
  };
  // Defaults seeding (standalone mode): copy the most recent saved hand's setup
  // once, unless the user has already touched the form or hit Clear all.
  const seededRef = useRef(false);
  const touchedRef = useRef(draftRef.current != null);
  const clearedRef = useRef(false);
  const rememberedRef = useRef<HandDefaults | null>(null);
  // Quick-save table layout (single localStorage slot, standalone + embedded).
  const { layout: savedLayout, saveLayout } = useSavedTableLayout();
  const [layoutSavedFlash, setLayoutSavedFlash] = useState(false);
  const layoutFlashTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (layoutFlashTimerRef.current != null)
        window.clearTimeout(layoutFlashTimerRef.current);
    },
    []
  );

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
        ? serializeHand(state, engine, equityInfo)
        : "",
    [engine, state, equityInfo]
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
    // The setup form's UTG straddle is derived (it follows the seat after the
    // BB), so edits to that seat route to the utgStraddle field instead of
    // pinning a straddle to the seat — pinning it would stop it moving with
    // the button.
    const utgSeat = utgStraddleAmountOf(state) != null ? utgStraddleSeat(state) : null;
    const priorStraddles = explicitStraddlesOf(state).filter((s) => s.seat !== utgSeat);
    let utgStraddle = state.utgStraddle;
    let straddles: StraddlePost[];
    if (utgSeat === index) {
      utgStraddle = makeStraddle ? straddleAmount : "";
      straddles = priorStraddles;
    } else {
      straddles = makeStraddle
        ? priorStraddles.some((s) => s.seat === index)
          ? priorStraddles.map((s) =>
              s.seat === index ? { ...s, amount: straddleAmount } : s
            )
          : [...priorStraddles, { seat: index, amount: straddleAmount }]
        : priorStraddles.filter((s) => s.seat !== index);
    }
    const nextState: AdvancedHandState = {
      ...state,
      seats,
      buttonSeat: makeButton ? index : reassign(state.buttonSeat),
      heroSeat: makeHero ? index : reassign(state.heroSeat),
      straddles,
      utgStraddle,
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

  // Apply the Quick setup drawer's rows: every seat's occupancy, name, and
  // stack in one state update. Newly-emptied seats lose their hole cards, and
  // the button/hero/straddle markers walk off seats that left the hand
  // (mirroring saveSeat / emptySeatAt's invariants).
  const applyQuickSetup = (rows: QuickSetupRow[]) => {
    touchedRef.current = true;
    setState((prev) => {
      const seats = prev.seats.map((s, i) => {
        const row = rows[i];
        if (!row) return s;
        return {
          ...s,
          occupied: row.occupied,
          name: row.name,
          // Quick setup edits plain text: renaming a seat there breaks the
          // player link (the text no longer denotes that identity), while an
          // untouched name keeps it.
          playerId:
            row.occupied && row.name.trim() === s.name.trim() ? s.playerId : undefined,
          stack: row.stack,
          holeCards: row.occupied ? s.holeCards : s.holeCards.map(() => null),
        };
      });
      const snap = (idx: number) =>
        isActiveSeat(seats[idx]) || !seats.some((s) => isActiveSeat(s))
          ? idx
          : nextActiveSeat(seats, idx);
      return {
        ...prev,
        seats,
        buttonSeat: snap(prev.buttonSeat),
        heroSeat: snap(prev.heroSeat),
        straddles: explicitStraddlesOf(prev).filter((st) => isActiveSeat(seats[st.seat])),
      };
    });
    setQuickSetupOpen(false);
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
      straddles: explicitStraddlesOf(prev).map((s) => ({ ...s, seat: swap(s.seat) })),
    }));
  };

  // Spin the whole table one seat clockwise: every player (with their stack,
  // cards and sit-out flag) moves from seat i to seat i+1, and the button,
  // hero and straddle markers ride along. Because everything shifts together
  // the cyclic order is untouched, so positions, blinds and action order are
  // identical afterwards — only where each player is *drawn* changes.
  //
  // That is the point: seat 0 is bottom-centre, so this is how you line the
  // on-screen table up with the real one (usually putting hero where you
  // actually sat) without re-typing a single name or stack.
  const rotateSeats = () => {
    touchedRef.current = true;
    setRotateSpin((n) => n + 1);
    setState((prev) => {
      const n = prev.seats.length;
      if (n < 2) return prev;
      const shift = (idx: number) => (idx + 1) % n;
      return {
        ...prev,
        seats: prev.seats.map((_, i) => prev.seats[(i - 1 + n) % n]),
        buttonSeat: shift(prev.buttonSeat),
        heroSeat: shift(prev.heroSeat),
        straddles: explicitStraddlesOf(prev).map((s) => ({ ...s, seat: shift(s.seat) })),
      };
    });
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
        straddles: explicitStraddlesOf(prev).filter((s) => s.seat !== index),
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
        utgStraddle: "",
        game: "Holdem",
        tableSize: DEFAULT_TABLE_SIZE,
        seats: Array.from({ length: DEFAULT_TABLE_SIZE }, () => ({ name: "", stack: "" })),
      })
    );
  };

  // Quick-save the current table setup (blinds, game, table size, seats, hero)
  // into the single layout slot. Button seat is deliberately not saved — it
  // rotates every hand.
  const handleSaveLayout = () => {
    if (phase !== "setup") return;
    saveLayout(state);
    setLayoutSavedFlash(true);
    if (layoutFlashTimerRef.current != null)
      window.clearTimeout(layoutFlashTimerRef.current);
    layoutFlashTimerRef.current = window.setTimeout(
      () => setLayoutSavedFlash(false),
      1500
    );
  };

  const handleLoadLayout = () => {
    if (!savedLayout || phase !== "setup") return;
    // Suppress the async seed-from-last-hand pass (whichever order it resolves
    // in) and make Reset keep the loaded layout instead of the remembered hand.
    touchedRef.current = true;
    clearedRef.current = true;
    rememberedRef.current = savedLayout.defaults;
    setState((prev) => {
      let next = applyDefaults(prev, savedLayout.defaults);
      const h = savedLayout.heroSeat;
      if (h != null && h >= 0 && h < next.seats.length) {
        next = {
          ...next,
          heroSeat: isActiveSeat(next.seats[h]) ? h : nextActiveSeat(next.seats, h),
        };
      }
      return next;
    });
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

  // Persist the in-progress setup so it survives navigation/reload (standalone
  // only, setup phase only). Skip the pristine default so an untouched form
  // doesn't pre-empt the seed-from-last-hand pass above. saveHand clears it once
  // the hand is saved.
  const pristineSetup = useMemo(
    () => createInitialState(DEFAULT_TABLE_SIZE, setupDefaults),
    [setupDefaults]
  );
  useEffect(() => {
    if (embedded || phase !== "setup") return;
    try {
      if (JSON.stringify(state) === JSON.stringify(pristineSetup)) {
        window.localStorage.removeItem(DRAFT_KEY);
      } else {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
      }
    } catch {
      // ignore quota / serialization errors
    }
  }, [embedded, phase, state, pristineSetup]);

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

  // Each street deals new board cards - closing preflop deals the flop, the
  // flop's betting deals the turn, the turn's deals the river - so ask for
  // those cards right then, while the spot is still in front of the user,
  // instead of leaving the board half-empty until showdown (where a missing
  // card silently downgrades the winner to a manual pick).
  //
  // The sheet fills the earliest empty slot first, so a hand whose flop was
  // never entered is caught up by the turn prompt rather than needing its own.
  // Once the requested street is complete the sheet commits itself (see
  // boardAutoClose above), so the flow is tap-tap-tap and back to the action.
  const promptedStreetRef = useRef(0);
  useEffect(() => {
    // Only while the hand is still being played. An all-in run-out finishes in
    // one step, and that path already has the showdown UI (and possibly the
    // solve offer) competing for the screen.
    if (!engine || engine.done) return;
    const street = engine.street;
    // Undo rewound past a street we already asked about: re-arm, so replaying
    // it prompts again if the card is still missing.
    if (street < promptedStreetRef.current) promptedStreetRef.current = street;
    if (street <= promptedStreetRef.current) return;
    promptedStreetRef.current = street;
    // Streets 1/2/3 (flop/turn/river) need the first 3/4/5 board slots filled.
    const cardsNeeded = street === 1 ? 3 : street === 2 ? 4 : street === 3 ? 5 : 0;
    if (!cardsNeeded) return;
    if (state.board.slice(0, cardsNeeded).every((c) => !!c)) return;
    setBoardAutoClose(cardsNeeded);
    setEditingBoard(true);
  }, [engine, state.board]);

  const confirmWinners = () => {
    if (!engine || winnerSel.length === 0) return;
    const board = engine.winners === null ? 1 : 2;
    setEngine(setWinners(engine, winnerSel, board));
    setWinnerSel([]);
  };

  const saveHand = async (opts?: { deferNavigate?: boolean }) => {
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
      clearSetupDraft();
      navigate("/hand-history");
      return;
    }
    setSaving(true);
    setSaveError(null);
    armSavedHandId();
    try {
      const res = await authedFetch("/api/handhistory", {
        method: "POST",
        body: JSON.stringify({ rawText: toSave, sessionId: null }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      // The API echoes the created row; its id is what links a solve queued
      // from this hand back to it. A missing/unparseable body is not fatal -
      // the solve simply goes unlinked.
      try {
        const saved: { id?: number } = await res.json();
        resolveSavedHandId(typeof saved?.id === "number" ? saved.id : null);
      } catch {
        resolveSavedHandId(null);
      }
      clearSetupDraft();
      // While the solve modal is up, the save completes silently in the
      // background; navigation happens when the modal is dismissed (or right
      // now, if it was dismissed while the save was still in flight).
      if (opts?.deferNavigate) {
        savedRef.current = "ok";
        if (pendingNavRef.current) navigate("/hand-history");
      } else {
        navigate("/hand-history");
      }
    } catch (e: unknown) {
      savedRef.current = "error";
      setSaveError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
      // No-op once already resolved; guarantees an unsaved hand never leaves
      // a solve upload waiting on a promise that will not settle.
      resolveSavedHandId(null);
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

  // When the completed hand saw a heads-up flop (with real postflop play),
  // offer to upload a game tree for solving. Computed synchronously so the
  // auto-save effect below can defer navigation in the same commit.
  const solveExtract = useMemo(() => {
    if (embedded || !user || !POSTFLOP_ENABLED) return null;
    if (!engine || !engine.done) return null;
    const ex = extractHandSolve({
      engine,
      history,
      board: state.board,
      buttonSeat: state.buttonSeat,
    });
    return ex.eligible ? ex : null;
  }, [embedded, user, engine, history, state.board, state.buttonSeat]);

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
      void saveHand({ deferNavigate: !!solveExtract });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, serialized, equityReq, preEq]);

  // Offer the solve alongside the auto-save (once per hand): a small yes/no
  // prompt first, so the full tree-building panel isn't thrown at the user
  // uninvited.
  useEffect(() => {
    if (!solveExtract || solveOfferedRef.current) return;
    const isComplete =
      !!engine &&
      engine.done &&
      !!engine.winners &&
      (engine.numBoards === 1 || !!engine.winners2);
    if (!isComplete) return;
    solveOfferedRef.current = true;
    // Arm the hand-id link before the prompt shows: the auto-save may still
    // be waiting on equity, and it resolves this same promise when it lands.
    armSavedHandId();
    setSolvePrompt(solveExtract);
  }, [solveExtract, engine]);

  /** Close the solve modal and perform (or queue) the deferred navigation. */
  const finishSolveFlow = () => {
    setSolveOffer(null);
    setSolveNotice(null);
    setSolveError(null);
    setSolveBusy(false);
    if (savedRef.current === "ok") {
      navigate("/hand-history");
    } else if (savedRef.current === "idle") {
      // Save still in flight - it navigates on completion.
      pendingNavRef.current = true;
    }
    // savedRef "error": stay put so the existing save-error UI (with its
    // manual Save button) is visible.
  };

  const acceptSolve = () => {
    const p = solvePrompt;
    setSolvePrompt(null);
    if (p) setSolveOffer(p);
  };

  // Dismissing the prompt (No / Escape / backdrop) declines the solve.
  const declineSolve = () => {
    setSolvePrompt(null);
    finishSolveFlow();
  };

  const confirmSolveUpload = async ({
    params,
    flopCards,
  }: {
    params: Parameters<typeof buildTreeConfigText>[0];
    flopCards: string[];
  }) => {
    if (!solveOffer) return;
    setSolveBusy(true);
    setSolveError(null);
    try {
      const text = buildTreeConfigText(params, flopCards);
      // The concurrent save may still be running — or not even started, when
      // the showdown-equity worker is what the auto-save is waiting on — so
      // wait for it, letting the library link the solved board back to this
      // hand. Null (save failed, signed-out flow, or a save that never lands
      // within the timeout) just means unlinked.
      const handHistoryId = await Promise.race([
        savedHandIdRef.current.catch(() => null),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 20_000)),
      ]);
      const result = await uploadGameTree({
        handHistoryId,
        folder: solveOffer.folder,
        line: solveOffer.preflopLine,
        actingPos: solveOffer.actingPos,
        isICM: false,
        text,
        alivePositions: solveOffer.alivePositions,
        seats: solveOffer.seats,
        bigBlind: solveOffer.bigBlind,
        // Frozen at extract time: the seat stacks and the ICM stacks literal
        // were scaled with it and are not editable in the panel, so
        // re-deriving it from an edited pot would desync them.
        chipScale: solveOffer.chipScale,
      });
      setSolveNotice(
        "Solve queued - it will appear in the Solution Library on the Solutions page (usually 2-10 min)."
      );
      // One status fetch for an honest queue position; the job itself is
      // durable, so navigating away loses nothing.
      if (result.jobId) {
        void fetchSolveJob(result.jobId)
          .then((job) => {
            if (job?.status === "Queued" && job.queuePosition && job.queuePosition > 1) {
              setSolveNotice(
                `Solve queued (#${job.queuePosition} in line) - it will appear in the Solution Library on the Solutions page.`
              );
            }
          })
          .catch(() => undefined);
      }
      window.setTimeout(finishSolveFlow, 2400);
    } catch (e: unknown) {
      setSolveError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setSolveBusy(false);
    }
  };

  const solveInit = useMemo<TreeBuildingInit | null>(() => {
    if (!solveOffer) return null;
    const label = (p: typeof solveOffer.oop, role: string) =>
      p.name && p.name !== p.hhPos && p.name !== p.solverPos
        ? `${p.name} · ${p.solverPos} (${role})`
        : `${p.solverPos} (${role})`;
    return {
      params: solveOffer.params,
      flopCards: solveOffer.flopCards,
      oopLabel: label(solveOffer.oop, "OOP"),
      ipLabel: label(solveOffer.ip, "IP"),
      // The recorded hand's money, not big blinds.
      moneyLabel: "chips",
    };
  }, [solveOffer]);

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

  // GGPoker-style seat avatars for linked players. `byId` is referentially
  // stable across unrelated renders (see usePlayers), so this only rebuilds
  // when seats or the roster actually change.
  const { byId: playersById } = usePlayers();
  const playerAvatars = useMemo(
    () =>
      state.seats.map((s) =>
        s.playerId ? (
          <PlayerAvatar
            player={playersById.get(s.playerId)}
            name={s.name}
            size="md"
            className="ring-white/40 shadow-md"
          />
        ) : undefined
      ),
    [state.seats, playersById]
  );

  const tableSeats = buildTableSeats({ state, engine, labels, unitMode, playerAvatars });
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
    // Full-height flex column (standalone only) so the controls column can be
    // pushed flush to the bottom with `mt-auto`, the same way the replayer docks
    // its transport bar into the mobile thumb-zone. Embedded in the bankroll
    // modal the page has no viewport of its own, so it stays a plain block.
    <div
      className={`mx-auto flex max-w-6xl flex-col overflow-x-clip px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] ${
        embedded ? "" : "min-h-[calc(100dvh-3rem)]"
      }`}
    >
      {/* One-list entry of every seat's name and stack. Mounted permanently so
          the drawer's exit animation plays (see ResponsiveDrawer). */}
      <QuickSetupDrawer
        open={quickSetupOpen}
        onClose={() => setQuickSetupOpen(false)}
        seats={state.seats}
        buttonSeat={state.buttonSeat}
        onApply={applyQuickSetup}
      />
      {/* Postflop solve offer, step 1: a small yes/no prompt the moment a hand
          that saw a heads-up flop completes, while the auto-save runs behind
          it. Stays mounted so the drawer's exit animation plays. */}
      <ResponsiveDrawer
        open={!!solvePrompt}
        onClose={declineSolve}
        desktopMaxWidthClassName="sm:max-w-sm"
        ariaLabelledBy="solve-offer-title"
      >
        <div className="text-center">
          <h2 id="solve-offer-title" className="text-xl font-bold tracking-tight text-white">
            Solve this spot?
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            This hand was heads-up to the flop — want to build a game tree and
            solve it?
          </p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={declineSolve}
              className="flex-1 cursor-pointer rounded-xl border border-hairline bg-white/5 py-3 font-medium text-slate-100 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              No thanks
            </button>
            <button
              type="button"
              onClick={acceptSolve}
              className="flex-1 cursor-pointer rounded-xl bg-accent py-3 font-semibold text-on-accent transition-all hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              Yes, solve it
            </button>
          </div>
        </div>
      </ResponsiveDrawer>
      {/* Step 2: the full tree-building panel once the user accepts. */}
      {solveOffer && solveInit && (
        <TreeBuildingModal
          init={solveInit}
          solvedForLine={[]}
          busy={solveBusy}
          notice={solveNotice}
          error={solveError}
          onClose={finishSolveFlow}
          onConfirm={(r) => void confirmSolveUpload(r)}
        />
      )}
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
      <div className="flex flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
      {/* ───────── Table (left column) ───────── */}
      <div className="w-full lg:flex-1 lg:min-w-0 relative pt-2">
      {/* Placement banner overlays the table top so it takes no flow height —
          arming never shifts the layout. The idle "move button" affordance
          lives on the D badge itself. */}
      {placement && (
        <div className="pointer-events-none absolute left-1/2 top-1 z-40 -translate-x-1/2">
          {/* Only Cancel takes pointer events: on small tables the pill can
              overlap the top-center seat, and the whole point of this armed
              state is that every seat stays tappable - so taps pass through
              the pill body to whatever sits beneath it. */}
          <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow">
            <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            {placement.kind === "button"
              ? "Tap a seat to move the button"
              : "Tap a seat to move this player"}
            <button
              type="button"
              onClick={() => setPlacement(null)}
              className="pointer-events-auto ml-1 underline underline-offset-2"
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
            onEditBoard={() => {
              setBoardAutoClose(null);
              setEditingBoard(true);
            }}
            onEditBoard2={() => setEditingBoard2(true)}
            onAddBoard={() => update({ numBoards: 2 })}
            onRemoveBoard={() => update({ numBoards: 1 })}
          />
        }
      />
      </div>

      {/* ───────── Controls (right column) ───────── */}
      {/* `mt-auto` docks this to the bottom of the viewport on mobile (setup
          form and action panel alike); on lg it's a side column again, where an
          auto top margin would instead push it to the bottom of the row. */}
      <div
        data-testid="hh-controls"
        className="mt-auto w-full lg:mt-0 lg:w-[400px] lg:flex-shrink-0"
      >
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
                  onClick={() => void saveHand()}
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
          {/* Wraps rather than squashing: on a narrow phone the two action
              pills take the first line and the text links drop below. */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuickSetupOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/60 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
              title="Enter every player's name and stack in one list"
            >
              ⚡ Quick setup
            </button>
            <button
              type="button"
              onClick={rotateSeats}
              disabled={state.seats.length < 2}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/60 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100 active:scale-95 disabled:opacity-40"
              title="Move every player one seat clockwise — positions and blinds are unchanged, so use it to line the table up with where everyone actually sat"
            >
              <span
                aria-hidden="true"
                className="inline-block transition-transform duration-500 ease-out"
                style={{ transform: `rotate(${rotateSpin * 360}deg)` }}
              >
                ⟳
              </span>
              Rotate seats
            </button>
            </div>
            <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveLayout}
              className={`text-[11px] underline underline-offset-2 transition ${
                layoutSavedFlash
                  ? "text-emerald-600 no-underline"
                  : "text-gray-400 hover:text-gray-600"
              }`}
              title="Save the current table setup (blinds, seats, stacks) for quick reuse"
            >
              {layoutSavedFlash ? "Saved ✓" : "Save layout"}
            </button>
            {savedLayout && (
              <button
                type="button"
                onClick={handleLoadLayout}
                className="text-[11px] text-gray-400 underline underline-offset-2 transition hover:text-gray-600"
                title={
                  savedLayout.savedAt
                    ? `Load the saved table layout (saved ${new Date(savedLayout.savedAt).toLocaleString()})`
                    : "Load the saved table layout"
                }
              >
                Load layout
              </button>
            )}
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] text-gray-400 underline underline-offset-2 transition hover:text-gray-600"
            >
              Clear all
            </button>
            </div>
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
          <div className="mt-3 grid grid-cols-4 gap-3">
            <Field label="Small blind">
              <input type="tel" inputMode="decimal" className={inputCls} value={state.smallBlind} onChange={(e) => update({ smallBlind: e.target.value })} />
            </Field>
            <Field label="Big blind">
              <input type="tel" inputMode="decimal" className={inputCls} value={state.bigBlind} onChange={(e) => update({ bigBlind: e.target.value })} />
            </Field>
            {/* The straddle is posted by whoever sits after the BB — it follows
                that position when the button moves (see utgStraddleSeat). */}
            <Field label="Straddle">
              <input
                type="tel"
                inputMode="decimal"
                className={inputCls}
                value={state.utgStraddle ?? ""}
                placeholder="None"
                onChange={(e) => update({ utgStraddle: e.target.value })}
              />
            </Field>
            <Field label="Ante (total)">
              <input type="tel" inputMode="decimal" className={inputCls} value={state.ante} onChange={(e) => update({ ante: e.target.value })} />
            </Field>
          </div>

          <label className="mt-3 flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-700">Comment</span>
            <textarea
              rows={1}
              className={`${inputCls} resize-y`}
              value={state.comment}
              onChange={(e) => update({ comment: e.target.value })}
              placeholder="Optional note about this hand…"
            />
          </label>

          <p className="mt-3 text-[11px] text-gray-500">
            Tap each seat to set its name, stack, and hole cards. Mark the dealer
            button, your own seat (hero), or straddles (up to a triple straddle —
            each defaults to double the last). Use the “+ 2nd board” chip
            on the table to play a double board. “Rotate seats” spins everyone one
            seat clockwise when the drawn table doesn't line up with where you
            actually sat. Then press Start to record the action.
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

      {(() => {
        // Mounted permanently (like the board sheets) so the drawer's exit
        // animation plays: while closing, it renders against the last seat
        // edited, clamped in case the table shrank since.
        const seatIdx = Math.min(editingSeat ?? lastEditedSeatRef.current, state.seats.length - 1);
        // This seat's slot in the straddle chain: its existing position, or the
        // next open one (straddle → double → triple). The amount handed to the
        // modal is the posted amount, or the doubled default for a fresh one.
        const straddles = straddlesOf(state);
        const existingIdx = straddles.findIndex((s) => s.seat === seatIdx);
        const straddleOrder = existingIdx >= 0 ? existingIdx : straddles.length;
        const straddleAmount =
          existingIdx >= 0
            ? straddles[existingIdx].amount
            : defaultStraddleAmount(straddles, straddleOrder, state.bigBlind);
        return (
        <SeatEditorModal
          open={editingSeat !== null}
          positionLabel={labels[seatIdx] || `Seat ${seatIdx + 1}`}
          seat={state.seats[seatIdx]}
          isButton={state.buttonSeat === seatIdx}
          isHero={state.heroSeat === seatIdx}
          isStraddle={existingIdx >= 0}
          straddleOrder={straddleOrder}
          straddleAmount={straddleAmount}
          canStraddle={existingIdx >= 0 || straddles.length < MAX_STRADDLES}
          capacity={cardsPerHand}
          otherUsed={usedCards(state, state.seats[seatIdx].holeCards)}
          onSave={(result) => saveSeat(seatIdx, result)}
          onClose={() => setEditingSeat(null)}
          allowStructural={phase === "setup"}
          onEmpty={() => emptySeatAt(seatIdx)}
          onMove={() => {
            setEditingSeat(null);
            setPlacement({ kind: "move", from: seatIdx });
          }}
        />
        );
      })()}

      {/* Both board sheets stay mounted so their exit animation plays (see
          ResponsiveDrawer). */}
      <BoardEditorModal
        open={editingBoard}
        board={state.board}
        otherUsed={usedCards(state, state.board)}
        title={state.numBoards === 2 ? "Board 1" : "Board"}
        autoCloseAt={boardAutoClose}
        onSave={(board) => {
          update({ board });
          setEditingBoard(false);
        }}
        onClose={() => setEditingBoard(false)}
      />

      <BoardEditorModal
        open={editingBoard2}
        board={state.board2}
        otherUsed={usedCards(state, state.board2)}
        title="Board 2"
        onSave={(board2) => {
          update({ board2 });
          setEditingBoard2(false);
        }}
        onClose={() => setEditingBoard2(false)}
      />
    </div>
  );
};

// The control is nested inside the <label> rather than sitting next to it, so
// it's implicitly associated with no id/htmlFor bookkeeping - assistive tech
// announces the field's name, and tapping the caption focuses the input.
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1">
    <span className="text-xs font-medium text-gray-700">{label}</span>
    {children}
  </label>
);

export default CreateHandHistory;
