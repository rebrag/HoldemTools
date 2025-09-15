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
const better = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);

/* ---------- cards ---------- */
const RANKS = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"];
const SUITS = ["h","d","c","s"];
const buildDeck = (): string[] => {
  const deck: string[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
};

// Add near top of worker:
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
    h1: string[]; h2: string[];
    seed: number;
    reportEvery: number;
    maxSamples: number; // per worker safety cap
  };
};
type StartExactMsg = {
  type: "start-exact";
  payload: {
    game: GameType;
    h1: string[]; h2: string[];
    board: string[];     // 3/4/5 cards
    avail: string[];     // remaining deck (precomputed by host)
  };
};
type CancelMsg = { type: "cancel" };
type InMsg = StartPreflopMsg | StartExactMsg | CancelMsg;

/* preflop progress deltas (host aggregates) */
type IncMsg =
  | { type: "progress"; dw1: number; dw2: number; dt: number; dn: number }
  | { type: "done";     dw1: number; dw2: number; dt: number; dn: number };

/* postflop streaming (totals) */
type ExactOut =
  | { type: "progress"; w1: number; w2: number; t: number; n: number }
  | { type: "done";     w1: number; w2: number; t: number; n: number };

let canceled = false;

/* helpers to post typed messages */
const postInc = (m: IncMsg) => self.postMessage(m);
const postExact = (m: ExactOut) => self.postMessage(m);

/* ---------- exact postflop enumeration ---------- */
function evalPair(game: GameType, board5: string[], h1: string[], h2: string[]) {
  const v1 = game === "texas-holdem" ? bestHoldem(board5, h1) : bestOmaha(board5, h1);
  const v2 = game === "texas-holdem" ? bestHoldem(board5, h2) : bestOmaha(board5, h2);
  const cmp = better(v1, v2);
  if (cmp === 0) return { w1: 0, w2: 0, t: 1 };
  if (cmp < 0)  return { w1: 1, w2: 0, t: 0 };
  return { w1: 0, w2: 1, t: 0 };
}

/* ---------- worker entry ---------- */
self.onmessage = (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === "cancel") { canceled = true; return; }

  if (msg.type === "start-preflop") {
    canceled = false;
    const { game, h1, h2, seed, reportEvery, maxSamples } = msg.payload;
    seedLCG(seed);

    // build avail from deck minus hole cards
    const deck = buildDeck();
    const used = new Set<string>([...h1, ...h2]);
    const avail = deck.filter((c) => !used.has(c));

    const shifts = Array.from({ length: 5 }, () => Math.random());
    let qIndex = (seed % 1_000_000_007) || 1;
    const USE_QMC = true; // toggle

    // AFTER (remove unused w1/w2/t, keep n and deltas)
    let n = 0;
    let dw1 = 0, dw2 = 0, dt = 0, dn = 0;

    const step = () => {
    const board5 = USE_QMC ? draw5Halton(avail, qIndex++, shifts) : draw5(avail);
    // const board5 = draw5(avail);
    const v1 = game === "texas-holdem" ? bestHoldem(board5, h1) : bestOmaha(board5, h1);
    const v2 = game === "texas-holdem" ? bestHoldem(board5, h2) : bestOmaha(board5, h2);
    const cmp = better(v1, v2);
    if (cmp === 0) { dt++; } else if (cmp < 0) { dw1++; } else { dw2++; }
    n++; dn++;
    };


    while (!canceled && n < maxSamples) {
      step();
      if (n % reportEvery === 0) {
        postInc({ type: "progress", dw1, dw2, dt, dn });
        dw1 = 0; dw2 = 0; dt = 0; dn = 0;
      }
    }
    // flush remainder
    if (!canceled && (dw1 || dw2 || dt || dn)) {
      postInc({ type: "progress", dw1, dw2, dt, dn });
      dw1 = 0; dw2 = 0; dt = 0; dn = 0;
    }
    // tell host we're done (maybe due to cap)
    postInc({ type: "done", dw1: 0, dw2: 0, dt: 0, dn: 0 });
    return;
  }

  if (msg.type === "start-exact") {
    canceled = false;
    const { game, h1, h2, board, avail } = msg.payload;

    let w1 = 0, w2 = 0, t = 0, n = 0;

    const tally = (board5: string[]) => {
      const r = evalPair(game, board5, h1, h2);
      w1 += r.w1; w2 += r.w2; t += r.t; n += 1;
      if (n % 5000 === 0) postExact({ type: "progress", w1, w2, t, n });
    };

    if (board.length === 3) {
      // flop: choose 2 from avail for turn+river
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

    postExact({ type: "done", w1, w2, t, n });
    return;
  }
};
