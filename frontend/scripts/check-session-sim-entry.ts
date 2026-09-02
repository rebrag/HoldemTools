// scripts/check-session-sim-entry.ts
//
// The checks behind `npm run check:sessionsim`. Node-only (bundled by
// check-session-sim.mjs); never imported by the app.
import assert from "node:assert/strict";
import { CLASS_OF, RANKS_DESC, SUITS, classIndexOfName } from "@/lib/sessionSim/cards";
import { compilePolicy, spotSignature, validateRotation } from "@/lib/sessionSim/compilePolicy";
import { simulateHands } from "@/lib/sessionSim/simulateHands";
import { analyzeSessions } from "@/lib/sessionSim/analyzeSessions";
import type { PoolMeta, PoolStats } from "@/lib/sessionSim/types";
import { CLASS_NAMES, type DumpNode, type PushFoldDump } from "@/pages/multiway/pushfoldResult";

/** A two-seat jam/fold tree, blinds 1/2, stacks 20: seat 0 (SB) acts first,
 *  seat 1 (BB) answers a jam. Policies are per-class P(fold) rows. */
function syntheticDump(pFoldSeat0: number, pFoldSeat1: number): PushFoldDump {
  const rollup = (pFold: number) =>
    CLASS_NAMES.map((cls) => ({ class: cls, weight: 1, ev: 0, freq: [pFold, 1 - pFold] }));
  const nodes: Record<string, DumpNode> = {
    "0": { node_id: 0, parent_id: null, kind: "decision", action_kind: "root", action_amount: 0, pot: 3, actor: 0, num_children: 2, first_child: 1, commit: [1, 2], data: { num_actions: 2, rollup_169: rollup(pFoldSeat0) } },
    "1": { node_id: 1, parent_id: 0, kind: "terminal", action_kind: "fold", action_amount: 0, pot: 3, actor: null, num_children: 0, first_child: null, commit: [1, 2], terminal: "fold", fold_winner: 1 },
    "2": { node_id: 2, parent_id: 0, kind: "decision", action_kind: "bet", action_amount: 20, pot: 22, actor: 1, num_children: 2, first_child: 3, commit: [20, 2], data: { num_actions: 2, rollup_169: rollup(pFoldSeat1) } },
    "3": { node_id: 3, parent_id: 2, kind: "terminal", action_kind: "fold", action_amount: 0, pot: 22, actor: null, num_children: 0, first_child: null, commit: [20, 2], terminal: "fold", fold_winner: 0 },
    "4": { node_id: 4, parent_id: 2, kind: "terminal", action_kind: "check_call", action_amount: 20, pot: 40, actor: null, num_children: 0, first_child: null, commit: [20, 20], terminal: "showdown" },
  };
  return {
    metadata: {
      seats: ["SB", "BB"],
      stacks: [20, 20],
      ev_chips: [0, 0],
      final_nashconv: null,
      iterations: 1,
      pot: 3,
      chip_scale: 2,
      multiway_no_nash_guarantee: false,
      solve_id: "synthetic",
      preflop: { button: 0, sb_seat: 0, bb_seat: 1, small_blind: 1, big_blind: 2, action_order: [0, 1] },
    },
    nodes,
  };
}

const stats = (r: Float32Array) => {
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < r.length; i++) {
    sum += r[i];
    sq += r[i] * r[i];
  }
  const mean = sum / r.length;
  return { mean, sd: Math.sqrt(Math.max(0, sq / r.length - mean * mean)) };
};

