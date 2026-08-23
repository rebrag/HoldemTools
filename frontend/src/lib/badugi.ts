// src/lib/badugi.ts
// Badugi hand evaluation. Pure module, safe to import from workers (no DOM,
// no heavyweight deps). A hand's badugi is the largest subset of its cards
// with all-distinct ranks AND all-distinct suits. A bigger badugi always
// beats a smaller one; equal-sized badugis compare their cards from the top
// down with the ace LOW, and lower is better (4-5-6-7 beats 4-5-6-K).

// Ace-low rank order: A=0 ... K=12. Deliberately separate from cards.ts
// RANK_IDX, which is ace-high.
export const ACE_LOW_RANK: Record<string, number> = {
  A: 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6,
  "8": 7, "9": 8, T: 9, J: 10, Q: 11, K: 12,
};
const ACE_LOW_CHAR = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"];
const SUIT_CODE: Record<string, number> = { h: 0, d: 1, c: 2, s: 3 };

function popcount(m: number): number {
  let c = 0;
  while (m) { m &= m - 1; c++; }
  return c;
}

// Subset masks of an n-card hand grouped by subset size 4, 3, 2, 1 (a badugi
// never uses 5 cards). Searching sizes largest-first lets evaluation stop at
// the first size that yields any valid badugi, since more cards always wins.
function buildMaskGroups(n: number): number[][] {
  const bySize: number[][] = [[], [], [], []]; // index 0 = size 4 ... 3 = size 1
  for (let m = 1; m < 1 << n; m++) {
    const pc = popcount(m);
    if (pc >= 1 && pc <= 4) bySize[4 - pc].push(m);
  }
  return bySize;
}
const MASK_GROUPS_4 = buildMaskGroups(4);
const MASK_GROUPS_5 = buildMaskGroups(5);

/**
 * Score a 4- or 5-card hand's best badugi. Lower = better. Allocation-free
 * (hot path for the Monte Carlo worker). Packed layout, 20 bits:
 *   ((4 - k) << 16) | d0 << 12 | d1 << 8 | d2 << 4 | d3
 * where k is the badugi size and d0 >= d1 >= ... are its ace-low ranks sorted
 * descending (unused nibbles 0). The size field dominates, so any 4-card
 * badugi scores below 1 << 16.
 */
const scratchD = [0, 0, 0, 0];
export function bestBadugiScore(
  aceLowRanks: ArrayLike<number>,
  suits: ArrayLike<number>
): number {
  const n = aceLowRanks.length;
  const groups = n === 4 ? MASK_GROUPS_4 : MASK_GROUPS_5;
  const d = scratchD;
  for (const masks of groups) {
    let best = Number.POSITIVE_INFINITY;
    for (const mask of masks) {
      let rankBits = 0;
      let suitBits = 0;
      let k = 0;
      let valid = true;
      for (let i = 0; i < n; i++) {
        if (!(mask & (1 << i))) continue;
        const rb = 1 << aceLowRanks[i];
        const sb = 1 << suits[i];
        if (rankBits & rb || suitBits & sb) { valid = false; break; }
        rankBits |= rb;
        suitBits |= sb;
        d[k++] = aceLowRanks[i];
      }
      if (!valid) continue;
      for (let a = 1; a < k; a++) { // tiny insertion sort, descending
        const v = d[a];
        let b = a - 1;
        while (b >= 0 && d[b] < v) { d[b + 1] = d[b]; b--; }
        d[b + 1] = v;
      }
      for (let i = k; i < 4; i++) d[i] = 0;
      const score = ((4 - k) << 16) | (d[0] << 12) | (d[1] << 8) | (d[2] << 4) | d[3];
      if (score < best) best = score;
    }
    if (best < Number.POSITIVE_INFINITY) return best;
  }
  // Unreachable: every single-card subset is a valid 1-card badugi.
  throw new Error("bestBadugiScore: no badugi subset found");
}

export interface BadugiInfo {
  size: number;
  /** The badugi's cards, sorted ascending by ace-low rank. */
  subset: string[];
  score: number;
}

