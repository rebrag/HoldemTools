#!/usr/bin/env python3
"""Decode MonkerSolver's card-abstraction tables (`holdem*.ser`).

MonkerSolver solves 3+ way postflop in production, and these files are how it
buckets hands. They are the reference for the sampled core's abstraction work
(engine/CLAUDE.md, per-core abstraction rule; roadmap M8e), decoded here so a
session can read the schema off one tracked file instead of reverse-engineering
a Java stream again.

The files themselves are Monker's proprietary output and this repo is public,
so they are NEVER committed. Keep them in `engine/reference/monker/`
(gitignored) and point this tool at them:

    python engine/tools/monker_ser.py summary engine/reference/monker/*.ser
    python engine/tools/monker_ser.py board engine/reference/monker/holdemflop_30_4.ser 5985
    python engine/tools/monker_ser.py --self-test

Format (decoded 2026-09-19 against Monker's `holdem{flop,turn,river}*.ser`,
engine at d61cb5e): zlib stream wrapping Java serialization of a Trove
`TIntObjectHashMap<int, TShortIntHashMap | TShortShortHashMap>` - one inner map
per board, one entry per hand. Every map is Externalizable and writes, in
block data: version byte, THash version byte, load factor f32, auto-compaction
f32, then per-class version bytes and no-entry sentinels, then `size` i32 and
the pairs. Inner maps are written with `writeObject`, so each one appears as
its own TC_OBJECT token between the outer map's block-data segments, and the
outer key that precedes it is the last i32 of the preceding block data.

What the eight files hold:

| file                  | boards (outer keys)              | inner value | content                                 |
|-----------------------|----------------------------------|-------------|-----------------------------------------|
| holdemflop, holdemflop2 | 1,755 = suit-canonical flops   | i32         | two per-hand features, fixed point / MAX_INT |
| holdemturn, holdemturn2 | 16,432 = suit-canonical turns  | i32         | the same two features                   |
| holdemriver           | 42,783 (filled lazily, not all)  | i32         | one feature: strength rank, ~1,950 values |
| holdemflop_30_4, holdemturn_30_4 | as above              | i16         | bucket 0..119 = 4 * strength + tier     |
| holdemriver_30        | as above                         | i16         | bucket 0..29, strength only             |

So Monker's abstraction is: per canonical board, expected hand strength
quantized to 30 buckets, crossed on flop and turn with a 4-level tier of a
second feature (the `holdem*2` file; almost certainly the second moment, the
classic E[HS] / E[HS^2] pair), and 30 strength buckets alone on the river.
Only 69-117 of the 120 flop buckets are occupied on any one board.

The hand key is a packed i16, `rank1 << 8 | suit1 << 6 | rank2 << 2 | suit2`,
with rank1 >= rank2 always (checked over all 881,374 flop entries), ranks
0..12 = deuce..ace, and suits 0..3 that are CLASSES relative to the board's
canonical suit order rather than real suits - which is why a board carries
78-643 hand keys, not 1,176: hands are suit-canonicalized per board before
they are bucketed. The board-key encoding is not decoded; it is only ever used
as an opaque id here.

Feature values in the i32 files are fixed point scaled so that MAX_INT
(2147483647) is 1.0. The river file's ~1,950 distinct values are ranks, not
equities.
"""
from __future__ import annotations

import argparse
import collections
import io
import os
import struct
import sys
import zlib
from dataclasses import dataclass, field

MAX_INT = 2147483647

# Java serialization tokens.
_TC_NULL = 0x70
_TC_REFERENCE = 0x71
_TC_CLASSDESC = 0x72
_TC_OBJECT = 0x73
_TC_STRING = 0x74
_TC_BLOCKDATA = 0x77
_TC_ENDBLOCKDATA = 0x78
_TC_BLOCKDATALONG = 0x7A
_BASE_HANDLE = 0x7E0000
_MAGIC = 0xACED
_VERSION = 5

_OUTER = "gnu.trove.map.hash.TIntObjectHashMap"
_INNER_INT = "gnu.trove.map.hash.TShortIntHashMap"
_INNER_SHORT = "gnu.trove.map.hash.TShortShortHashMap"


