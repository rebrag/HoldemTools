// src/lib/sessionSim/analyzeSessions.ts
//
// From pools of independent per-hand results, one per solve in the
// rotation, to what a player wants to know: the shape of a session, how deep
// the downswings get, how often a bankroll dies. Sessions are bootstrapped -
// hand k of every session draws from pool k mod n - so the rotation is a
// team changing seats every hand and each hand is an independent deal,
// which is exactly what the solved game is.
//
// Memory: a 2,000 x 10,000 session matrix is 20M floats, so paths are never
// kept. Each session is walked once and sampled at `checkpoints` hands into
// three small matrices (cumulative result, running biggest downswing,
// running minimum), plus one scalar per session for the exact end-of-session
// numbers.
import { wilsonHalf } from "@/lib/stats";
import { makeRng } from "./cards";
import type { AnalyzeParams, Percentile, PoolMeta, PoolStats, SessionAnalysis } from "./types";

export const DEFAULT_DD_THRESHOLDS = [25, 50, 100, 200, 300, 500, 750, 1000];
export const DEFAULT_CHECKPOINTS = 250;
export const MAX_SESSIONS = 10_000;

/** Brownian-motion risk of ruin for drift `mu` and volatility `sigma` per
 *  hand with bankroll `x` (all in the same unit). An approximation - the
 *  hand results are not normal - but the standard yardstick. */
export function riskOfRuin(mu: number, sigma: number, x: number): number {
  if (!(sigma > 0)) return mu >= 0 ? 0 : 1;
  if (mu <= 0) return 1;
  return Math.exp((-2 * mu * x) / (sigma * sigma));
}

