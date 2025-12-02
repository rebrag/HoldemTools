/// <reference lib="webworker" />
// A Vite module worker. No DOM APIs here.
import * as PHE from "phe";

/* ---------- evaluator adapter ---------- */
type Eval5 = (cards: string[]) => number;
function resolveEval5(): Eval5 {
  const mod = PHE as Record<string, unknown>;
  const cand1 = mod.evaluateCards;
  if (typeof cand1 === "function") return cand1 as Eval5;
  const cand2 = mod.evaluate;
  if (typeof cand2 === "function") return cand2 as Eval5;
  throw new Error("Could not find evaluateCards(cards) in 'phe' inside worker.");
}
const eval5: Eval5 = resolveEval5();
// In PHE, lower value is better (1 = Best, ...). 
// The existing `better` helper (a < b ? -1) confirms this.

/* ---------- cards ---------- */
const RANKS = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"];
const SUITS = ["h","d","c","s"];
const buildDeck = (): string[] => {
  const deck: string[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
};

/* ---------- QMC / Halton ---------- */
const BASES = [2,3,5,7,11] as const;
function halton(i: number, base: number) {
  let f = 1 / base, r = 0, n = i;
  while (n > 0) { r += f * (n % base); n = Math.floor(n / base); f /= base; }
  return r;
}
function draw5Halton(avail: string[], qIndex: number, shifts: number[]) {
  const a = avail.slice();
  const n = a.length;
  const out: string[] = [];
  for (let t = 0; t < 5; t++) {
    const u = (halton(qIndex, BASES[t]) + shifts[t]) % 1;
    const j = t + Math.floor(u * (n - t));
    [a[t], a[j]] = [a[j], a[t]];
    out.push(a[t]);
  }
  return out;
}

/* ---------- best-of-7 NLH ---------- */
function bestHoldem(board5: string[], hole2: string[]): number {
  const seven = [hole2[0], hole2[1], ...board5];
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 7; j++) {
      const hand5: string[] = [];
      for (let k = 0; k < 7; k++) {
        if (k !== i && k !== j) hand5.push(seven[k]);
      }
      const v = eval5(hand5);
      if (v < best) best = v;
    }
  }
  return best;
}

/* ---------- best-of-5 Omaha (2-from-hand, 3-from-board) for PLO4/5 ---------- */
function bestOmaha(board5: string[], hole: string[]): number {
  const k = hole.length; // 4 or 5
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < k - 1; i++) {
    for (let j = i + 1; j < k; j++) {
      const h0 = hole[i], h1 = hole[j];
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 4; b++) {
          for (let c = b + 1; c < 5; c++) {
            const v = eval5([h0, h1, board5[a], board5[b], board5[c]]);
            if (v < best) best = v;
          }
        }
      }
    }
  }
  return best;
}

type GameType = "texas-holdem" | "omaha4" | "omaha5";

/* ---------- LCG RNG (per-worker seed) ---------- */
let lcgState = 0;
function seedLCG(seed: number) { lcgState = seed >>> 0; }
function rand(): number { // [0,1)
  lcgState = (1664525 * lcgState + 1013904223) >>> 0;
  return (lcgState >>> 8) / 0x01000000;
}
/* draw 5 distinct cards from avail via partial Fisher–Yates */
function draw5(avail: string[]): string[] {
  const a = avail.slice();
  for (let t = 0; t < 5; t++) {
    const j = t + Math.floor(rand() * (a.length - t));
    [a[t], a[j]] = [a[j], a[t]];
  }
  return [a[0], a[1], a[2], a[3], a[4]];
}

/* ---------- Messages ---------- */
type StartPreflopMsg = {
  type: "start-preflop";
  payload: {
    game: GameType;
    hands: string[][]; // Changed from h1, h2
    seed: number;
    reportEvery: number;
    maxSamples: number;
    dead?: string[];
  };
};
type StartExactMsg = {
  type: "start-exact";
  payload: {
    game: GameType;
    hands: string[][]; // Changed from h1, h2
    board: string[];
    avail: string[];
  };
};
type CancelMsg = { type: "cancel" };
type InMsg = StartPreflopMsg | StartExactMsg | CancelMsg;