class _Reader:
    def __init__(self, data: bytes):
        self.d = data
        self.p = 0
        self.handles: list[object] = []

    def u8(self) -> int:
        v = self.d[self.p]
        self.p += 1
        return v

    def u16(self) -> int:
        (v,) = struct.unpack_from(">H", self.d, self.p)
        self.p += 2
        return v

    def i32(self) -> int:
        (v,) = struct.unpack_from(">i", self.d, self.p)
        self.p += 4
        return v

    def i64(self) -> int:
        (v,) = struct.unpack_from(">q", self.d, self.p)
        self.p += 8
        return v

    def utf(self) -> str:
        n = self.u16()
        v = self.d[self.p : self.p + n].decode("latin1")
        self.p += n
        return v

    def class_desc(self) -> dict | None:
        t = self.u8()
        if t == _TC_NULL:
            return None
        if t == _TC_REFERENCE:
            ref = self.handles[self.i32() - _BASE_HANDLE]
            if not isinstance(ref, dict):
                raise ValueError("class reference points at a non-class handle")
            return ref
        if t != _TC_CLASSDESC:
            raise ValueError(f"expected class descriptor, got 0x{t:02x} at {self.p - 1}")
        name = self.utf()
        self.i64()  # serialVersionUID
        flags = self.u8()
        desc = {"name": name, "flags": flags}
        self.handles.append(desc)
        for _ in range(self.u16()):
            typecode = self.u8()
            self.utf()  # field name
            if typecode in (ord("L"), ord("[")):
                if self.u8() != _TC_STRING:
                    raise ValueError("expected field type string")
                self.utf()
                self.handles.append("string")
        if self.u8() != _TC_ENDBLOCKDATA:
            raise ValueError("expected end of class annotation")
        desc["super"] = self.class_desc()
        return desc

    def obj(self) -> tuple[str, list]:
        """One TC_OBJECT: (class name, items), items being block-data bytes or nested objects."""
        t = self.u8()
        if t != _TC_OBJECT:
            raise ValueError(f"expected object, got 0x{t:02x} at {self.p - 1}")
        desc = self.class_desc()
        if desc is None:
            raise ValueError("object with null class")
        self.handles.append(("obj", desc["name"]))
        items: list = []
        while True:
            t = self.d[self.p]
            if t == _TC_BLOCKDATA:
                self.p += 1
                n = self.u8()
                items.append(self.d[self.p : self.p + n])
                self.p += n
            elif t == _TC_BLOCKDATALONG:
                self.p += 1
                n = self.i32()
                items.append(self.d[self.p : self.p + n])
                self.p += n
            elif t == _TC_ENDBLOCKDATA:
                self.p += 1
                return desc["name"], items
            else:
                items.append(self.obj())


def _split_pairs(blob: bytes, pair_fmt: str) -> list[tuple[int, int]]:
    """An inner map's block data: a short header ending in `size`, then `size` pairs.

    The header length varies by Trove version, so it is found rather than
    assumed: the i32 just before the pairs must equal the pair count.
    """
    pair_size = struct.calcsize(pair_fmt)
    for header in range(8, 32):
        rest = len(blob) - header
        if rest < 0:
            break
        if rest % pair_size == 0 and struct.unpack_from(">i", blob, header - 4)[0] == rest // pair_size:
            n = rest // pair_size
            return [struct.unpack_from(pair_fmt, blob, header + i * pair_size) for i in range(n)]
    raise ValueError("could not locate the pair array in an inner map")


@dataclass
class MonkerTable:
    path: str
    kind: str  # "buckets" (i16 values) or "features" (i32 values)
    boards: dict[int, dict[int, int]] = field(default_factory=dict)

    @property
    def is_two_dimensional(self) -> bool:
        """True for the 30x4 flop/turn bucket maps (values reach past 29)."""
        return self.kind == "buckets" and any(v > 29 for d in self.boards.values() for v in d.values())