export async function main(): Promise<number> {
  const started = Date.now();
  let checks = 0;
  const ok = (what: string) => {
    checks++;
    console.log(`  ok  ${what}`);
  };

  // 1. The class table agrees with the page's names for every pair of cards.
  for (let a = 0; a < 52; a++) {
    for (let b = 0; b < 52; b++) {
      if (a === b) continue;
      const ra = RANKS_DESC[a >> 2];
      const rb = RANKS_DESC[b >> 2];
      const ia = a >> 2;
      const ib = b >> 2;
      let expected: string;
      if (ia === ib) expected = ra + rb;
      else {
        const [hi, lo] = ia < ib ? [ra, rb] : [rb, ra];
        expected = hi + lo + (SUITS[a & 3] === SUITS[b & 3] ? "s" : "o");
      }
      assert.equal(CLASS_NAMES[CLASS_OF[a * 52 + b]], expected, `class of ${a},${b}`);
    }
  }
  CLASS_NAMES.forEach((name, i) => assert.equal(classIndexOfName(name), i, name));
  ok("CLASS_OF matches CLASS_NAMES for all 1326 combos, both orders");

  // 2. Exact payoffs on the synthetic tree, scored for seat 0.
  const foldAlways = compilePolicy(syntheticDump(1, 1), { scoredSeats: [0] });
  const a = simulateHands(foldAlways, 5000, 1);
  assert.ok(Array.from(a.results).every((v) => v === -1), "always fold loses the small blind");
  assert.equal(a.showdowns, 0);
  ok("always fold: every hand is exactly -1");

  const jamVsFold = compilePolicy(syntheticDump(0, 1), { scoredSeats: [0] });
  const b = simulateHands(jamVsFold, 5000, 2);
  assert.ok(Array.from(b.results).every((v) => v === 2), "jam into a fold wins the blinds");
  ok("jam vs fold: every hand is exactly +2");

  const jamVsCall = compilePolicy(syntheticDump(0, 0), { scoredSeats: [0] });
  const c = simulateHands(jamVsCall, 200_000, 3);
  assert.equal(c.showdowns, 200_000);
  assert.ok(Array.from(c.results).every((v) => v === -20 || v === 0 || v === 20), "showdown is +-20 or a chop");
  const { mean, sd } = stats(c.results);
  assert.ok(Math.abs(mean) < (3 * sd) / Math.sqrt(c.results.length), `symmetric showdown mean ${mean}`);
  assert.ok(sd > 18 && sd < 20, `showdown sd ${sd}`);
  ok(`jam vs call: zero-sum showdown, mean ${mean.toFixed(3)}, sd ${sd.toFixed(2)}`);

  // Same seed, same deals.
  const d1 = simulateHands(jamVsCall, 20_000, 7);
  const d2 = simulateHands(jamVsCall, 20_000, 7);
  assert.deepEqual(Array.from(d1.results), Array.from(d2.results));
  assert.equal(d1.sum, d2.sum);
  ok("same seed gives identical results");

  // Compile refuses what it cannot play, and the signature tells spots apart.
  assert.throws(() => compilePolicy(syntheticDump(0, 0)), /team/);
  assert.equal(spotSignature(syntheticDump(0, 0)), spotSignature(syntheticDump(1, 1)));
  const other = syntheticDump(0, 0);
  other.metadata.stacks = [30, 30];
  assert.notEqual(spotSignature(other), spotSignature(syntheticDump(0, 0)));
  const noTeam = validateRotation([{ label: "A", policy: jamVsCall, signature: spotSignature(other) }]);
  assert.ok(noTeam.some((s) => s.includes("not a hand-sharing team")), noTeam.join("; "));
  // As if both were team solves: only the spot differs.
  const asTeam = { ...jamVsCall, teamSeats: [0, 1] as [number, number] };
  const issues = validateRotation([
    { label: "A", policy: asTeam, signature: spotSignature(syntheticDump(0, 0)) },
    { label: "B", policy: asTeam, signature: spotSignature(other) },
  ]);
  assert.ok(issues.some((s) => s.includes("different spot")), issues.join("; "));
  assert.deepEqual(validateRotation([{ label: "A", policy: asTeam, signature: "x" }, { label: "B", policy: asTeam, signature: "x" }]), []);
  ok("no-team payloads are refused; a spot mismatch is reported; a matching rotation passes");

  // 3. The session bootstrap on pools whose answer is known.
  const meta: PoolMeta = { solveId: "x", iterations: 1, pairingLabel: "A+B", artifactEvChips: 0 };
  const st = (mean: number, variance: number): PoolStats => ({ hands: 1000, mean, variance, showdowns: 0 });
  const params = { handsPerSession: 1000, sessions: 50, bankrolls: [50], ddThresholds: [1, 50, 1000], checkpoints: 100 };

  const up = analyzeSessions([Float32Array.of(1)], [st(1, 0)], [meta], 1, params, 1);
  assert.ok(up.fan.hands.every((h, i) => up.fan.p50[i] === h && up.fan.p5[i] === h), "constant +1 is a straight line");
  assert.equal(up.drawdown.at(-1)!.percentiles[3].value, 0);
  assert.equal(up.bankrolls[0].bustP, 0);
  assert.equal(up.bbPer100, 100);
  ok("constant +1 pool: straight median, no drawdown, no bust, 100 bb/100");

  const down = analyzeSessions([Float32Array.of(-1)], [st(-1, 0)], [meta], 1, params, 1);
  assert.equal(down.bankrolls[0].bustP, 1);
  assert.equal(down.drawdown.at(-1)!.percentiles[0].value, 1000);
  assert.equal(down.bankrolls[0].ruinLongRun, 1);
  assert.equal(down.finalResult.pLoss, 1);
  ok("constant -1 pool: every session busts 50 bb, drawdown is the whole session");

  const alt = analyzeSessions([Float32Array.of(1), Float32Array.of(-1)], [st(1, 0), st(-1, 0)], [meta, meta], 1, params, 1);
  assert.equal(alt.drawdown.at(-1)!.percentiles[3].value, 1);
  assert.equal(alt.finalResult.mean, 0);
  assert.equal(alt.bbPer100, 0);
  ok("alternating +1/-1: max drawdown exactly 1, result 0");

  // Random pools: percentiles are ordered at every checkpoint and the
  // reported win rate is the pools' own.
  const pool = c.results;
  const cs = stats(pool);
  const rnd = analyzeSessions(
    [pool, pool],
    [st(cs.mean, cs.sd * cs.sd), st(cs.mean, cs.sd * cs.sd)],
    [meta, meta],
    2,
    { ...params, sessions: 200, handsPerSession: 500 },
    5
  );
  rnd.fan.hands.forEach((_, i) => {
    assert.ok(rnd.fan.p5[i] <= rnd.fan.p25[i] && rnd.fan.p25[i] <= rnd.fan.p50[i]);
    assert.ok(rnd.fan.p50[i] <= rnd.fan.p75[i] && rnd.fan.p75[i] <= rnd.fan.p95[i]);
  });
  assert.ok(Math.abs(rnd.bbPer100 - (100 * cs.mean) / 2) < 1e-9);
  assert.ok(rnd.drawdown.length >= 2 && rnd.drawdown.at(-1)!.hands === 500);
  ok("random pools: percentiles ordered at every checkpoint, win rate reproduced");

  console.log(`${checks} checks passed in ${Date.now() - started} ms`);
  return 0;
}
