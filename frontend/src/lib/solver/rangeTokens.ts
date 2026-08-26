// src/lib/solver/rangeTokens.ts
//
// PioSOLVER's range-string form, both directions.
//
// This is the app's storage format for a range as well as its clipboard format:
// the saved-range library persists exactly these tokens, so a range saved in the
// library, a range copied into PioViewer, and a range pasted back from it are
// all the same string. That is the reason to keep Pio's own shorthand rather
// than a naive "AA:1,AKs:1,..." dump - a round trip through PioViewer has to
// come back diff-clean.
//
// Lives in lib rather than beside the tree-config text it grew up in because
// both tree-building screens and the range picker need it, and a component
// must not reach into a page for it.

const RANKS = "AKQJT98765432";

/** 0.5 -> "0.5", 1 -> "1", 0.25 -> "0.25" (no trailing zeros). */
const formatWeight = (w: number): string => String(Math.round(w * 10000) / 10000);

const token = (hand: string, w: number): string =>
  w >= 1 ? hand : `${hand}:${formatWeight(w)}`;

/**
 * Weights (0..1 per 169-class key) -> Pio's range string.
 *
 * Emission order matches PioViewer's own: every pair from AA down to 22,
 * then the non-pairs by descending high card and then descending kicker.
 * Order is not semantically load-bearing for Pio, but matching it byte for
 * byte is what makes a copy/paste round trip diff-clean.
 */
export const serializeRangeTokens = (weights: Record<string, number>): string => {
  const out: string[] = [];
  const at = (hand: string) => {
    const w = weights[hand] ?? 0;
    return w > 0 ? Math.min(1, w) : 0;
  };

  for (const rank of RANKS) {
    const pair = rank + rank;
    const w = at(pair);
    if (w > 0) out.push(token(pair, w));
  }
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i + 1; j < RANKS.length; j++) {
      const base = RANKS[i] + RANKS[j];
      const ws = at(`${base}s`);
      const wo = at(`${base}o`);
      if (ws > 0 && ws === wo) {
        out.push(token(base, ws));
        continue;
      }
      if (ws > 0) out.push(token(`${base}s`, ws));
      if (wo > 0) out.push(token(`${base}o`, wo));
    }
  }
  return out.join(",");
};

const isRank = (c: string) => RANKS.includes(c);

/** Inverse of serializeRangeTokens. A rankless token like "T4" expands to
 *  both T4s and T4o; unrecognized tokens are skipped rather than throwing,
 *  so one stray entry cannot lose the whole pasted range. */
export const parseRangeTokens = (text: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const raw of text.split(/[,\s]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const [handRaw, weightRaw] = part.split(":");
    const hand = handRaw.trim();
    if (hand.length < 2) continue;
    const hi = hand[0].toUpperCase();
    const lo = hand[1].toUpperCase();
    if (!isRank(hi) || !isRank(lo)) continue;
    const w = weightRaw === undefined ? 1 : Number(weightRaw);
    if (!Number.isFinite(w) || w <= 0) continue;
    const weight = Math.min(1, w);

    if (hi === lo) {
      out[hi + lo] = weight;
      continue;
    }
    // Pio always writes the higher rank first; normalize in case a
    // hand-typed range does not.
    const [a, b] = RANKS.indexOf(hi) <= RANKS.indexOf(lo) ? [hi, lo] : [lo, hi];
    const suffix = hand[2]?.toLowerCase();
    if (suffix === "s") out[`${a}${b}s`] = weight;
    else if (suffix === "o") out[`${a}${b}o`] = weight;
    else {
      out[`${a}${b}s`] = weight;
      out[`${a}${b}o`] = weight;
    }
  }
  return out;
};

/** Every 169-class key at full weight - the "100%" starting range. */
export const fullRangeWeights = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (let i = 0; i < RANKS.length; i++) {
    out[RANKS[i] + RANKS[i]] = 1;
    for (let j = i + 1; j < RANKS.length; j++) {
      out[`${RANKS[i]}${RANKS[j]}s`] = 1;
      out[`${RANKS[i]}${RANKS[j]}o`] = 1;
    }
  }
  return out;
};

/** Packaged for the saved-range library, which takes its codec as a prop so
 *  src/components never has to import a page module. */
export const pioRangeCodec = {
  serialize: serializeRangeTokens,
  parse: parseRangeTokens,
};

/**
 * Parse a range a HUMAN typed, which may mix two dialects:
 *
 *   - Pio's stored form, including rankless tokens: "AA,KK:0.5,AK:0.25,T4"
 *   - chart shorthand with runs:                    "TT+,ATs+,A5s-A2s,KQo"
 *
 * They cannot be told apart by trying one and falling back, because
 * parseRangeTokens is deliberately forgiving: it reads "TT+" as the single
 * class TT rather than failing, so a fallback would never fire and every run
 * would silently collapse to its first hand. So the dialect is chosen per
 * token, on the only thing that actually distinguishes them - a run operator.
 *
 * Unrecognised tokens are skipped rather than throwing, so one stray entry
 * cannot lose the whole pasted range.
 */
export const parseRangeInput = (
  text: string,
  expandRun: (spec: string) => Record<string, number>
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const raw of text.split(/[,\n]/)) {
    const tok = raw.trim();
    if (!tok) continue;
    // "+" or "-" means a run. Neither character can appear in a hand class or
    // in a ":weight" suffix, so their presence is unambiguous - and the dash
    // may follow a suit rather than a rank ("A5s-A2s"), so it is the character
    // itself that decides, not what precedes it.
    const isRun = tok.includes("+") || tok.includes("-");
    Object.assign(out, isRun ? expandRun(tok) : parseRangeTokens(tok));
  }
  return out;
};