/* preflop progress deltas (host aggregates) */
type IncMsg =
  | { type: "progress"; dwins: number[]; dt: number; dn: number }
  | { type: "done";     dwins: number[]; dt: number; dn: number };

/* postflop streaming (totals) */
type ExactOut =
  | { type: "progress"; wins: number[]; t: number; n: number }
  | { type: "done";     wins: number[]; t: number; n: number };

let canceled = false;

const postInc = (m: IncMsg) => self.postMessage(m);
const postExact = (m: ExactOut) => self.postMessage(m);

/* ---------- N-Player Evaluation ---------- */
// Returns indices of winners (multiple indices = tie)
function evalWinners(game: GameType, board5: string[], hands: string[][]): number[] {
  // 1. Calculate score for each hand
  const scores = new Array(hands.length);
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < hands.length; i++) {
    const s = game === "texas-holdem" 
      ? bestHoldem(board5, hands[i]) 
      : bestOmaha(board5, hands[i]);
    scores[i] = s;
    if (s < bestScore) bestScore = s;
  }

  // 2. Identify all players who have the best score
  const winners: number[] = [];
  for (let i = 0; i < hands.length; i++) {
    if (scores[i] === bestScore) {
      winners.push(i);
    }
  }
  return winners;
}

/* ---------- worker entry ---------- */
self.onmessage = (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === "cancel") { canceled = true; return; }

  if (msg.type === "start-preflop") {
    canceled = false;
    const { game, hands, seed, reportEvery, maxSamples, dead } = msg.payload;
    seedLCG(seed);

    const deck = buildDeck();
    const used = new Set<string>([...hands.flat(), ...(dead ?? [])]);
    const avail = deck.filter((c) => !used.has(c));

    const shifts = Array.from({ length: 5 }, () => Math.random());
    let qIndex = (seed % 1_000_000_007) || 1;
    const USE_QMC = true;

    // Accumulators
    let n = 0;
    // Local delta accumulators for reporting
    const dwins = new Array(hands.length).fill(0);
    let dt = 0;
    let dn = 0;

    const step = () => {
      const board5 = USE_QMC ? draw5Halton(avail, qIndex++, shifts) : draw5(avail);
      
      const winners = evalWinners(game, board5, hands);
      
      if (winners.length === 1) {
        // Strict win
        dwins[winners[0]]++;
      } else {
        // Tie
        dt++;
      }
      n++; dn++;
    };

    while (!canceled && n < maxSamples) {
      step();
      if (n % reportEvery === 0) {
        postInc({ type: "progress", dwins: [...dwins], dt, dn });
        // Reset deltas
        dwins.fill(0);
        dt = 0; dn = 0;
      }
    }
    
    // Flush remainder
    if (!canceled && dn > 0) {
      postInc({ type: "progress", dwins: [...dwins], dt, dn });
    }
    
    postInc({ type: "done", dwins: new Array(hands.length).fill(0), dt: 0, dn: 0 });
    return;
  }

  if (msg.type === "start-exact") {
    canceled = false;
    const { game, hands, board, avail } = msg.payload;

    const wins = new Array(hands.length).fill(0);
    let t = 0, n = 0;

    const tally = (board5: string[]) => {
      const winners = evalWinners(game, board5, hands);
      if (winners.length === 1) {
        wins[winners[0]]++;
      } else {
        t++;
      }
      n++;
      if (n % 5000 === 0) postExact({ type: "progress", wins: [...wins], t, n });
    };

    if (board.length === 3) {
      for (let i = 0; i < avail.length; i++) {
        if (canceled) break;
        for (let j = i + 1; j < avail.length; j++) {
          tally([board[0], board[1], board[2], avail[i], avail[j]]);
        }
      }
    } else if (board.length === 4) {
      for (let i = 0; i < avail.length; i++) {
        if (canceled) break;
        tally([board[0], board[1], board[2], board[3], avail[i]]);
      }
    } else {
      tally([board[0], board[1], board[2], board[3], board[4]]);
    }

    postExact({ type: "done", wins, t, n });
    return;
  }
};