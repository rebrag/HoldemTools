"""The .htc binary payload: ONE solver's per-hand detail for a solved spot.

Why this exists: the equivalent JSON ran ~250 bytes per hand row, so a turn
tree's detail was 40MB+ for a capped 250 nodes and had to be trimmed to stay
uploadable. Fixed-point columns run ~16 bytes per row, which buys per-hand
detail for EVERY decision node at a fraction of the bytes.

One file holds one solver, tagged in the header. htsolver and PioSolver each
get their own, because PioSolver is on its way out: an engine-only run should
not pay for a format that assumes a second solver exists, and the two halves
are produced by completely different code paths (the htsolver payload comes
straight out of the engine dump, the Pio one out of per-node UPI queries).
Anything wanting to compare them joins on the hand string, never on index -
each file carries its own solver's hand universe and reach, and the two need
not agree.

Layout (little-endian throughout, like the .hta artifact):

    0   magic  b"HTCMP01\\0"
    8   u32 header_len
    12  u32 flags (reserved, 0)
    16  header JSON, header_len bytes of UTF-8
    ..  per-node column blocks; each node's `off` is relative to the start of
        this region, so offsets do not depend on the header's own length

The header carries the spot, the summary block (identical to the JSON doc's,
so every existing panel keeps working), the fixed-point scales, the shared
hand_order, and a node directory.

Per node, columns are struct-of-arrays - which gzips ~25% better than
interleaving the same numbers - with `n` hands and `A` actions:

    u16 idx[n]              index into header.hand_order
    u16 reach[n]            x scales.reach, THIS solver's own reach
    u16 freq[A][n]          x scales.freq, action-major
    i32 ev[n]               x scales.ev,  EV_NULL when absent
    T   aev[A][n]           x scales.action_ev, DELTA from that hand's ev
                            T = i16, or i32 when the node's ev_wide flag is set

Precision is pinned to what the UI renders, not to what is smallest: scale
1000 on frequencies matches the 0.1 percentage point the tables print, and
scale 100 on EVs matches their 2-decimal chip display exactly. float16 was
measured at 0.06-0.25 chips of error on real EVs (they run to the hundreds
of chips) and is unusable here despite the artifact format using it.

Per-action EVs are stored as deltas from the hand's own EV because that fits
i16 in every realistic spot while absolute values would not; a node whose
deltas exceed i16 sets ev_wide and stores them as i32, so the encoding is
exact rather than merely usually-exact.
"""

from __future__ import annotations

import json
import sys
from array import array
from typing import Any, Dict, List, Optional, Sequence

# The magic is deliberately unchanged across the v1 -> v2 split: a v1 file
# then still parses far enough for a reader to say "format 1, produced before
# the payload split" instead of the useless "not an .htc payload".
MAGIC = b"HTCMP01\0"
FORMAT_VERSION = 2
KIND = "htsolver_compare_binary"
SOLVERS = ("ht", "pio")

# Fixed-point scales, shipped in the payload rather than hardcoded in readers
# (the same convention as the schema-4 bundles' COMBO_SCALE).
#
# Reach and frequency use 10000 - the artifact format's own rollup-frequency
# scale - because both are bounded by 1.0 and so still fit u16 with room to
# spare, which buys a half-ULP of 0.00005 against displays that print 0.1
# percentage points and 3 decimals. EVs are chips at 2 decimals, exactly what
# the tables render. action_ev shares the ev scale: deltas are added to a
# quantized ev, so they have to be counted in the same units.
SCALES = {"reach": 10000, "freq": 10000, "ev": 100, "action_ev": 100}

EV_NULL = -(2 ** 31)  # i32 sentinel: Pio reported no EV for this hand
AEV_NULL_16 = -(2 ** 15)
AEV_NULL_32 = EV_NULL
_I16_LIMIT = 2 ** 15 - 1


def _pack(typecode: str, values: Sequence[int]) -> bytes:
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return a.tobytes()


def _q(value: float, scale: int) -> int:
    return int(value * scale + (0.5 if value >= 0 else -0.5))


