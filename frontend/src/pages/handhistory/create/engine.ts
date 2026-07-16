// src/pages/handhistory/create/engine.ts
// Client-side no-limit hold'em betting engine for the hand recorder.
// Tracks stacks/pot/street/turn order and records action tokens for the text
// serializer. Simplifications (documented for future work): single main pot
// (no side pots), and showdown winners are chosen by the user.
import type { AdvancedHandState, HoleCards } from "./types";
import { straddlesOf } from "./types";
import { positionLabelsForSeats } from "./positions";

export interface EnginePlayer {
  seat: number;
  name: string; // display: custom name or position
  pos: string;
  startingStack: number;
  stack: number;
  committed: number; // this street
  totalCommitted: number; // whole hand
  folded: boolean;
  foldedStreet: number | null;
  allIn: boolean;
  hole: HoleCards;
}

export interface StreetMeta {
  potStart: number;
  players: number; // not folded at street start
}

// A single betting action, recorded structurally so serializers can render it
// in any unit (the text format uses big blinds).
export interface EngineAction {
  player: number; // index into engine.players
  kind: "fold" | "check" | "call" | "bet" | "raise";
  amount: number; // call: chips added this action; bet/raise: total street commitment
  allIn: boolean;
}

// A posted straddle: players index + posted amount, in posting order
// (straddle, double straddle, triple straddle).
export interface EngineStraddle {
  index: number;
  amount: number;
}

export interface Engine {
  players: EnginePlayer[]; // in seat order (only occupied seats)
  bb: number;
  sb: number;
  ante: number;
  straddles: EngineStraddle[];
  numBoards: 1 | 2;
  street: number; // 0 preflop, 1 flop, 2 turn, 3 river
  reached: number; // highest street reached (for board display / serialization)
  allInStreet: number | null; // street at which betting closed with <2 able to act

  currentBet: number;
  minRaise: number;
  toAct: number | null; // index into players, null when resolving/done
  acted: boolean[];
  pot: number;
  streetActions: EngineAction[][]; // structured actions, per street
  streetMeta: StreetMeta[]; // by street; [0].potStart = pot after forced bets
  done: boolean;
  winners: number[] | null; // player indices for board 1; null = needs user selection
  winners2: number[] | null; // player indices for board 2 (only when numBoards === 2)
  heroIndex: number | null; // players index of the hero seat
}

export function fmtBB(chips: number, bb: number): string {
  const v = chips / (bb || 1);
  return (Math.round(v * 100) / 100).toString();
}

