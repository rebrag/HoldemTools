// src/pages/handhistory/create/engine.ts
// Client-side no-limit hold'em betting engine for the hand recorder.
// Tracks stacks/pot/street/turn order and records action tokens for the text
// serializer. Simplifications (documented for future work): single main pot
// (no side pots), and showdown winners are chosen by the user.
import type { AdvancedHandState, HoleCards } from "./types";
import { positionLabels } from "./positions";

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

export interface Engine {
  players: EnginePlayer[]; // in seat order (only occupied seats)
  bb: number;
  sb: number;
  ante: number;
  straddle: number;
  straddleIndex: number | null; // players index of the straddler
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
  streetMeta: StreetMeta[]; // index by street (1..3 populated)
  done: boolean;
  winners: number[] | null; // player indices for board 1; null = needs user selection
  winners2: number[] | null; // player indices for board 2 (only when numBoards === 2)
  heroIndex: number | null; // players index of the hero seat
}

export function fmtBB(chips: number, bb: number): string {
  const v = chips / (bb || 1);
  return (Math.round(v * 100) / 100).toString();
}

// Literal chip amount, formatted like a currency figure ("96000.00").
export function fmtChips(chips: number): string {
  return (Math.round(chips * 100) / 100).toFixed(2);
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
  const labels = positionLabels(state.tableSize, state.buttonSeat);

  const players: EnginePlayer[] = [];
  state.seats.forEach((seat, i) => {
    if (!seat.occupied) return;
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
    straddle: 0,
    straddleIndex: null,
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

  // Straddle (optional, any seat): a live bet posted after the blinds that
  // becomes the new amount to call preflop.
  let startFrom = bbIdx >= 0 ? bbIdx : effSb;
  const straddleIdx =
    state.straddleSeat != null ? players.findIndex((p) => p.seat === state.straddleSeat) : -1;
  if (straddleIdx >= 0) {
    const straddleAmt = num(state.straddleAmount, bb * 2);
    e.pot += commit(players[straddleIdx], straddleAmt);
    e.straddle = straddleAmt;
    e.straddleIndex = straddleIdx;
    e.currentBet = straddleAmt;
    e.minRaise = Math.max(bb, straddleAmt - bb);
    startFrom = straddleIdx;
  } else {
    e.currentBet = bb;
    e.minRaise = bb;
  }

  // First to act preflop: left of the big blind (or the straddler, if any).
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
export function applyAction(prev: Engine, kind: ActionKind, amountTo?: number): Engine {
  const e = clone(prev);
  if (e.toAct == null || e.done) return e;
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

  // Hand ends immediately if only one player remains.
  const live = e.players.filter((pl) => !pl.folded);
  if (live.length === 1) {
    const winnerIdx = e.players.indexOf(live[0]);
    e.toAct = null;
    e.done = true;
    e.winners = [winnerIdx];
    e.winners2 = e.numBoards === 2 ? [winnerIdx] : null;
    return e;
  }

  const next = nextToAct(e, idx);
  if (next != null) {
    e.toAct = next;
    return e;
  }
  // Betting round complete → return any uncalled excess, then advance.
  returnUncalled(e);
  return advanceStreet(e);
}

function canActCount(e: Engine): number {
  return e.players.filter((p) => !p.folded && !p.allIn).length;
}

function advanceStreet(e: Engine): Engine {
  // If fewer than two players can still act, the money is all in as of the
  // just-completed street; remaining streets are pure run-outs. Record that
  // street so callers can compute all-in equity from the right board state.
  if (e.allInStreet == null && canActCount(e) < 2 && e.players.filter((p) => !p.folded).length >= 2) {
    e.allInStreet = e.street;
  }
  // Reset per-street state.
  for (const p of e.players) p.committed = 0;
  e.currentBet = 0;
  e.minRaise = e.bb;
  e.acted = e.players.map(() => false);

  while (e.street < 3) {
    e.street += 1;
    e.reached = Math.max(e.reached, e.street);
    e.streetMeta[e.street] = {
      potStart: e.pot,
      players: e.players.filter((p) => !p.folded).length,
    };
    if (canActCount(e) >= 2) {
      // Normal betting street.
      const buttonSeat = buttonSeatOf(e);
      e.toAct = firstToActPostflop(e, buttonSeat);
      if (e.toAct != null) return e;
    }
    // else: nobody (or only one) can act — run it out to the next street.
  }

  // Reached showdown.
  return finishHand(e);
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

export { STREET_NAMES, displayName };
