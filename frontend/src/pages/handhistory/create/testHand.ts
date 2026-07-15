// src/pages/handhistory/create/testHand.ts
// A single canned hand used as an "already saved" fixture in the Hand History
// list (dev builds only). It is defined as structured recorder state + a scripted
// betting sequence and rendered through the LIVE `serializeHand`, so any change to
// the output format flows through automatically — the fixture is never a frozen
// string.
import { createInitialState } from "./types";
import { buildEngine, applyAction, setWinners } from "./engine";
import { serializeHand, type EquityInfo } from "./serialize";
import { buildReplayData, encodeReplay } from "./replay";

// Sentinel row key. Server rows key on String(id) (numeric) and local rows key on
// a UUID, so this non-numeric literal can never collide with a real hand.
export const TEST_HAND_ID = "__test-hand__";

// When to surface the fixture: the local dev server (import.meta.env.DEV) or any
// Vercel *preview* (branch) deployment. Hidden on production. VITE_VERCEL_ENV is
// bridged from Vercel's build-time VERCEL_ENV in vite.config.ts.
export const SHOW_TEST_HAND =
  import.meta.env.DEV || import.meta.env.VITE_VERCEL_ENV === "preview";

// 8-max, $1/$3 NL Hold'em, Hero on the button. With buttonSeat = heroSeat = 0 the
// position order is [BTN, SB, BB, UTG, UTG+1, MP, HJ, CO] (see positions.ts), so
// seat index == engine player index and the printed order matches the sample.
export function buildTestHandText(): string {
  const state = createInitialState(8, {
    game: "Holdem",
    smallBlind: "1",
    bigBlind: "3",
    ante: "0",
  });
  state.buttonSeat = 0;
  state.heroSeat = 0;
  state.numBoards = 1;
  state.board = ["6h", "6d", "7c", "Td", "2c"];

  // seat: [name, stack, holeCards]. Unnamed seats fall back to their position
  // label; only the BB has a custom name ("Josh"). Only Hero and HJ show cards.
  const seatData: Array<[string, string, (string | null)[]]> = [
    ["", "300", ["6s", "4c"]], // 0 BTN  → Hero
    ["", "300", [null, null]], // 1 SB
    ["Josh", "800", [null, null]], // 2 BB
    ["", "1000", [null, null]], // 3 UTG
    ["", "300", [null, null]], // 4 UTG+1
    ["", "280", [null, null]], // 5 MP
    ["", "300", ["As", "Ah"]], // 6 HJ
    ["", "800", [null, null]], // 7 CO
  ];
  seatData.forEach(([name, stack, holeCards], i) => {
    state.seats[i] = { occupied: true, name, stack, holeCards };
  });

  let e = buildEngine(state);
  // Preflop (action opens on UTG). amountTo for bet/raise = total street commitment.
  e = applyAction(e, "call"); // UTG calls $3
  e = applyAction(e, "fold"); // UTG+1 folds
  e = applyAction(e, "fold"); // MP folds
  e = applyAction(e, "raise", 15); // HJ raises to $15
  e = applyAction(e, "fold"); // CO folds
  e = applyAction(e, "call"); // Hero calls $15
  e = applyAction(e, "fold"); // SB folds
  e = applyAction(e, "fold"); // Josh (BB) folds
  e = applyAction(e, "call"); // UTG calls $12 → Flop (pot $49, 3 players)
  // Flop 6h 6d 7c
  e = applyAction(e, "check"); // UTG checks
  e = applyAction(e, "bet", 135); // HJ bets $135
  e = applyAction(e, "call"); // Hero calls $135
  e = applyAction(e, "fold"); // UTG folds → Turn (pot $319, 2 players)
  // Turn Td
  e = applyAction(e, "check"); // HJ checks
  e = applyAction(e, "check"); // Hero checks → River
  // River 2c
  e = applyAction(e, "check"); // HJ checks
  e = applyAction(e, "check"); // Hero checks
  // Two players reach showdown, so the winner isn't auto-set: Hero wins.
  e = setWinners(e, [0], 1);

  // Equity snapshots keyed by engine player index (Hero = 0, HJ = 6).
  const equity: EquityInfo = {
    byPlayer: {
      0: { pre: 17, flop: 91, turn: 95 },
      6: { pre: 83, flop: 9, turn: 5 },
    },
  };

  // No opts → site name defaults to "Yatahay Network". Append the embedded
  // replay payload so the fixture is replayable just like a real saved hand
  // (HandHistoryTool strips it from the on-screen text via stripReplay).
  return serializeHand(state, e, equity) + encodeReplay(buildReplayData(state, e));
}
