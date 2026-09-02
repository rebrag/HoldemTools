// src/lib/sessionSim/cards.ts
//
// Integer cards for the dealer: id = aceHighRankIdx * 4 + suitIdx, the same
// encoding src/workers/privateRankingsWorker.ts uses, so a card is one
// byte, a deck is a Uint8Array, and phe's evaluator gets its own codes from
// a table lookup instead of parsing strings.

/** Rank characters in id order: id >> 2 indexes this (A = 0 ... 2 = 12). */
export const RANKS_DESC = "AKQJT98765432";
/** Suit characters in id order: id & 3 indexes this. */
export const SUITS = "hdcs";

/** phe's suit order is s=0 h=1 d=2 c=3; ours is h d c s. */
const PHE_SUIT = [1, 2, 3, 0];

/** Card id -> phe card code (rank 2=0 .. A=12, times 4, plus phe suit). */
export const ID_TO_PHE = new Int32Array(52);
for (let r = 0; r < 13; r++) {
  for (let s = 0; s < 4; s++) {
    ID_TO_PHE[r * 4 + s] = (12 - r) * 4 + PHE_SUIT[s];
  }
}

/** The engine's 169-class grid index for a pair of card ids, in either
 *  order: rows and columns run A..2, pairs sit on the diagonal (i*13+i),
 *  suited hands above it (hiRow*13 + loCol), offsuit below (lo*13 + hi).
 *  CLASS_NAMES in src/pages/multiway/pushfoldResult.ts follows the same
 *  index, and so do rollup_169 and team_rollup in a result payload. */
export const CLASS_OF = new Uint8Array(52 * 52);
for (let a = 0; a < 52; a++) {
  for (let b = 0; b < 52; b++) {
    if (a === b) continue;
    const ra = a >> 2;
    const rb = b >> 2;
    let cls: number;
    if (ra === rb) {
      cls = ra * 13 + ra;
    } else {
      // Smaller index = higher rank (A is 0).
      const hi = Math.min(ra, rb);
      const lo = Math.max(ra, rb);
      const suited = (a & 3) === (b & 3);
      cls = suited ? hi * 13 + lo : lo * 13 + hi;
    }
    CLASS_OF[a * 52 + b] = cls;
  }
}

/** "AKs" / "T9o" / "QQ" -> grid index, the engine's naming convention. */
export function classIndexOfName(name: string): number {
  const i = RANKS_DESC.indexOf(name[0]);
  const j = RANKS_DESC.indexOf(name[1]);
  if (i < 0 || j < 0) return -1;
  if (name.length === 2) return i === j ? i * 13 + i : -1;
  const hi = Math.min(i, j);
  const lo = Math.max(i, j);
  if (name[2] === "s") return hi * 13 + lo;
  if (name[2] === "o") return lo * 13 + hi;
  return -1;
}

export function idToString(id: number): string {
  return RANKS_DESC[id >> 2] + SUITS[id & 3];
}

/** Seeded LCG, the one every worker in this app uses; an instance per
 *  consumer rather than module state, so two callers on one thread cannot
 *  interleave their streams. Returns [0, 1). */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return (state >>> 8) / 0x01000000;
  };
}

/** A well-mixed 32-bit seed for (run seed, entry, chunk), so a rotation's
 *  results do not depend on how many workers happened to be available. */
export function chunkSeed(seed: number, entry: number, chunk: number): number {
  let h = (seed ^ Math.imul(entry + 1, 0x9e3779b1) ^ Math.imul(chunk + 1, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