/** Best badugi of a 4- or 5-card hand, with the actual cards (display path). */
export function bestBadugi(cards: string[]): BadugiInfo {
  const n = cards.length;
  const ranks = cards.map((c) => ACE_LOW_RANK[c[0].toUpperCase()]);
  const suits = cards.map((c) => SUIT_CODE[c[1].toLowerCase()]);
  const groups = n === 4 ? MASK_GROUPS_4 : MASK_GROUPS_5;
  for (const masks of groups) {
    let best = Number.POSITIVE_INFINITY;
    let bestMask = 0;
    for (const mask of masks) {
      let rankBits = 0;
      let suitBits = 0;
      const d: number[] = [];
      let valid = true;
      for (let i = 0; i < n; i++) {
        if (!(mask & (1 << i))) continue;
        const rb = 1 << ranks[i];
        const sb = 1 << suits[i];
        if (rankBits & rb || suitBits & sb) { valid = false; break; }
        rankBits |= rb;
        suitBits |= sb;
        d.push(ranks[i]);
      }
      if (!valid) continue;
      d.sort((a, b) => b - a);
      while (d.length < 4) d.push(0);
      const k = popcount(mask);
      const score = ((4 - k) << 16) | (d[0] << 12) | (d[1] << 8) | (d[2] << 4) | d[3];
      if (score < best) { best = score; bestMask = mask; }
    }
    if (best < Number.POSITIVE_INFINITY) {
      const subset: string[] = [];
      for (let i = 0; i < n; i++) if (bestMask & (1 << i)) subset.push(cards[i]);
      subset.sort((a, b) => ACE_LOW_RANK[a[0].toUpperCase()] - ACE_LOW_RANK[b[0].toUpperCase()]);
      return { size: popcount(bestMask), subset, score: best };
    }
  }
  throw new Error("bestBadugi: no badugi subset found");
}

/**
 * Lowest-scoring valid badugi subset of each size, as bitmasks over the input
 * cards: out[k] is the mask for size k (1..4), or -1 when the hand has no
 * valid subset of that size. Used to pick draw candidates.
 *
 * Only the lowest subset of each size is worth keeping. Every size-k subset
 * has the same number of outs (13 - k in each suit still missing), so two
 * subsets of equal size differ only in the hand they make, and lower wins.
 */
const scratchPartial = [0, 0, 0, 0];
export function bestPartialMasks(
  aceLowRanks: ArrayLike<number>,
  suits: ArrayLike<number>,
  out: Int32Array
): void {
  const n = aceLowRanks.length;
  out.fill(-1);
  const best = [0, Infinity, Infinity, Infinity, Infinity];
  const d = scratchPartial;
  for (let mask = 1; mask < 1 << n; mask++) {
    let rankBits = 0;
    let suitBits = 0;
    let k = 0;
    let valid = true;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      if (k === 4) { valid = false; break; } // a badugi never uses 5 cards
      const rb = 1 << aceLowRanks[i];
      const sb = 1 << suits[i];
      if (rankBits & rb || suitBits & sb) { valid = false; break; }
      rankBits |= rb;
      suitBits |= sb;
      d[k++] = aceLowRanks[i];
    }
    if (!valid) continue;
    for (let a = 1; a < k; a++) {
      const v = d[a];
      let b = a - 1;
      while (b >= 0 && d[b] < v) { d[b + 1] = d[b]; b--; }
      d[b + 1] = v;
    }
    for (let i = k; i < 4; i++) d[i] = 0;
    const score = ((4 - k) << 16) | (d[0] << 12) | (d[1] << 8) | (d[2] << 4) | d[3];
    if (score < best[k]) {
      best[k] = score;
      out[k] = mask;
    }
  }
}

/** Ace-low rank characters of some cards, lowest first: "A-2-3". */
export function rankRun(cards: string[]): string {
  return cards
    .map((c) => ACE_LOW_RANK[c[0].toUpperCase()])
    .sort((a, b) => a - b)
    .map((r) => ACE_LOW_CHAR[r])
    .join("-");
}

/** E.g. "4-card Badugi 4-7-9-K (K-High)" or "3-card Badugi 9-J-Q (Q-High)". */
export function describeBadugi(cards: string[]): string {
  const { size, subset } = bestBadugi(cards);
  const names = subset.map((c) => ACE_LOW_CHAR[ACE_LOW_RANK[c[0].toUpperCase()]]);
  const high = names[names.length - 1];
  return `${size}-card Badugi ${names.join("-")} (${high}-High)`;
}
