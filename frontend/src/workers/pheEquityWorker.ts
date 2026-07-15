/// <reference lib="webworker" />
// A Vite module worker. No DOM APIs here.
// Hand evaluation lives in the shared src/lib/handEval module so the same logic
// backs both this worker and the synchronous main-thread callers.
import { evalWinners } from "../lib/handEval";

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