def load(path: str) -> MonkerTable:
    with open(path, "rb") as f:
        data = zlib.decompress(f.read())
    r = _Reader(data)
    if r.u16() != _MAGIC or r.u16() != _VERSION:
        raise ValueError(f"{path}: not a Java serialization stream")
    name, items = r.obj()
    if name != _OUTER:
        raise ValueError(f"{path}: outer map is {name}, expected {_OUTER}")
    table = MonkerTable(path=path, kind="")
    pending = b""
    for it in items:
        if isinstance(it, bytes):
            pending += it
            continue
        inner_name, inner_items = it
        if len(pending) < 4:
            raise ValueError(f"{path}: inner map without a preceding key")
        (board,) = struct.unpack(">i", pending[-4:])
        pending = b""
        blob = b"".join(x for x in inner_items if isinstance(x, bytes))
        if inner_name == _INNER_SHORT:
            kind, fmt = "buckets", ">hh"
        elif inner_name == _INNER_INT:
            kind, fmt = "features", ">hi"
        else:
            raise ValueError(f"{path}: unexpected inner map {inner_name}")
        if table.kind and table.kind != kind:
            raise ValueError(f"{path}: mixed inner map types")
        table.kind = kind
        table.boards[board] = dict(_split_pairs(blob, fmt))
    return table


def unpack_hand(key: int) -> tuple[int, int, int, int]:
    """(rank1, suit1, rank2, suit2); ranks 0..12 = 2..A, suits are per-board classes."""
    return (key >> 8) & 0xF, (key >> 6) & 3, (key >> 2) & 0xF, key & 3


def pack_hand(rank1: int, suit1: int, rank2: int, suit2: int) -> int:
    return rank1 << 8 | suit1 << 6 | rank2 << 2 | suit2


def split_bucket(value: int) -> tuple[int, int]:
    """(strength bucket 0..29, tier 0..3) of a 30x4 flop/turn bucket id."""
    return value >> 2, value & 3


_RANKS = "23456789TJQKA"


def hand_str(key: int) -> str:
    r1, s1, r2, s2 = unpack_hand(key)
    return f"{_RANKS[r1]}{_RANKS[r2]}[{s1}{s2}]"


# ---------------------------------------------------------------- CLI

def _summary(paths: list[str]) -> None:
    for path in paths:
        t = load(path)
        sizes = [len(d) for d in t.boards.values()]
        values = collections.Counter(v for d in t.boards.values() for v in d.values())
        print(f"{os.path.basename(path)}: {t.kind}, {len(t.boards)} boards, "
              f"{sum(sizes)} hands ({min(sizes)}-{max(sizes)} per board), "
              f"{len(values)} distinct values in [{min(values)}, {max(values)}]")
        if t.kind == "buckets":
            live = [len(set(d.values())) for d in t.boards.values()]
            layout = "30 strength x 4 tiers" if t.is_two_dimensional else "30 strength"
            print(f"  layout {layout}; live buckets per board {min(live)}-{max(live)} "
                  f"(mean {sum(live) / len(live):.1f})")
        else:
            print(f"  features are fixed point over MAX_INT; max/MAX_INT = {max(values) / MAX_INT:.6f}")


def _board(path: str, board: int) -> None:
    t = load(path)
    d = t.boards.get(board)
    if d is None:
        sys.exit(f"board {board} not in {path}; keys look like {list(t.boards)[:5]}")
    for key in sorted(d):
        v = d[key]
        if t.kind == "buckets" and t.is_two_dimensional:
            s, tier = split_bucket(v)
            print(f"{hand_str(key):>9}  bucket {v:3d}  strength {s:2d}  tier {tier}")
        elif t.kind == "buckets":
            print(f"{hand_str(key):>9}  bucket {v:3d}")
        else:
            print(f"{hand_str(key):>9}  {v / MAX_INT:.6f}")


# ---------------------------------------------------------------- self-test

def _java_utf(s: str) -> bytes:
    b = s.encode("latin1")
    return struct.pack(">H", len(b)) + b


