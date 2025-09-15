// A Vite module worker. No DOM APIs here.
import * as PHE from "phe";

// ---------- evaluator adapter ----------
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

// ---------- cards ----------
const RANKS = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"];
const SUITS = ["h","d","c","s"];
const buildDeck = (): string[] => {
  const deck: string[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
};

// best-of-7 NLH
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

// best-of-5 Omaha (exact 2 from hole, 3 from board) for PLO4/PLO5
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

// ---------- Wilson half-width ----------
function wilsonHalf(p: number, n: number, z: number) {
  if (n === 0) return 1;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const term = p * (1 - p) / n + z2 / (4 * n * n);
  return (z / denom) * Math.sqrt(term);
}

// ---------- Quasi-random board draw: partial Fisher–Yates with LCG ----------
let lcgState = (Date.now() ^ (Math.random() * 0x9e3779b9)) >>> 0;
function rand(): number {
  // LCG constants (Numerical Recipes)
  lcgState = (1664525 * lcgState + 1013904223) >>> 0;
  return (lcgState >>> 8) / 0x01000000; // [0,1)
}
function draw5(avail: string[]): string[] {
  const a = avail.slice();
  for (let t = 0; t < 5; t++) {
    const j = t + Math.floor(rand() * (a.length - t));
    [a[t], a[j]] = [a[j], a[t]];
  }
  return [a[0], a[1], a[2], a[3], a[4]];
}

// ---------- Messages ----------
type StartMsg = {
  type: "start";
  payload: {
    game: GameType;
    h1: string[];
    h2: string[];
    z: number;
    eps: number;         // target half-width (fraction, e.g., 0.005 for 0.5%)
    minSamples: number;
    maxSamples: number;
    reportEvery: number;
  };
};
type CancelMsg = { type: "cancel" };
type InMsg = StartMsg | CancelMsg;

type ProgressMsg = {
  type: "progress" | "done";
  w1: number; w2: number; t: number; n: number;
  estP1: number; estP2: number; estTie: number;
  half: number;
};

let canceled = false;

onmessage = (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === "cancel") { canceled = true; return; }
  if (msg.type !== "start") return;

  canceled = false;

  const { game, h1, h2, z, eps, minSamples, maxSamples, reportEvery } = msg.payload;

  // Precompute avail deck (preflop)
  const deck = buildDeck();
  const used = new Set<string>([...h1, ...h2]);
  const avail = deck.filter((c) => !used.has(c));

  let w1 = 0, w2 = 0, ties = 0, n = 0;
  const post = (type: "progress" | "done", half: number) => {
    const p1 = (w1 + 0.5 * ties) / n;
    const p2 = (w2 + 0.5 * ties) / n;
    const ptie = ties / n;
    const msgOut: ProgressMsg = {
      type,
      w1, w2, t: ties, n,
      estP1: p1, estP2: p2, estTie: ptie,
      half
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (postMessage as any)(msgOut);
  };

  const step = () => {
    const board5 = draw5(avail);
    const v1 =
      game === "texas-holdem" ? bestHoldem(board5, h1) : bestOmaha(board5, h1);
    const v2 =
      game === "texas-holdem" ? bestHoldem(board5, h2) : bestOmaha(board5, h2);
    const cmp = better(v1, v2);
    if (cmp === 0) ties++;
    else if (cmp < 0) w1++; else w2++;
    n++;
  };

  while (!canceled && n < maxSamples) {
    step();

    if (n % reportEvery === 0) {
      // compute current worst half-width
      const p1 = (w1 + 0.5 * ties) / n;
      const p2 = (w2 + 0.5 * ties) / n;
      const h = Math.max(wilsonHalf(p1, n, z), wilsonHalf(p2, n, z));
      post("progress", h);
      if (n >= minSamples && h <= eps) {
        post("done", h);
        return;
      }
    }
  }

  // Cap reached or canceled
  const p1 = n ? (w1 + 0.5 * ties) / n : 0;
  const p2 = n ? (w2 + 0.5 * ties) / n : 0;
  const h = n ? Math.max(wilsonHalf(p1, n, z), wilsonHalf(p2, n, z)) : 1;
  post("done", h);
};
