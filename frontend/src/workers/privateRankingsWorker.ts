/// <reference lib="webworker" />
// A Vite module worker. No DOM APIs here.
// Monte Carlo "top X% of hands" rankings for the /private page. Two shapes:
//
//   draws = 0 (and all of holdem5) - deal a hand, score it as dealt, and
//   report the hand sitting at each requested percentile.
//
//   badugi with draws 1-3 - deal 4 or 5 cards, play the draw rounds with the
//   best keep each round, and rank the DEALT hand by its showdown value.
//   Post-draw hands would just rank in normal badugi order, so the
//   interesting question in a draw game is what a starting hand is worth,
//   which is where holding A-2-3 can beat standing pat on a made but weak
//   badugi. 4 cards with 3 draws is standard Badugi.
//
// Cancellation is by worker.terminate() from the host (the loop is
// synchronous, so a queued "cancel" message could never preempt it).
import { evaluateCardCodes, handRank, ranks } from "phe";
import { bestBadugiScore, bestPartialMasks } from "../lib/badugi";
import type {
  RankingsIn,
  RankingsOut,
  RankingsParams,
  RankingsCutoff,
} from "../pages/private/protocol";

/* ---------- card id tables (id = aceHighRankIdx * 4 + suitIdx) ---------- */
const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS = ["h", "d", "c", "s"];
const PHE_SUIT = [1, 2, 3, 0]; // our h,d,c,s -> phe s=0,h=1,d=2,c=3

const ID_TO_STR: string[] = new Array(52);
const ID_TO_PHE = new Int32Array(52);
const ID_TO_ACELOW = new Uint8Array(52);
const ID_TO_SUIT = new Uint8Array(52);
for (let r = 0; r < 13; r++) {
  for (let s = 0; s < 4; s++) {
    const id = r * 4 + s;
    ID_TO_STR[id] = RANKS[r] + SUITS[s];
    ID_TO_PHE[id] = (12 - r) * 4 + PHE_SUIT[s]; // phe rank: 2=0 .. A=12
    ID_TO_ACELOW[id] = r === 0 ? 0 : 13 - r; // ace low: A=0 .. K=12
    ID_TO_SUIT[id] = s;
  }
}

/** Card id of an ace-low rank in a given suit. */
const idFor = (aceLow: number, suit: number) =>
  (aceLow === 0 ? 0 : 13 - aceLow) * 4 + suit;

function popcount(m: number): number {
  let c = 0;
  while (m) { m &= m - 1; c++; }
  return c;
}

/* ---------- LCG RNG (seeded per run) ---------- */
let lcgState = 0;
function seedLCG(seed: number) { lcgState = seed >>> 0; }
function rand(): number { // [0,1)
  lcgState = (1664525 * lcgState + 1013904223) >>> 0;
  return (lcgState >>> 8) / 0x01000000;
}

const post = (m: RankingsOut) => self.postMessage(m);

// packed = score * 2^24 + handIndex must stay exact in a double: the score
// field fits 20 bits and the index must fit 24.
const MAX_HANDS = 1 << 24;