def _class_desc(name: str, superclass: bytes) -> bytes:
    # Externalizable | block-data flags (0x0c), no fields.
    return bytes([_TC_CLASSDESC]) + _java_utf(name) + struct.pack(">qBH", 1, 0x0C, 0) + bytes([_TC_ENDBLOCKDATA]) + superclass


def _block(b: bytes) -> bytes:
    return bytes([_TC_BLOCKDATA, len(b)]) + b


def _encode(boards: dict[int, dict[int, int]], inner_name: str, pair_fmt: str) -> bytes:
    """A minimal writer for the same layout, used only to round-trip the parser.

    The first inner object carries a full class descriptor; later ones are
    written as back-references, which is what a real stream does too.
    """
    out = io.BytesIO()
    out.write(struct.pack(">HH", _MAGIC, _VERSION))
    out.write(bytes([_TC_OBJECT]) + _class_desc(_OUTER, bytes([_TC_NULL])))
    # outer handle: class desc = 0x7E0000, object = 0x7E0001
    header = struct.pack(">BBffBiBi", 0, 0, 0.5, 0.5, 0, 0, 0, len(boards))
    inner_handle = None
    first = True
    keys = list(boards)
    for i, board in enumerate(keys):
        prefix = header if first else b""
        out.write(_block(prefix + struct.pack(">i", board)))
        if inner_handle is None:
            out.write(bytes([_TC_OBJECT]) + _class_desc(inner_name, bytes([_TC_NULL])))
            inner_handle = _BASE_HANDLE + 2  # outer class, outer object, inner class
        else:
            out.write(bytes([_TC_OBJECT, _TC_REFERENCE]) + struct.pack(">i", inner_handle))
        pairs = boards[board]
        body = struct.pack(">BBffBhhBi", 0, 0, 0.5, 0.5, 0, 0, 0, 0, len(pairs))
        body += b"".join(struct.pack(pair_fmt, k, v) for k, v in pairs.items())
        out.write(bytes([_TC_BLOCKDATALONG]) + struct.pack(">i", len(body)) + body + bytes([_TC_ENDBLOCKDATA]))
        first = False
    out.write(bytes([_TC_ENDBLOCKDATA]))
    return zlib.compress(out.getvalue())


def _self_test() -> None:
    import tempfile

    boards = {5985: {pack_hand(12, 0, 12, 1): 4 * 29 + 0, pack_hand(0, 0, 0, 1): 3},
              12747: {pack_hand(7, 2, 3, 0): 4 * 15 + 2}}
    with tempfile.TemporaryDirectory() as tmp:
        p = os.path.join(tmp, "buckets.ser")
        with open(p, "wb") as f:
            f.write(_encode(boards, _INNER_SHORT, ">hh"))
        t = load(p)
        assert t.kind == "buckets" and t.boards == boards, t
        assert t.is_two_dimensional
        assert split_bucket(t.boards[12747][pack_hand(7, 2, 3, 0)]) == (15, 2)

        feats = {b: {k: MAX_INT // (i + 1) for i, k in enumerate(d)} for b, d in boards.items()}
        p = os.path.join(tmp, "features.ser")
        with open(p, "wb") as f:
            f.write(_encode(feats, _INNER_INT, ">hi"))
        t = load(p)
        assert t.kind == "features" and t.boards == feats, t

    assert unpack_hand(pack_hand(12, 3, 0, 1)) == (12, 3, 0, 1)
    assert hand_str(pack_hand(12, 3, 0, 1)) == "A2[31]"
    print("monker_ser self-test OK")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--self-test", action="store_true", help="round-trip a synthetic stream and exit")
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("summary", help="boards, hands, value range, bucket layout per file")
    s.add_argument("paths", nargs="+")
    b = sub.add_parser("board", help="dump one board's hand -> value rows")
    b.add_argument("path")
    b.add_argument("board", type=int)
    args = ap.parse_args(argv)
    if args.self_test:
        _self_test()
    elif args.cmd == "summary":
        _summary(args.paths)
    elif args.cmd == "board":
        _board(args.path, args.board)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