// Literal chip amount as a currency figure. Whole amounts drop the decimals
// ("96000"); fractional amounts keep two places ("0.50", "2.75").
export function fmtChips(chips: number): string {
  const rounded = Math.round(chips * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function fmtUnit(chips: number, bb: number, unit: "bb" | "chips"): string {
  return unit === "chips" ? fmtChips(chips) : fmtBB(chips, bb);
}

function num(s: string, fallback: number): number {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function displayName(seatName: string, pos: string): string {
  const n = seatName.trim();
  return n || pos;
}

function clone(e: Engine): Engine {
  return {
    ...e,
    players: e.players.map((p) => ({ ...p, hole: [...p.hole] as HoleCards })),
    straddles: e.straddles.map((s) => ({ ...s })),
    acted: [...e.acted],
    streetActions: e.streetActions.map((t) => t.map((a) => ({ ...a }))),
    streetMeta: e.streetMeta.map((m) => ({ ...m })),
    winners: e.winners ? [...e.winners] : null,
    winners2: e.winners2 ? [...e.winners2] : null,
  };
}

// When a bet/raise closes the action and no live opponent can call the full
// amount, the uncommitted excess is returned to the aggressor.
function returnUncalled(e: Engine): void {
  const live = e.players.filter((p) => !p.folded);
  if (live.length < 2) return;
  const maxCommitted = Math.max(...live.map((p) => p.committed));
  const top = live.filter((p) => p.committed === maxCommitted);
  if (top.length !== 1) return;
  const p = top[0];
  const second = Math.max(0, ...live.filter((pl) => pl !== p).map((pl) => pl.committed));
  const excess = maxCommitted - second;
  if (excess > 1e-9) {
    p.committed -= excess;
    p.stack += excess;
    p.totalCommitted -= excess;
    p.allIn = p.stack <= 0;
    e.pot -= excess;
    // The compact text format reflects returned chips in the final win amounts,
    // so no explicit "uncalled bet returned" action is recorded here.
  }
}

function commit(p: EnginePlayer, amt: number): number {
  const actual = Math.min(amt, p.stack);
  p.stack -= actual;
  p.committed += actual;
  p.totalCommitted += actual;
  if (p.stack <= 0) p.allIn = true;
  return actual;
}

function nextToAct(e: Engine, from: number): number | null {
  const n = e.players.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    const p = e.players[i];
    if (!p.folded && !p.allIn && !e.acted[i]) return i;
  }
  return null;
}

function firstToActPostflop(e: Engine, buttonSeat: number): number | null {
  const n = e.players.length;
  // start left of the button, first player who can act
  const btnIdx = e.players.findIndex((p) => p.seat === buttonSeat);
  const start = btnIdx >= 0 ? btnIdx : n - 1;
  for (let step = 1; step <= n; step++) {
    const i = (start + step) % n;
    const p = e.players[i];
    if (!p.folded && !p.allIn) return i;
  }
  return null;
}

const STREET_NAMES = ["Preflop", "Flop", "Turn", "River"];

export function buildEngine(state: AdvancedHandState): Engine {
  const bb = num(state.bigBlind, 1);
  const sb = num(state.smallBlind, bb / 2);
  const ante = Math.max(0, parseFloat(state.ante) || 0);
  const labels = positionLabelsForSeats(
    state.seats.map((s) => s.occupied && !s.sittingOut),
    state.buttonSeat
  );

  const players: EnginePlayer[] = [];
  state.seats.forEach((seat, i) => {
    if (!seat.occupied || seat.sittingOut) return;
    const startingStack = num(seat.stack, 100 * bb);
    players.push({
      seat: i,
      name: displayName(seat.name, labels[i]),
      pos: labels[i],
      startingStack,
      stack: startingStack,
      committed: 0,
      totalCommitted: 0,
      folded: false,
      foldedStreet: null,
      allIn: false,
      hole: [...seat.holeCards] as HoleCards,
    });
  });

  const e: Engine = {
    players,
    bb,
    sb,
    ante,
    straddles: [],
    numBoards: state.numBoards,
    street: 0,
    reached: 0,
    allInStreet: null,
    currentBet: 0,
    minRaise: bb,
    toAct: null,
    acted: players.map(() => false),
    pot: 0,
    streetActions: [[], [], [], []],
    streetMeta: [
      { potStart: 0, players: players.length },
      { potStart: 0, players: 0 },
      { potStart: 0, players: 0 },
      { potStart: 0, players: 0 },
    ],
    done: false,
    winners: null,
    winners2: null,
    heroIndex: null,
  };

  const heroIdx = players.findIndex((p) => p.seat === state.heroSeat);
  e.heroIndex = heroIdx >= 0 ? heroIdx : null;

  // Ante is a single total contribution of dead money added straight to the
  // pot; it is not deducted from any player's stack.
  if (ante > 0) e.pot += ante;

  // Blinds.
  const sbIdx = players.findIndex((p) => p.pos === "SB");
  const bbIdx = players.findIndex((p) => p.pos === "BB");
  // Heads-up: button is the small blind.
  const btnIdx = players.findIndex((p) => p.pos === "BTN");
  const effSb = sbIdx >= 0 ? sbIdx : btnIdx;
  if (effSb >= 0) e.pot += commit(players[effSb], sb);
  if (bbIdx >= 0) e.pot += commit(players[bbIdx], bb);

  // Straddles (optional, any seat including the blinds, up to three): live
  // bets posted in order after the blinds. Each amount is the seat's TOTAL
  // preflop commitment, so a blind tops up to the straddle level instead of
  // re-posting on top of its blind. Each one raises the amount to call; each
  // consecutive straddle defaults to double the previous one.
  let startFrom = bbIdx >= 0 ? bbIdx : effSb;
  e.currentBet = bb;
  e.minRaise = bb;
  let prevLevel = bb; // bet level before the straddle being posted
  for (const s of straddlesOf(state)) {
    const idx = players.findIndex((p) => p.seat === s.seat);
    if (idx < 0) continue;
    const amt = num(s.amount, prevLevel * 2);
    e.pot += commit(players[idx], Math.max(0, amt - players[idx].committed));
    e.straddles.push({ index: idx, amount: amt });
    e.currentBet = Math.max(e.currentBet, amt);
    e.minRaise = Math.max(bb, e.currentBet - prevLevel);
    startFrom = idx;
    prevLevel = e.currentBet;
  }
  // Preflop pot after all forced bets — serialization's "Pre Flop: (pot: $X)".
  e.streetMeta[0].potStart = e.pot;

  // First to act preflop: left of the big blind (or the last straddler, if any).
  e.toAct = nextToAct(e, startFrom);
  return e;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number; // additional chips to call
  canBet: boolean; // open a bet (no current bet)
  canRaise: boolean;
  minRaiseTo: number; // total street commitment for a min raise/bet
  maxTo: number; // all-in total
  playerCommitted: number;
}

export function legalActions(e: Engine): LegalActions | null {
  if (e.toAct == null || e.done) return null;
  const p = e.players[e.toAct];
  const toCall = e.currentBet - p.committed;
  const maxTo = p.committed + p.stack;
  const canBet = e.currentBet === 0 && p.stack > 0;
  const openSize = e.currentBet === 0 ? e.bb : e.minRaise;
  return {
    canFold: true,
    canCheck: toCall <= 0,
    canCall: toCall > 0 && p.stack > 0,
    callAmount: Math.min(toCall, p.stack),
    canBet,
    canRaise: e.currentBet > 0 && p.stack > toCall,
    minRaiseTo: Math.min(e.currentBet + openSize, maxTo),
    maxTo,
    playerCommitted: p.committed,
  };
}

export type ActionKind = "fold" | "check" | "call" | "bet" | "raise" | "allin";

// amountTo = desired total street commitment (for bet/raise/allin-as-bet).
// How settling one action left the betting round:
//   "none"    — action played, betting continues (toAct advanced to the next actor)
//   "advance" — betting round closed; the caller collects bets and deals the next street
//   "foldout" — only one player remains; the caller awards the pot
export type SettleClose = "none" | "advance" | "foldout";

// Apply an action's chip/fold effects and record it, WITHOUT advancing the
// street or ending the hand. Split out of applyAction so the replayer can show
// the action on its own frame before the board and pot react to it; applyAction
// composes settleAction with the resolution below and is unchanged externally.
export function settleAction(
  prev: Engine,
  kind: ActionKind,
  amountTo?: number
): { e: Engine; close: SettleClose } {
  const e = clone(prev);
  if (e.toAct == null || e.done) return { e, close: "none" };
  const idx = e.toAct;
  const p = e.players[idx];
  const actions = e.streetActions[e.street];

  const record = (k: EngineAction["kind"], amount: number, allIn: boolean) =>
    actions.push({ player: idx, kind: k, amount, allIn });

  const pushAggressive = (to: number, k: "bet" | "raise") => {
    const before = p.committed;
    const put = to - before;
    commit(p, put);
    e.currentBet = p.committed;
    e.minRaise = Math.max(e.bb, put); // raise increment ≈ amount added
    // Everyone still in must act again.
    e.acted = e.players.map((pl, i) =>
      i === idx ? true : pl.folded || pl.allIn ? true : false
    );
    e.pot += p.committed - before;
    record(k, p.committed, p.allIn); // amount = total street commitment
  };

  switch (kind) {
    case "fold":
      p.folded = true;
      p.foldedStreet = e.street;
      e.acted[idx] = true;
      record("fold", 0, false);
      break;
    case "check":
      e.acted[idx] = true;
      record("check", 0, false);
      break;
    case "call": {
      const toCall = e.currentBet - p.committed;
      const put = commit(p, toCall);
      e.pot += put;
      e.acted[idx] = true;
      record("call", put, p.allIn); // amount = chips added this action
      break;
    }
    case "bet": {
      const to = Math.max(amountTo ?? e.bb, p.committed + e.bb);
      pushAggressive(Math.min(to, p.committed + p.stack), "bet");
      break;
    }
    case "raise": {
      const to = amountTo ?? e.currentBet + e.minRaise;
      pushAggressive(Math.min(to, p.committed + p.stack), "raise");
      break;
    }
    case "allin": {
      const to = p.committed + p.stack;
      if (to > e.currentBet) {
        pushAggressive(to, e.currentBet === 0 ? "bet" : "raise");
      } else {
        // short all-in call
        const before = p.committed;
        commit(p, p.stack);
        e.acted[idx] = true;
        e.pot += p.committed - before;
        record("call", p.committed - before, true);
      }
      break;
    }
  }

  // Only one player left → fold-out win, resolved by the caller.
  const live = e.players.filter((pl) => !pl.folded);
  if (live.length === 1) return { e, close: "foldout" };

  const next = nextToAct(e, idx);
  if (next != null) {
    e.toAct = next;
    return { e, close: "none" };
  }
  // Betting round complete → caller returns uncalled excess and advances.
  return { e, close: "advance" };
}

// Award the pot to the lone remaining player (fold-out). Mutates and returns e.
function finishFoldout(e: Engine): Engine {
  const live = e.players.filter((pl) => !pl.folded);
  const winnerIdx = e.players.indexOf(live[0]);
  e.toAct = null;
  e.done = true;
  e.winners = [winnerIdx];
  e.winners2 = e.numBoards === 2 ? [winnerIdx] : null;
  return e;
}

export function applyAction(prev: Engine, kind: ActionKind, amountTo?: number): Engine {
  const { e, close } = settleAction(prev, kind, amountTo);
  if (close === "foldout") return finishFoldout(e);
  if (close === "advance") {
    returnUncalled(e);
    return advanceStreet(e);
  }
  return e;
}

function canActCount(e: Engine): number {
  return e.players.filter((p) => !p.folded && !p.allIn).length;
}

// Outcome of advancing a single street:
//   "betting"  — a real betting round opened on the new street (toAct is set)
//   "runout"   — a card was dealt but nobody can act and streets still remain
//   "showdown" — the hand reached showdown (done)
export type StreetStatus = "betting" | "runout" | "showdown";

// Advance exactly one street: collect the just-closed street's bets into the pot,
// deal the next board card(s), and report how the new street resolved. Splitting
// the advance into single steps lets the replayer reveal a run-out one card at a
// time; advanceStreet loops this to reproduce the all-at-once behavior. Pure.
function stepStreet(prev: Engine): { e: Engine; status: StreetStatus } {
  const e = clone(prev);
  // First time betting is effectively closed with money still live, record the
  // street so callers can compute all-in equity from the right board state.
  if (e.allInStreet == null && canActCount(e) < 2 && e.players.filter((p) => !p.folded).length >= 2) {
    e.allInStreet = e.street;
  }
  // Collect this street's bets into the pot (committed → 0) and reset per-street
  // state. Idempotent on later run-out steps, where committed is already 0.
  for (const p of e.players) p.committed = 0;
  e.currentBet = 0;
  e.minRaise = e.bb;
  e.acted = e.players.map(() => false);

  if (e.street >= 3) return { e: finishHand(e), status: "showdown" };
  e.street += 1;
  e.reached = Math.max(e.reached, e.street);
  e.streetMeta[e.street] = {
    potStart: e.pot,
    players: e.players.filter((p) => !p.folded).length,
  };
  if (canActCount(e) >= 2) {
    const buttonSeat = buttonSeatOf(e);
    const toAct = firstToActPostflop(e, buttonSeat);
    if (toAct != null) {
      e.toAct = toAct;
      return { e, status: "betting" };
    }
  }
  // Nobody can act on the new street: a run-out card, or showdown if it's the river.
  if (e.street >= 3) return { e: finishHand(e), status: "showdown" };
  return { e, status: "runout" };
}

function advanceStreet(e: Engine): Engine {
  let cur = e;
  for (;;) {
    const { e: next, status } = stepStreet(cur);
    if (status !== "runout") return next; // "betting" or "showdown"
    cur = next;
  }
}

// The per-street advance sequence the replayer shows after a street-closing
// action: return any uncalled excess, then reveal one street at a time. Each
// entry is a distinct engine snapshot — a run-out yields several (turn, river).
// Pure; `settled` is not mutated. (applyAction folds this into a single frame.)
export function dealStreets(settled: Engine): { e: Engine; status: StreetStatus }[] {
  const base = clone(settled);
  returnUncalled(base);
  const out: { e: Engine; status: StreetStatus }[] = [];
  let cur = base;
  for (;;) {
    const step = stepStreet(cur);
    out.push(step);
    if (step.status !== "runout") break;
    cur = step.e;
  }
  return out;
}

function buttonSeatOf(e: Engine): number {
  const btn = e.players.find((p) => p.pos === "BTN");
  return btn ? btn.seat : e.players[e.players.length - 1].seat;
}

function finishHand(e: Engine): Engine {
  e.toAct = null;
  e.done = true;
  const live = e.players.filter((p) => !p.folded);
  if (live.length === 1) {
    const winnerIdx = e.players.indexOf(live[0]);
    e.winners = [winnerIdx];
    e.winners2 = e.numBoards === 2 ? [winnerIdx] : null;
  } else {
    e.winners = null; // user picks at showdown
    e.winners2 = null;
  }
  return e;
}

// board: which board this selection applies to (2 is only meaningful when numBoards === 2).
export function setWinners(prev: Engine, winnerIndices: number[], board: 1 | 2 = 1): Engine {
  const e = clone(prev);
  if (board === 2) e.winners2 = winnerIndices;
  else e.winners = winnerIndices;
  return e;
}

// Board cards revealed for the current/served street count.
export function revealedBoardCount(street: number): number {
  return [0, 3, 4, 5][Math.max(0, Math.min(3, street))];
}

// The pot as it should be *displayed*: chips only count as "in the pot" once the
// street they were wagered on is complete. While a street is live, each player's
// current-street commitment still sits in front of them as chips (see
// buildTableSeats), so it is excluded here to avoid double-counting. When the
// street ends, `advanceStreet` zeroes `committed` (the pot keeps the chips), so
// the collected amount folds into this figure exactly then. At showdown the hand
// is resolved and the whole pot is shown.
export function displayedPot(e: Engine): number {
  if (e.done) return e.pot;
  const live = e.players.reduce((s, p) => s + p.committed, 0);
  return Math.max(0, e.pot - live);
}

export { STREET_NAMES, displayName };
