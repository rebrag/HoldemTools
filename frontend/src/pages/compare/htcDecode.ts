/** Reader for the .htc payload written by watcher/htc_format.py.
 *
 *  One file holds ONE solver's per-hand detail. The layout is documented
 *  there; this mirrors it. Two properties matter here: the header is JSON
 *  (so the summary panels read it directly), and each node's per-hand
 *  columns sit at a declared offset, so a node is decoded only when it is
 *  actually viewed - the page never touches the other ~1000 nodes' bytes.
 *
 *  Values are fixed-point at the scales the payload itself declares, rather
 *  than at scales hardcoded here, matching the schema-4 bundle convention.
 */

const MAGIC = "HTCMP01\0";
const FORMAT_VERSION = 2;
const EV_NULL = -2147483648; // i32 sentinel
const AEV_NULL_16 = -32768;

export type SolverTag = "ht" | "pio";

export interface HtcNodeMeta {
  id: string;
  position: string;
  actions: string[];
  reach_sum: number;
  hands: number;
  ev_wide: boolean;
  off: number;
  len: number;
}

export interface HtcSpot {
  board: string;
  pot: number;
  chip_scale?: number;
  config_hash: string;
}

export interface HtcHeader {
  kind: string;
  format: number;
  solver: SolverTag;
  spot: HtcSpot;
  summary: unknown;
  scales: { reach: number; freq: number; ev: number; action_ev: number };
  hand_order: string[];
  nodes: HtcNodeMeta[];
}

export interface HtcDoc {
  header: HtcHeader;
  /** Absolute byte offset of the block region. */
  blocksAt: number;
  buf: ArrayBuffer;
}

/** One hand's row for ONE solver. Comparing two solvers is a join on the
 *  hand string, done by the page - never by index, since each file carries
 *  its own solver's hand universe. */
export interface DecodedHand {
  hand: string;
  reach: number;
  freq: number[];
  ev: number | null;
  action_ev: (number | null)[];
}

export interface DecodedNode {
  id: string;
  position: string;
  actions: string[];
  reach_sum: number;
  hands: DecodedHand[];
}

export const isHtc = (buf: ArrayBuffer): boolean => {
  if (buf.byteLength < 16) return false;
  const head = new Uint8Array(buf, 0, 8);
  for (let i = 0; i < 8; i++) {
    if (head[i] !== MAGIC.charCodeAt(i)) return false;
  }
  return true;
};

export const parseHtc = (buf: ArrayBuffer): HtcDoc => {
  if (!isHtc(buf)) throw new Error("Not an .htc payload");
  const view = new DataView(buf);
  const headerLen = view.getUint32(8, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buf, 16, headerLen))
  ) as HtcHeader;
  if (header.format !== FORMAT_VERSION) {
    throw new Error(
      `This payload is format ${header.format}; /compare reads ${FORMAT_VERSION}. ` +
        `Format 1 held both solvers in one file, before the payload split - re-run the compare.`
    );
  }
  if (header.solver !== "ht" && header.solver !== "pio") {
    throw new Error(`Payload has no known solver tag (got ${String(header.solver)})`);
  }
  return { header, blocksAt: 16 + headerLen, buf };
};

/** Decode one node's per-hand rows. Typed-array views are copied (`slice`)
 *  because the block region is not guaranteed to be aligned to 2/4 bytes -
 *  a misaligned Uint16Array/Int32Array view would throw. */
export const decodeNode = (doc: HtcDoc, index: number): DecodedNode | null => {
  const meta = doc.header.nodes[index];
  if (!meta) return null;
  const { reach: sReach, freq: sFreq, ev: sEv } = doc.header.scales;
  const n = meta.hands;
  const A = meta.actions.length;
  let pos = doc.blocksAt + meta.off;

  const u16 = (count: number): Uint16Array => {
    const a = new Uint16Array(doc.buf.slice(pos, pos + count * 2));
    pos += count * 2;
    return a;
  };
  const i32 = (count: number): Int32Array => {
    const a = new Int32Array(doc.buf.slice(pos, pos + count * 4));
    pos += count * 4;
    return a;
  };
  const aev = (count: number): Int32Array | Int16Array => {
    if (meta.ev_wide) return i32(count);
    const a = new Int16Array(doc.buf.slice(pos, pos + count * 2));
    pos += count * 2;
    return a;
  };

  const idx = u16(n);
  const reach = u16(n);
  const freq = u16(n * A);
  const evQ = i32(n);
  const aevCol = aev(n * A);
  const aevNull = meta.ev_wide ? EV_NULL : AEV_NULL_16;

  const hands: DecodedHand[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const freqRow: number[] = new Array(A);
    for (let k = 0; k < A; k++) freqRow[k] = freq[k * n + i] / sFreq;

    const baseQ = evQ[i];
    // Action EVs are stored as deltas from the hand's own (quantized) EV, so
    // they are summed before scaling - exactly as they were encoded.
    const actionEv: (number | null)[] = new Array(A);
    for (let k = 0; k < A; k++) {
      const d = aevCol[k * n + i];
      actionEv[k] = d === aevNull || baseQ === EV_NULL ? null : (baseQ + d) / sEv;
    }
    hands[i] = {
      hand: doc.header.hand_order[idx[i]] ?? "??",
      reach: reach[i] / sReach,
      freq: freqRow,
      ev: baseQ === EV_NULL ? null : baseQ / sEv,
      action_ev: actionEv,
    };
  }

  return {
    id: meta.id,
    position: meta.position,
    actions: meta.actions,
    reach_sum: meta.reach_sum,
    hands,
  };
};

/** One hand as the page renders it: whichever solvers have a row for it,
 *  plus the L1 distance between their frequencies when both do. */
export interface JoinedHand {
  hand: string;
  /** htsolver's reach where it has the hand, else Pio's - cell heights and
   *  range weighting need one number, and htsolver is the reference. */
  reach: number;
  ht: DecodedHand | null;
  pio: DecodedHand | null;
  l1: number | null;
}

/** Join two solvers' rows for one node BY HAND STRING.
 *
 *  Never by index: each payload carries its own solver's hand universe, and
 *  Pio legitimately drops hands it has no matchups for. Actions are matched
 *  by label for the same reason - a node whose action lists disagree should
 *  render blank cells rather than silently pair the wrong columns. */
export const joinHands = (
  htNode: DecodedNode | null,
  pioNode: DecodedNode | null
): JoinedHand[] => {
  const out: JoinedHand[] = [];
  const pioByHand = new Map<string, DecodedHand>();
  if (pioNode) for (const h of pioNode.hands) pioByHand.set(h.hand, h);

  if (htNode) {
    const labelIndex = new Map(htNode.actions.map((a, i) => [a, i]));
    for (const ht of htNode.hands) {
      const pio = pioByHand.get(ht.hand) ?? null;
      let l1: number | null = null;
      if (pio && pioNode) {
        l1 = 0;
        for (let k = 0; k < pioNode.actions.length; k++) {
          const mine = labelIndex.get(pioNode.actions[k]);
          if (mine == null) {
            l1 = null; // action lists disagree: no honest distance to report
            break;
          }
          l1 += Math.abs(ht.freq[mine] - pio.freq[k]);
        }
      }
      out.push({ hand: ht.hand, reach: ht.reach, ht, pio, l1 });
      pioByHand.delete(ht.hand);
    }
  }
  // Hands only Pio reaches are real information (the engine never puts them
  // in this node), so they are kept - listed after the joined rows.
  for (const pio of pioByHand.values()) {
    out.push({ hand: pio.hand, reach: pio.reach, ht: null, pio, l1: null });
  }
  return out;
};