/** Linear-interpolated percentile of a SORTED array. */
function percentileSorted(sorted: Float32Array | Float64Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (p / 100) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/** Share of a SORTED array at or above `x`. */
function fractionAtLeast(sorted: Float32Array | Float64Array, x: number): number {
  // First index with value >= x.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return (sorted.length - lo) / sorted.length;
}

function drawdownSummary(
  hands: number,
  maxDd: Float32Array,
  thresholds: number[],
  xGrid: number[]
): SessionAnalysis["drawdown"][number] {
  const sorted = Float32Array.from(maxDd).sort();
  return {
    hands,
    x: xGrid,
    p: xGrid.map((x) => fractionAtLeast(sorted, x)),
    atLeast: thresholds.map((threshold) => ({ threshold, p: fractionAtLeast(sorted, threshold) })),
    percentiles: [50, 90, 95, 99].map((p) => ({ p, value: percentileSorted(sorted, p) })),
  };
}

export function analyzeSessions(
  pools: Float32Array[],
  poolStats: PoolStats[],
  poolMeta: PoolMeta[],
  chipScale: number,
  params: AnalyzeParams,
  seed: number,
  onProgress?: (sessionsDone: number) => void
): SessionAnalysis {
  const n = pools.length;
  if (n === 0) throw new Error("No pools to analyze.");
  const H = Math.max(1, Math.floor(params.handsPerSession));
  const S = Math.max(1, Math.min(MAX_SESSIONS, Math.floor(params.sessions)));
  const bb = 1 / chipScale;

  // Pools in bb, once.
  const poolsBb = pools.map((p) => {
    const out = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) out[i] = p[i] * bb;
    return out;
  });

  // Rotation weights: how many of the H hands each pool plays.
  const counts = pools.map((_, k) => Math.floor(H / n) + (k < H % n ? 1 : 0));
  const weights = counts.map((c) => c / H);
  const meanBb = poolStats.map((st) => st.mean * bb);
  const varBb = poolStats.map((st) => st.variance * bb * bb);
  const mu = weights.reduce((acc, w, k) => acc + w * meanBb[k], 0);
  const second = weights.reduce((acc, w, k) => acc + w * (varBb[k] + meanBb[k] * meanBb[k]), 0);
  const sigma = Math.sqrt(Math.max(0, second - mu * mu));
  const se = Math.sqrt(weights.reduce((acc, w, k) => acc + (w * w * varBb[k]) / poolStats[k].hands, 0));
  const totalHands = poolStats.reduce((acc, st) => acc + st.hands, 0);
  const totalShowdowns = poolStats.reduce((acc, st) => acc + st.showdowns, 0);

  // Checkpoints: the hands at which every session is sampled.
  const C = Math.max(1, Math.min(params.checkpoints, H));
  const cp = new Int32Array(C);
  for (let c = 0; c < C; c++) cp[c] = Math.round((H * (c + 1)) / C);
  cp[C - 1] = H;

  const cumAt = new Float32Array(C * S);
  const ddAt = new Float32Array(C * S);
  const minAt = new Float32Array(C * S);
  const finalCum = new Float64Array(S);
  const sessionDd = new Float32Array(S);
  const sessionMin = new Float32Array(S);

  const rand = makeRng(seed);
  const lens = poolsBb.map((p) => p.length);
  for (let s = 0; s < S; s++) {
    let cum = 0;
    let peak = 0;
    let maxDd = 0;
    let minCum = 0;
    let c = 0;
    let next = cp[0];
    for (let i = 0; i < H; i++) {
      const k = i % n;
      cum += poolsBb[k][Math.floor(rand() * lens[k])];
      if (cum > peak) peak = cum;
      const dd = peak - cum;
      if (dd > maxDd) maxDd = dd;
      if (cum < minCum) minCum = cum;
      if (i + 1 === next) {
        cumAt[c * S + s] = cum;
        ddAt[c * S + s] = maxDd;
        minAt[c * S + s] = minCum;
        c++;
        next = c < C ? cp[c] : -1;
      }
    }
    finalCum[s] = cum;
    sessionDd[s] = maxDd;
    sessionMin[s] = minCum;
    if (onProgress && (s + 1) % 100 === 0) onProgress(s + 1);
  }

  // Fan: percentiles of the cumulative result at every checkpoint.
  const fan = {
    hands: Array.from(cp),
    p5: new Array<number>(C),
    p25: new Array<number>(C),
    p50: new Array<number>(C),
    p75: new Array<number>(C),
    p95: new Array<number>(C),
    expected: Array.from(cp, (h) => mu * h),
    sample: new Array<number>(C),
  };
  for (let c = 0; c < C; c++) {
    const row = cumAt.slice(c * S, (c + 1) * S).sort();
    fan.p5[c] = percentileSorted(row, 5);
    fan.p25[c] = percentileSorted(row, 25);
    fan.p50[c] = percentileSorted(row, 50);
    fan.p75[c] = percentileSorted(row, 75);
    fan.p95[c] = percentileSorted(row, 95);
    fan.sample[c] = cumAt[c * S];
  }

  // Drawdown survival for the full session and two shorter prefixes.
  const thresholds = params.ddThresholds.length ? params.ddThresholds : DEFAULT_DD_THRESHOLDS;
  const fullSorted = Float32Array.from(sessionDd).sort();
  const xMax = Math.max(
    thresholds[thresholds.length - 1],
    Math.ceil(percentileSorted(fullSorted, 99) * 1.1)
  );
  const X_POINTS = 80;
  const xGrid = Array.from({ length: X_POINTS + 1 }, (_, i) => Math.round((xMax * i) / X_POINTS));
  const lengths: { hands: number; c: number | null }[] = [];
  for (const target of [Math.round(H / 10), Math.round(H / 3)]) {
    if (target < 1 || target >= H) continue;
    let bestC = 0;
    for (let c = 0; c < C; c++) if (Math.abs(cp[c] - target) < Math.abs(cp[bestC] - target)) bestC = c;
    if (cp[bestC] < H && !lengths.some((l) => l.hands === cp[bestC])) {
      lengths.push({ hands: cp[bestC], c: bestC });
    }
  }
  lengths.push({ hands: H, c: null });
  const drawdown = lengths.map(({ hands, c }) =>
    drawdownSummary(hands, c === null ? sessionDd : ddAt.slice(c * S, (c + 1) * S), thresholds, xGrid)
  );

  const bankrolls = params.bankrolls.map((bankroll) => {
    let busts = 0;
    for (let s = 0; s < S; s++) if (sessionMin[s] <= -bankroll) busts++;
    const bustP = busts / S;
    return {
      bankroll,
      bustP,
      bustHalf: wilsonHalf(bustP, S, 1.96),
      ruinLongRun: riskOfRuin(mu, sigma, bankroll),
    };
  });

  const finalSorted = Float64Array.from(finalCum).sort();
  let finalMean = 0;
  for (let s = 0; s < S; s++) finalMean += finalCum[s];
  finalMean /= S;
  let finalVar = 0;
  for (let s = 0; s < S; s++) finalVar += (finalCum[s] - finalMean) ** 2;
  finalVar /= Math.max(1, S - 1);
  const finalPercentiles: Percentile[] = [5, 25, 50, 75, 95].map((p) => ({
    p,
    value: percentileSorted(finalSorted, p),
  }));
  let losses = 0;
  for (let s = 0; s < S; s++) if (finalCum[s] < 0) losses++;

  return {
    handsPerSession: H,
    sessions: S,
    entries: n,
    bbPer100: 100 * mu,
    bbPer100Se: 100 * se,
    sdPerHandBb: sigma,
    showdownPct: totalHands > 0 ? (100 * totalShowdowns) / totalHands : 0,
    perEntry: poolMeta.map((m, k) => ({
      solveId: m.solveId,
      iterations: m.iterations,
      pairingLabel: m.pairingLabel,
      hands: poolStats[k].hands,
      weight: weights[k],
      bbPer100: 100 * meanBb[k],
      bbPer100Se: 100 * Math.sqrt(varBb[k] / poolStats[k].hands),
      artifactBbPer100: 100 * m.artifactEvChips * bb,
    })),
    fan,
    drawdown,
    bankrolls,
    finalResult: {
      percentiles: finalPercentiles,
      mean: finalMean,
      sd: Math.sqrt(finalVar),
      pLoss: losses / S,
    },
  };
}
