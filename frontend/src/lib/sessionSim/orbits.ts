// src/lib/sessionSim/orbits.ts
//
// The exact joint strategy of a hand-sharing team, as the artifact exports
// it in `metadata.team_joint`: one row per suit orbit of the ORDERED (own
// hand, partner hand) pair - the solver's actual infoset - with the rows
// keyed by real cards. Two hands' worth of cards fall into the same orbit
// exactly when a relabelling of the four suits turns one pair into the
// other, which is what makes AcJc+9c3c the same row as AsJs+9s3s and a
// different row from AcJc+9s3s: the partner blocking your suits or not is
// the whole reason this table exists beside the 169x169 class rollup.
//
// The artifact ships one representative pair per orbit; this module
// canonicalizes both those and any pair a caller asks about under the 24
// suit permutations, so the two sides only have to agree on arithmetic
// that is not a convention. React-free and worker-safe: the simulator's
// dealer looks rows up with the sorted key table below, which posts to a
// worker as plain typed arrays.
import type { DumpNode } from "@/pages/multiway/pushfoldResult";
import { RANKS_DESC, SUITS } from "./cards";

/* ---------- card codes ---------- */

/** "Ah" / "Td" -> card id (rank * 4 + suit in this module's order); -1 if
 *  the code is not a card. */
export function idOfCode(code: string): number {
  const r = RANKS_DESC.indexOf(code[0]);
  const s = SUITS.indexOf(code[1]);
  return r < 0 || s < 0 || code.length !== 2 ? -1 : r * 4 + s;
}

/** The artifact's card code (rank 0..12 = 2..A, suit 0..3 = c,d,h,s) as
 *  this module's id (rank 0 = A, suits h,d,c,s). */
const ENGINE_SUIT_TO_ID = [2, 1, 0, 3];
export function idOfEngineCard(code: number): number {
  return (12 - (code >> 2)) * 4 + ENGINE_SUIT_TO_ID[code & 3];
}

/* ---------- the orbit key ---------- */

const PERMS: number[][] = (() => {
  const out: number[][] = [];
  const gen = (a: number[], l: number) => {
    if (l === 4) {
      out.push([...a]);
      return;
    }
    for (let i = l; i < 4; i += 1) {
      [a[l], a[i]] = [a[i], a[l]];
      gen(a, l + 1);
      [a[l], a[i]] = [a[i], a[l]];
    }
  };
  gen([0, 1, 2, 3], 0);
  return out;
})();

/** The orbit of the ordered pair (own o1 o2, partner p1 p2), as the
 *  smallest encoding of the four cards over every suit relabelling. Two
 *  pairs share an orbit exactly when their keys are equal. Requires four
 *  distinct cards; the result for overlapping cards is meaningless. */
export function orbitKey(o1: number, o2: number, p1: number, p2: number): number {
  let best = Infinity;
  const r1 = (o1 >> 2) * 4;
  const r2 = (o2 >> 2) * 4;
  const r3 = (p1 >> 2) * 4;
  const r4 = (p2 >> 2) * 4;
  const s1 = o1 & 3;
  const s2 = o2 & 3;
  const s3 = p1 & 3;
  const s4 = p2 & 3;
  for (let k = 0; k < 24; k += 1) {
    const perm = PERMS[k];
    const a = r1 + perm[s1];
    const b = r2 + perm[s2];
    const c = r3 + perm[s3];
    const d = r4 + perm[s4];
    const x = a < b ? a : b;
    const y = a < b ? b : a;
    const z = c < d ? c : d;
    const w = c < d ? d : c;
    const key = ((x * 52 + y) * 52 + z) * 52 + w;
    if (key < best) best = key;
  }
  return best;
}

/* ---------- base64 ---------- */

const B64 = new Int16Array(128).fill(-1);
"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  .split("")
  .forEach((ch, i) => {
    B64[ch.charCodeAt(0)] = i;
  });

/** Standard padded base64 to bytes. Portable: no atob or Buffer. */
export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const v = B64[clean.charCodeAt(i) & 127];
    if (v < 0) throw new Error("team_joint: not base64");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, at);
}

const u16 = (bytes: Uint8Array): Uint16Array => {
  const out = new Uint16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = bytes[2 * i] | (bytes[2 * i + 1] << 8);
  return out;
};
const i16 = (bytes: Uint8Array): Int16Array => {
  const out = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i += 1) {
    const v = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    out[i] = v >= 0x8000 ? v - 0x10000 : v;
  }
  return out;
};

/* ---------- the decoded table ---------- */

/** No data: the row never accumulated reach. */
export const EV_NONE = -32768;

