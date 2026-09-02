// src/lib/sessionSim/simulateHands.ts
//
// Plays a compiled push/fold policy hand by hand: deal, walk the tree
// sampling every seat's action from the solve's own strategy, pay the pot.
// Pure and synchronous - the worker is a thin shell over it and the check
// script calls it directly.
import { evaluateCardCodes } from "phe";
import { CLASS_OF, ID_TO_PHE, makeRng } from "./cards";
import type { CompiledPolicy, SimulatedPool } from "./types";

const CLASSES = 169;

/**
 * `hands` deals for `policy`, returning each hand's summed net chips for
 * the scored seats. `onProgress` fires every `reportEvery` hands.
 */
export function simulateHands(
  policy: CompiledPolicy,
  hands: number,
  seed: number,
  onProgress?: (done: number) => void,
  reportEvery = 50_000
): SimulatedPool {
  const {
    seats,
    rootId,
    kind,
    actor,
    firstChild,
    foldWinner,
    pot,
    commit,
    policyKind,
    policyOffset,
    partner,
    table,
    scoredSeats,
  } = policy;
  const rand = makeRng(seed);
  const deck = new Uint8Array(52);
  for (let i = 0; i < 52; i++) deck[i] = i;
  const dealt = 2 * seats + 5;
  const cls = new Int32Array(seats);
  const net = new Float64Array(seats);
  const score = new Float64Array(seats);
  const codes: number[] = new Array(7).fill(0);
  const results = new Float32Array(hands);
  let sum = 0;
  let sumSq = 0;
  let showdowns = 0;

  for (let h = 0; h < hands; h++) {
    // Partial Fisher-Yates: only the cards this hand uses are shuffled.
    for (let i = 0; i < dealt; i++) {
      const j = i + Math.floor(rand() * (52 - i));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    for (let s = 0; s < seats; s++) cls[s] = CLASS_OF[deck[2 * s] * 52 + deck[2 * s + 1]];

    // Walk. A seat that jams is "alive" for the showdown; a forced single
    // child is the all-in child too (jam/fold has no forced fold).
    let nid = rootId;
    let alive = 0;
    while (kind[nid] === 0) {
      const a = actor[nid];
      const pk = policyKind[nid];
      if (pk === 2) {
        nid = firstChild[nid];
        alive |= 1 << a;
        continue;
      }
      const off = policyOffset[nid];
      const pFold =
        pk === 1 ? table[off + cls[partner[nid]] * CLASSES + cls[a]] : table[off + cls[a]];
      if (rand() < pFold) {
        nid = firstChild[nid];
      } else {
        nid = firstChild[nid] + 1;
        alive |= 1 << a;
      }
    }

    const base = nid * seats;
    const potHere = pot[nid];
    if (kind[nid] === 1) {
      const w = foldWinner[nid];
      for (let s = 0; s < seats; s++) net[s] = (s === w ? potHere : 0) - commit[base + s];
    } else {
      showdowns++;
      let sumCommit = 0;
      for (let s = 0; s < seats; s++) {
        net[s] = -commit[base + s];
        sumCommit += commit[base + s];
        if (alive & (1 << s)) {
          codes[0] = ID_TO_PHE[deck[2 * seats]];
          codes[1] = ID_TO_PHE[deck[2 * seats + 1]];
          codes[2] = ID_TO_PHE[deck[2 * seats + 2]];
          codes[3] = ID_TO_PHE[deck[2 * seats + 3]];
          codes[4] = ID_TO_PHE[deck[2 * seats + 4]];
          codes[5] = ID_TO_PHE[deck[2 * s]];
          codes[6] = ID_TO_PHE[deck[2 * s + 1]];
          score[s] = evaluateCardCodes(codes);
        }
      }
      // Layered pots: each distinct commitment level among the live seats
      // is a layer only seats committed to that level can win. Equal stacks
      // make one layer; unequal ones stay correct. Dead money (blinds of
      // folded seats, antes) sits in the first layer.
      let prevLevel = 0;
      let first = true;
      for (;;) {
        let level = Infinity;
        for (let s = 0; s < seats; s++) {
          if (alive & (1 << s)) {
            const c = commit[base + s];
            if (c > prevLevel && c < level) level = c;
          }
        }
        if (level === Infinity) break;
        let amount = 0;
        for (let s = 0; s < seats; s++) {
          const c = commit[base + s];
          amount += Math.min(c, level) - Math.min(c, prevLevel);
        }
        if (first) {
          amount += potHere - sumCommit;
          first = false;
        }
        let best = Infinity;
        let winners = 0;
        for (let s = 0; s < seats; s++) {
          if ((alive & (1 << s)) && commit[base + s] >= level) {
            if (score[s] < best) {
              best = score[s];
              winners = 1;
            } else if (score[s] === best) {
              winners++;
            }
          }
        }
        const share = amount / winners;
        for (let s = 0; s < seats; s++) {
          if ((alive & (1 << s)) && commit[base + s] >= level && score[s] === best) net[s] += share;
        }
        prevLevel = level;
      }
    }

    let team = 0;
    for (const s of scoredSeats) team += net[s];
    results[h] = team;
    sum += team;
    sumSq += team * team;
    if (onProgress && (h + 1) % reportEvery === 0) onProgress(h + 1);
  }
  return { results, sum, sumSq, showdowns };
}