class HtcWriter:
    """Accumulates node blocks, then writes header + blocks in one pass.

    Blocks are held in memory (tens of MB for a turn tree, well under what
    the JSON path used) so the header can carry absolute offsets without a
    second pass over the file.
    """

    def __init__(self, solver: str) -> None:
        if solver not in SOLVERS:
            raise ValueError(f"solver must be one of {SOLVERS}, got {solver!r}")
        self.solver = solver
        self._blocks: List[bytes] = []
        self._nodes: List[Dict[str, Any]] = []
        self._hand_index: Dict[str, int] = {}
        self._hand_order: List[str] = []

    def hand_id(self, hand: str) -> int:
        idx = self._hand_index.get(hand)
        if idx is None:
            idx = len(self._hand_order)
            self._hand_index[hand] = idx
            self._hand_order.append(hand)
        return idx

    def add_node(self, node_id: str, position: str, actions: Sequence[str],
                 hands: Sequence[Dict[str, Any]]) -> None:
        """One decision node's per-hand rows for this file's solver.

        Each hand is {hand, reach, freq[A], ev, action_ev[A]}; ev and any
        action_ev entry may be None.
        """
        n = len(hands)
        num_actions = len(actions)

        idx_col = [self.hand_id(h["hand"]) for h in hands]
        reach_col = [_q(h["reach"], SCALES["reach"]) for h in hands]

        freq_col: List[int] = []
        for k in range(num_actions):
            freq_col.extend(_q(h["freq"][k], SCALES["freq"]) for h in hands)

        ev_col = [EV_NULL if h["ev"] is None else _q(h["ev"], SCALES["ev"])
                  for h in hands]

        # Deltas are taken between the QUANTIZED values, not the raw ones, so
        # that ev + delta reconstructs the action EV exactly rather than
        # compounding two independent roundings into a full-cent error.
        aev_col: List[Optional[int]] = []
        wide = False
        for k in range(num_actions):
            for i, h in enumerate(hands):
                row = h["action_ev"]
                v = row[k] if k < len(row) else None
                if v is None or ev_col[i] == EV_NULL:
                    aev_col.append(None)
                    continue
                d = _q(v, SCALES["ev"]) - ev_col[i]
                if abs(d) > _I16_LIMIT:
                    wide = True
                aev_col.append(d)

        null_aev = AEV_NULL_32 if wide else AEV_NULL_16
        block = b"".join([
            _pack("H", idx_col),
            _pack("H", reach_col),
            _pack("H", freq_col),
            _pack("i", ev_col),
            _pack("i" if wide else "h",
                  [null_aev if v is None else v for v in aev_col]),
        ])

        self._nodes.append({
            "id": node_id,
            "position": position,
            "actions": list(actions),
            # Replaces the old global_freq, which was a Pio-only UPI call
            # nothing rendered. This is free: it is the column we just built.
            "reach_sum": round(sum(h["reach"] for h in hands), 6),
            "hands": n,
            "ev_wide": wide,
            "len": len(block),
        })
        self._blocks.append(block)

    def node_count(self) -> int:
        return len(self._nodes)

    def write(self, path: str, spot: Dict[str, Any], summary: Dict[str, Any]) -> int:
        """Write the payload; returns the byte size."""
        # Offsets are relative to the start of the block region, so they do
        # not depend on the header's own serialized length (which would
        # otherwise be circular: the header carries the offsets).
        offset = 0
        for node in self._nodes:
            node["off"] = offset
            offset += node["len"]
        header = {
            "kind": KIND,
            "format": FORMAT_VERSION,
            "solver": self.solver,
            "spot": spot,
            "summary": summary,
            "scales": dict(SCALES),
            "hand_order": self._hand_order,
            "nodes": self._nodes,
        }
        blob = json.dumps(header, separators=(",", ":")).encode("utf8")
        with open(path, "wb") as f:
            f.write(MAGIC)
            f.write(_pack("I", [len(blob)]))
            f.write(_pack("I", [0]))
            f.write(blob)
            for block in self._blocks:
                f.write(block)
        return 16 + len(blob) + offset


def _check_format(header: Dict[str, Any]) -> Dict[str, Any]:
    got = header.get("format")
    if got != FORMAT_VERSION:
        raise ValueError(
            f"this payload is format {got}; this build reads {FORMAT_VERSION}. "
            f"Format 1 held both solvers in one file, before the payload split - "
            f"re-run the compare to regenerate it.")
    if header.get("solver") not in SOLVERS:
        raise ValueError(f"payload has no known solver tag (got {header.get('solver')!r})")
    return header


def read_htc_header(path: str) -> Dict[str, Any]:
    """Just the header - solver, spot, summary, scales, node directory. Reads
    the first few hundred KB rather than the whole payload."""
    with open(path, "rb") as f:
        prefix = f.read(16)
        if prefix[:8] != MAGIC:
            raise ValueError(f"not an .htc payload (magic {prefix[:8]!r})")
        header_len = int.from_bytes(prefix[8:12], "little")
        return _check_format(json.loads(f.read(header_len).decode("utf8")))


def read_htc(path: str) -> Dict[str, Any]:
    """Decode a whole payload back to plain dicts. Verification/debug use;
    the frontend decodes one node at a time from the same layout."""
    with open(path, "rb") as f:
        raw = f.read()
    if raw[:8] != MAGIC:
        raise ValueError(f"not an .htc payload (magic {raw[:8]!r})")
    header_len = int.from_bytes(raw[8:12], "little")
    header = _check_format(json.loads(raw[16:16 + header_len].decode("utf8")))
    scales = header["scales"]
    hand_order = header["hand_order"]

    def col(kind: str, off: int, count: int):
        a = array(kind)
        a.frombytes(raw[off:off + count * a.itemsize])
        if sys.byteorder != "little":
            a.byteswap()
        return a

    blocks_at = 16 + header_len
    nodes = []
    for meta in header["nodes"]:
        n, actions = meta["hands"], meta["actions"]
        A = len(actions)
        pos = blocks_at + meta["off"]
        idx = col("H", pos, n); pos += n * 2
        reach = col("H", pos, n); pos += n * 2
        freq = col("H", pos, n * A); pos += n * A * 2
        ev_q = col("i", pos, n); pos += n * 4
        aev_code = "i" if meta["ev_wide"] else "h"
        aev_null = AEV_NULL_32 if meta["ev_wide"] else AEV_NULL_16
        aev = col(aev_code, pos, n * A)

        hands = []
        for i in range(n):
            ev = None if ev_q[i] == EV_NULL else ev_q[i] / scales["ev"]
            hands.append({
                "hand": hand_order[idx[i]],
                "reach": reach[i] / scales["reach"],
                "freq": [freq[k * n + i] / scales["freq"] for k in range(A)],
                "ev": ev,
                # Deltas are in ev units: add before dividing, so this is the
                # same fixed-point value the writer quantized.
                "action_ev": [
                    None if (aev[k * n + i] == aev_null or ev is None)
                    else (ev_q[i] + aev[k * n + i]) / scales["ev"]
                    for k in range(A)
                ],
            })
        nodes.append({
            "id": meta["id"], "position": meta["position"], "actions": actions,
            "reach_sum": meta["reach_sum"], "hands": hands,
        })
    return {"header": header, "nodes": nodes}