export interface JointNode {
  actor: number;
  partner: number;
  numActions: number;
  /** [orbit * (numActions - 1) + action] / 65535: the first actions. */
  freq: Uint16Array;
  /** [orbit] / 65535: reach mass relative to the node's largest row. */
  weight: Uint16Array;
  weightMax: number;
  /** [orbit * numActions + action] * evScale in TEAM chips; EV_NONE = none. */
  ev: Int16Array | null;
  evScale: number;
}

export interface TeamJoint {
  orbitCount: number;
  /** Four ids per orbit: own hi, own lo, partner hi, partner lo. */
  reps: Uint8Array;
  /** Orbit keys ascending, and the orbit id at each position. */
  keys: Int32Array;
  ids: Int32Array;
  nodes: Record<string, JointNode>;
}

export interface TeamJointRaw {
  orbit_count: number;
  orbits: string;
  nodes: Record<
    string,
    {
      actor: number;
      partner: number;
      num_actions: number;
      freq: string;
      weight: string;
      weight_max: number;
      ev?: string;
      ev_scale?: number;
    }
  >;
}

/** Decode the artifact's block once per payload. Null when it is absent or
 *  does not describe itself the way this reader expects. */
export function decodeTeamJoint(raw: TeamJointRaw | null | undefined): TeamJoint | null {
  if (!raw || !(raw.orbit_count > 0) || typeof raw.orbits !== "string") return null;
  const J = raw.orbit_count;
  const engineReps = decodeBase64(raw.orbits);
  if (engineReps.length !== J * 4) return null;
  const reps = new Uint8Array(J * 4);
  for (let i = 0; i < reps.length; i += 1) reps[i] = idOfEngineCard(engineReps[i]);
  // Sort orbits by key so the dealer can binary-search them.
  const keyOf = new Int32Array(J);
  for (let jc = 0; jc < J; jc += 1) {
    keyOf[jc] = orbitKey(reps[4 * jc], reps[4 * jc + 1], reps[4 * jc + 2], reps[4 * jc + 3]);
  }
  const order = new Int32Array(J);
  for (let jc = 0; jc < J; jc += 1) order[jc] = jc;
  order.sort((a, b) => keyOf[a] - keyOf[b]);
  const keys = new Int32Array(J);
  const ids = new Int32Array(J);
  for (let i = 0; i < J; i += 1) {
    keys[i] = keyOf[order[i]];
    ids[i] = order[i];
  }
  const nodes: Record<string, JointNode> = {};
  for (const [id, n] of Object.entries(raw.nodes ?? {})) {
    const numActions = n.num_actions;
    const freq = u16(decodeBase64(n.freq));
    const weight = u16(decodeBase64(n.weight));
    if (weight.length !== J || freq.length !== J * Math.max(1, numActions - 1)) continue;
    const ev = n.ev ? i16(decodeBase64(n.ev)) : null;
    nodes[id] = {
      actor: n.actor,
      partner: n.partner,
      numActions,
      freq,
      weight,
      weightMax: n.weight_max,
      ev: ev && ev.length === J * numActions ? ev : null,
      evScale: n.ev_scale ?? 1,
    };
  }
  return { orbitCount: J, reps, keys, ids, nodes };
}

/** Position of `key` in a sorted key table, or -1. Shared with the dealer,
 *  which inlines the same loop over the policy's own arrays. */
export function findOrbit(keys: Int32Array, ids: Int32Array, key: number): number {
  let lo = 0;
  let hi = keys.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const k = keys[mid];
    if (k === key) return ids[mid];
    if (k < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** The orbit id of (own, partner), or -1 when the cards overlap or the
 *  table does not know the pair. */
export function orbitOf(joint: TeamJoint, o1: number, o2: number, p1: number, p2: number): number {
  if (o1 === o2 || p1 === p2 || o1 === p1 || o1 === p2 || o2 === p1 || o2 === p2) return -1;
  return findOrbit(joint.keys, joint.ids, orbitKey(o1, o2, p1, p2));
}

/** P(action) for a row, the last action being one minus the rest. */
export function jointFreq(node: JointNode, jc: number, action: number): number {
  const free = Math.max(1, node.numActions - 1);
  if (node.numActions === 1) return 1;
  if (action < free) return node.freq[jc * free + action] / 65535;
  let sum = 0;
  for (let a = 0; a < free; a += 1) sum += node.freq[jc * free + a];
  return Math.max(0, 1 - sum / 65535);
}

/** Team EV in chips for a row and action, or null without data. */
export function jointEv(node: JointNode, jc: number, action: number): number | null {
  if (!node.ev) return null;
  const q = node.ev[jc * node.numActions + action];
  return q === EV_NONE ? null : q * node.evScale;
}

/** The node's joint block for a decision node, if the payload has one. */
export function jointNodeFor(joint: TeamJoint | null, node: DumpNode): JointNode | null {
  return joint?.nodes[String(node.node_id)] ?? null;
}