self.onmessage = (ev: MessageEvent<RankingsIn>) => {
  const msg = ev.data;
  if (msg.type !== "start") return;
  try {
    const p = msg.payload;
    if (p.mode !== "holdem5" && (p.draws ?? 0) > 0) runDraw(p);
    else runDealt(p);
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};

/** Index of the worst hand still inside the top `percent`% of `n` sorted hands. */
function cutoffIndex(n: number, percent: number): number {
  return Math.min(n - 1, Math.max(0, Math.ceil((n * percent) / 100) - 1));
}

/* ================= dealt-hand modes ================= */

function runDealt(p: RankingsParams) {
  const mode = p.mode;
  const k = mode === "badugi4" ? 4 : 5;
  const n = Math.max(1, Math.min(p.numHands, MAX_HANDS));
  seedLCG(p.seed);

  const deck = new Uint8Array(52);
  for (let i = 0; i < 52; i++) deck[i] = i;

  const cardsBuf = new Uint8Array(n * k);
  const packed = new Float64Array(n);
  const pheScratch = [0, 0, 0, 0, 0];
  const rankScratch = new Uint8Array(k);
  const suitScratch = new Uint8Array(k);
  const isHoldem = mode === "holdem5";
  let freqCount = 0;

  for (let i = 0; i < n; i++) {
    // Partial Fisher-Yates over the first k slots; the deck stays a
    // permutation between iterations, so each draw is uniform.
    for (let t = 0; t < k; t++) {
      const j = t + Math.floor(rand() * (52 - t));
      const tmp = deck[t];
      deck[t] = deck[j];
      deck[j] = tmp;
    }
    let score: number;
    if (isHoldem) {
      for (let t = 0; t < 5; t++) pheScratch[t] = ID_TO_PHE[deck[t]];
      score = evaluateCardCodes(pheScratch);
      if (handRank(score) !== ranks.HIGH_CARD) freqCount++;
    } else {
      for (let t = 0; t < k; t++) {
        const id = deck[t];
        rankScratch[t] = ID_TO_ACELOW[id];
        suitScratch[t] = ID_TO_SUIT[id];
      }
      score = bestBadugiScore(rankScratch, suitScratch);
      if (score < 1 << 16) freqCount++; // 4-card badugi
    }
    cardsBuf.set(deck.subarray(0, k), i * k);
    packed[i] = score * 0x1000000 + i;
    if ((i + 1) % p.reportEvery === 0) post({ type: "progress", done: i + 1, total: n });
  }

  packed.sort(); // TypedArray sort is numeric ascending: best hands first

  const cutoffs: RankingsCutoff[] = p.percents.map((percent) => {
    const v = packed[cutoffIndex(n, percent)];
    const score = Math.floor(v / 0x1000000);
    const at = v - score * 0x1000000;
    const cards: string[] = [];
    for (let t = 0; t < k; t++) cards.push(ID_TO_STR[cardsBuf[at * k + t]]);
    return { percent, cards, score };
  });

  post({
    type: "done",
    result: { mode, handsDealt: n, frequency: (freqCount / n) * 100, cutoffs },
  });
}

/* ================= badugi draw play (1-3 draws) ================= */

// Score -> "fraction of the field this beats" lookup. Scores fit in 18 bits:
// (4-k) << 16 tops out at 3 << 16, plus at most 12 << 12 for the high card.
const TABLE_SIZE = 1 << 18;
const CALIB_HANDS = 40_000;
const QMAX = (1 << 20) - 1;

// What a keep is worth depends only on the ranks it holds. Its suits are all
// distinct (it is a badugi partial), so any two keeps with the same ranks are
// a suit permutation apart, and a suit permutation maps the deck onto itself.
// So keeps are valued once per rank set, and value tables are built level by
// level: W[0] prices a keep with one draw left (expected utility of the final
// hand), W[d] prices it with d+1 draws left as the expectation of the BEST
// next keep under W[d-1]. That makes both the keep policy and every hand's
// recorded value deterministic - sampling noise cannot leak into the ranking,
// and two hands with the same keeps can never disagree.
//
// Approximations, both documented on the page: discards are treated as
// unknown rather than dead (the average case for a rank set, not the exact
// case for one hand), and a discard can in principle be redrawn on a later
// round because the state forgets it.
const SIG_SLOTS = 1 << 13; // rank set as a 13-bit mask
const SIG_SAMPLES = 2000; // draws of 3+ cards are sampled; 1-2 are enumerated

function runDraw(p: RankingsParams) {
  const N = p.mode === "badugi4" ? 4 : 5;
  const draws = Math.max(1, Math.min(3, Math.round(p.draws ?? 1)));
  const n = Math.max(1, Math.min(p.numHands, MAX_HANDS));
  const opponents = Math.max(1, Math.min(5, Math.round(p.opponents ?? 3)));
  seedLCG(p.seed);

  const deck = new Uint8Array(52);
  for (let i = 0; i < 52; i++) deck[i] = i;

  // The one hand buffer: always exactly N cards (kept cards first).
  const handRanks = new Uint8Array(N);
  const handSuits = new Uint8Array(N);
  const partials = new Int32Array(5);

  const counts = new Uint32Array(TABLE_SIZE);
  // utility[score] = P(a final hand with this score beats every opponent).
  const utility = new Float32Array(TABLE_SIZE);
  // W[d][rankBits] = value of holding that keep with d+1 draws remaining.
  const W: Float32Array[] = [];
  for (let d = 0; d < draws; d++) W.push(new Float32Array(SIG_SLOTS));

  // Every rank set a keep can be: sizes 1..4 of 13 ranks (1092 states).
  const STATES: number[] = [];
  for (let bits = 1; bits < SIG_SLOTS; bits++) {
    const pc = popcount(bits);
    if (pc >= 1 && pc <= 4) STATES.push(bits);
  }

  /* ---- progress: calibration hands + table states + ranked hands ---- */
  const STATE_WEIGHT = 40; // one table state costs about this many hand-ticks
  const total = CALIB_HANDS * 2 + STATES.length * draws * 2 * STATE_WEIGHT + n;
  let done = 0;
  const tick = (units: number) => {
    const before = Math.floor(done / p.reportEvery);
    done += units;
    if (Math.floor(done / p.reportEvery) > before) post({ type: "progress", done, total });
  };

  /**
   * Scan every subset of the hand buffer; valid badugi partials only. Returns
   * the mask maximizing T[rankBits] and leaves its value in keepValue. This is
   * the exact keep choice under the tables, not a per-size heuristic.
   */
  let keepValue = 0;
  const bestKeepByTable = (T: Float32Array): number => {
    let bestMask = 0;
    keepValue = -1;
    for (let mask = 1; mask < 1 << N; mask++) {
      let rankBits = 0;
      let suitBits = 0;
      let k = 0;
      let valid = true;
      for (let i = 0; i < N; i++) {
        if (!(mask & (1 << i))) continue;
        if (k === 4) { valid = false; break; } // a badugi never uses 5 cards
        const rb = 1 << handRanks[i];
        const sb = 1 << handSuits[i];
        if (rankBits & rb || suitBits & sb) { valid = false; break; }
        rankBits |= rb;
        suitBits |= sb;
        k++;
      }
      if (!valid) continue;
      const v = T[rankBits];
      if (v > keepValue) { keepValue = v; bestMask = mask; }
    }
    return bestMask;
  };

  /* ---- pricing one keep rank set ---- */

  const keptIds = new Int32Array(4);
  const pool = new Uint8Array(52);

  const priceState = (rankBits: number, Tnext: Float32Array | null): number => {
    // Lay the kept ranks into the hand buffer with canonical distinct suits.
    keptIds.fill(-1);
    let k = 0;
    for (let r = 0; r < 13; r++) {
      if (!(rankBits & (1 << r))) continue;
      handRanks[k] = r;
      handSuits[k] = k;
      keptIds[k] = idFor(r, k);
      k++;
    }
    const draw = N - k;

    const evalOutcome = (): number => {
      if (!Tnext) return utility[bestBadugiScore(handRanks, handSuits)];
      bestKeepByTable(Tnext);
      return keepValue;
    };

    if (draw === 0) return evalOutcome(); // standing pat (4-card game only)

    let w = 0;
    for (let id = 0; id < 52; id++) {
      if (id === keptIds[0] || id === keptIds[1] || id === keptIds[2] || id === keptIds[3]) continue;
      pool[w++] = id;
    }
    const poolLen = w;

    const setDrawn = (t: number, id: number) => {
      handRanks[k + t] = ID_TO_ACELOW[id];
      handSuits[k + t] = ID_TO_SUIT[id];
    };

    let sum = 0;
    let count = 0;
    if (draw === 1) {
      for (let i = 0; i < poolLen; i++) {
        setDrawn(0, pool[i]);
        sum += evalOutcome();
        count++;
      }
    } else if (draw === 2) {
      for (let i = 0; i < poolLen; i++) {
        setDrawn(0, pool[i]);
        for (let j = i + 1; j < poolLen; j++) {
          setDrawn(1, pool[j]);
          sum += evalOutcome();
          count++;
        }
      }
    } else {
      for (let s = 0; s < SIG_SAMPLES; s++) {
        for (let t = 0; t < draw; t++) {
          const j = t + Math.floor(rand() * (poolLen - t));
          const tmp = pool[t];
          pool[t] = pool[j];
          pool[j] = tmp;
          setDrawn(t, pool[t]);
        }
        sum += evalOutcome();
        count++;
      }
    }
    return sum / count;
  };

  const buildTables = () => {
    for (let d = 0; d < draws; d++) {
      const Tnext = d === 0 ? null : W[d - 1];
      const Wd = W[d];
      for (const bits of STATES) {
        Wd[bits] = priceState(bits, Tnext);
        tick(STATE_WEIGHT);
      }
    }
  };

  /* ---- field calibration ---- */

  const dealHand = () => {
    for (let t = 0; t < N; t++) {
      const j = t + Math.floor(rand() * (52 - t));
      const tmp = deck[t];
      deck[t] = deck[j];
      deck[j] = tmp;
      handRanks[t] = ID_TO_ACELOW[deck[t]];
      handSuits[t] = ID_TO_SUIT[deck[t]];
    }
  };

  /**
   * Play CALIB_HANDS hands through the draws to build the distribution of
   * final hands, which is what turns a score into "fraction of the field
   * beaten". The first pass keeps the largest, lowest partial, since no
   * tables exist yet; the second replays with the real table policy, so the
   * reference field and the policy scored against it agree. Returns the share
   * of hands that finished with a 4-card badugi.
   */
  const calibrate = (useTables: boolean): number => {
    counts.fill(0);
    let made = 0;
    for (let i = 0; i < CALIB_HANDS; i++) {
      dealHand();
      let consumed = N; // real deck: draws come from undealt cards
      for (let step = draws; step >= 1; step--) {
        let mask: number;
        if (useTables) {
          mask = bestKeepByTable(W[step - 1]);
        } else {
          bestPartialMasks(handRanks, handSuits, partials);
          mask = partials[4] >= 0 ? partials[4]
            : partials[3] >= 0 ? partials[3]
            : partials[2] >= 0 ? partials[2]
            : partials[1];
        }
        let k = 0;
        for (let t = 0; t < N; t++) {
          if (!(mask & (1 << t))) continue;
          handRanks[k] = handRanks[t];
          handSuits[k] = handSuits[t];
          k++;
        }
        for (; k < N; k++) {
          const j = consumed + Math.floor(rand() * (52 - consumed));
          const tmp = deck[consumed];
          deck[consumed] = deck[j];
          deck[j] = tmp;
          handRanks[k] = ID_TO_ACELOW[deck[consumed]];
          handSuits[k] = ID_TO_SUIT[deck[consumed]];
          consumed++;
        }
      }
      const score = bestBadugiScore(handRanks, handSuits);
      counts[score]++;
      if (score < 1 << 16) made++;
      tick(1);
    }
    // Walk from the worst score down so `acc` counts the hands this one beats.
    let acc = 0;
    for (let s = TABLE_SIZE - 1; s >= 0; s--) {
      const c = counts[s];
      const p1 = (acc + 0.5 * c) / CALIB_HANDS; // ties split
      utility[s] = Math.pow(p1, opponents);
      acc += c;
    }
    return (made / CALIB_HANDS) * 100;
  };

  calibrate(false);
  buildTables();
  const madePct = calibrate(true);
  buildTables();

  /* ---- the ranking pass: pure table lookups, fully deterministic ---- */

  const cardsBuf = new Uint8Array(n * N);
  const keepBuf = new Uint8Array(n);
  const packed = new Float64Array(n);
  const Wtop = W[draws - 1];

  for (let i = 0; i < n; i++) {
    dealHand();
    const mask = bestKeepByTable(Wtop);
    cardsBuf.set(deck.subarray(0, N), i * N);
    keepBuf[i] = mask;
    // Higher value is better, so store QMAX - q to keep the ascending sort.
    const q = Math.min(QMAX, Math.max(0, Math.round(keepValue * QMAX)));
    packed[i] = (QMAX - q) * 0x1000000 + i;
    tick(1);
  }

  packed.sort();

  const cutoffs: RankingsCutoff[] = p.percents.map((percent) => {
    const v = packed[cutoffIndex(n, percent)];
    const inv = Math.floor(v / 0x1000000);
    const at = v - inv * 0x1000000;
    const mask = keepBuf[at];
    const cards: string[] = [];
    const keep: string[] = [];
    for (let t = 0; t < N; t++) {
      const code = ID_TO_STR[cardsBuf[at * N + t]];
      cards.push(code);
      if (mask & (1 << t)) keep.push(code);
    }
    return { percent, cards, score: 0, keep, winPct: ((QMAX - inv) / QMAX) * 100 };
  });

  post({
    type: "done",
    result: {
      mode: p.mode,
      handsDealt: n,
      frequency: madePct,
      cutoffs,
      opponents,
      draws,
    },
  });
}
