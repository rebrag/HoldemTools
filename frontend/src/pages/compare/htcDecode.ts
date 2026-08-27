/** Reader for the .htc comparison payload written by watcher/htc_format.py.
 *
 *  The layout is documented there; this mirrors it. Two properties matter
 *  here: the header is JSON (so the summary panels read it exactly as they
 *  read the old JSON doc), and each node's per-hand columns sit at a
 *  declared offset, so a node is decoded only when it is actually viewed -
 *  the page never touches the other ~1000 nodes' bytes.
 *
 *  Values are fixed-point at the scales the payload itself declares, rather
 *  than at scales hardcoded here, matching the schema-4 bundle convention.
 */

const MAGIC = "HTCMP01\0";
const EV_NULL = -2147483648; // i32 sentinel
const AEV_NULL_16 = -32768;

export interface HtcNodeMeta {
  id: string;
  position: string;
  actions: string[];
  global_freq: number;
  hands: number;
  ev_wide: boolean;
  off: number;
  len: number;
}

export interface HtcHeader {
  kind: string;
  format: number;
  spot: unknown;
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

/** One hand's two-solver comparison row, matching the JSON doc's shape so
 *  the renderers are indifferent to which format was loaded. */
export interface DecodedHand {
  hand: string;
  reach: number;
  ht: { freq: number[]; ev: number; action_ev: (number | null)[] };
  pio: { freq: number[]; ev: number | null; action_ev: (number | null)[] };
  l1: number;
}

export interface DecodedNode {
  id: string;
  position: string;
  actions: string[];
  global_freq: number;
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
  if (!isHtc(buf)) throw new Error("Not an .htc comparison payload");
  const view = new DataView(buf);
  const headerLen = view.getUint32(8, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buf, 16, headerLen))
  ) as HtcHeader;
  if (header.format !== 1) {
    throw new Error(`Unsupported .htc format version ${header.format} (this build reads 1)`);
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
  const htFreq = u16(n * A);
  const pioFreq = u16(n * A);
  const htEv = i32(n);
  const pioEv = i32(n);
  const htAev = aev(n * A);
  const pioAev = aev(n * A);
  const aevNull = meta.ev_wide ? EV_NULL : AEV_NULL_16;

  const hands: DecodedHand[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const htFreqRow: number[] = new Array(A);
    const pioFreqRow: number[] = new Array(A);
    let l1 = 0;
    for (let k = 0; k < A; k++) {
      htFreqRow[k] = htFreq[k * n + i] / sFreq;
      pioFreqRow[k] = pioFreq[k * n + i] / sFreq;
      l1 += Math.abs(htFreqRow[k] - pioFreqRow[k]);
    }
    const htEvQ = htEv[i];
    const pioEvQ = pioEv[i];
    // action EVs are stored as deltas from the hand's own (quantized) EV,
    // so they are summed before scaling - exactly as they were encoded.
    const actionEv = (
      col: Int32Array | Int16Array,
      baseQ: number
    ): (number | null)[] => {
      const out: (number | null)[] = new Array(A);
      for (let k = 0; k < A; k++) {
        const d = col[k * n + i];
        out[k] = d === aevNull || baseQ === EV_NULL ? null : (baseQ + d) / sEv;
      }
      return out;
    };
    hands[i] = {
      hand: doc.header.hand_order[idx[i]] ?? "??",
      reach: reach[i] / sReach,
      ht: {
        freq: htFreqRow,
        ev: htEvQ === EV_NULL ? 0 : htEvQ / sEv,
        action_ev: actionEv(htAev, htEvQ),
      },
      pio: {
        freq: pioFreqRow,
        ev: pioEvQ === EV_NULL ? null : pioEvQ / sEv,
        action_ev: actionEv(pioAev, pioEvQ),
      },
      l1,
    };
  }

  return {
    id: meta.id,
    position: meta.position,
    actions: meta.actions,
    global_freq: meta.global_freq,
    hands,
  };
};
