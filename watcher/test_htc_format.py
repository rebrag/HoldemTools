"""Round-trip tests for the .htc payload. Run directly: python test_htc_format.py

This is hand-rolled binary with a column cursor that has to stay in lockstep
across two languages (htc_format.py writes it, frontend/src/pages/compare/
htcDecode.ts reads it), so the encoding earns a test even though the watcher
has no test framework. Stdlib only, exits non-zero on the first failure.
"""

from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from htc_format import (  # noqa: E402
    FORMAT_VERSION, SCALES, HtcWriter, read_htc, read_htc_header,
)

FAILURES = []


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}{': ' + detail if detail else ''}")
        FAILURES.append(label)


def close(a, b, tol) -> bool:
    return a is not None and b is not None and abs(a - b) <= tol


SPOT = {"board": "9c 5d Jc 7s 9h", "pot": 100.0, "chip_scale": 100,
        "config_hash": "deadbeef"}


def write_sample(path: str, solver: str, hands, actions=("c", "b50")) -> None:
    w = HtcWriter(solver)
    w.add_node("r:0", "OOP", list(actions), hands)
    w.write(path, SPOT, {"solver": solver})


def test_roundtrip() -> None:
    print("round trip within one quantization step")
    hands = [
        {"hand": "AsAh", "reach": 1.0, "freq": [0.9995, 0.0005],
         "ev": 95.561, "action_ev": [95.561, 95.323]},
        {"hand": "7d2c", "reach": 0.0123, "freq": [0.25, 0.75],
         "ev": -12.34, "action_ev": [-12.34, -50.0]},
    ]
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "t.htc")
        write_sample(p, "ht", hands)
        got = read_htc(p)["nodes"][0]["hands"]
        check("hand strings preserved", [h["hand"] for h in got] == ["AsAh", "7d2c"])
        for src, out in zip(hands, got):
            tol_f = 0.5 / SCALES["freq"]
            tol_e = 0.5 / SCALES["ev"]
            check(f"{src['hand']} reach", close(out["reach"], src["reach"],
                                                0.5 / SCALES["reach"]))
            check(f"{src['hand']} freq", all(
                close(out["freq"][k], src["freq"][k], tol_f) for k in range(2)))
            check(f"{src['hand']} ev", close(out["ev"], src["ev"], tol_e))
            check(f"{src['hand']} action_ev", all(
                close(out["action_ev"][k], src["action_ev"][k], tol_e)
                for k in range(2)))


def test_ev_wide() -> None:
    print("ev_wide fallback when an action EV strays past i16 range")
    # i16 at scale 100 tops out at 327.67 chips of delta; a fold line on a
    # deep stack really does exceed that, which is why the fallback exists.
    narrow = [{"hand": "AsAh", "reach": 1.0, "freq": [1.0, 0.0],
               "ev": 100.0, "action_ev": [100.0, 90.0]}]
    wide = [{"hand": "AsAh", "reach": 1.0, "freq": [1.0, 0.0],
             "ev": 400.0, "action_ev": [400.0, -400.0]}]
    with tempfile.TemporaryDirectory() as d:
        for label, hands, expect_wide in (("narrow", narrow, False), ("wide", wide, True)):
            p = os.path.join(d, f"{label}.htc")
            write_sample(p, "ht", hands)
            meta = read_htc_header(p)["nodes"][0]
            check(f"{label}: ev_wide == {expect_wide}", meta["ev_wide"] is expect_wide)
            out = read_htc(p)["nodes"][0]["hands"][0]
            check(f"{label}: action_ev exact", all(
                close(out["action_ev"][k], hands[0]["action_ev"][k], 0.5 / SCALES["ev"])
                for k in range(2)), str(out["action_ev"]))


def test_nulls() -> None:
    print("null EVs survive as null, not as zero")
    hands = [
        {"hand": "AsAh", "reach": 1.0, "freq": [1.0, 0.0],
         "ev": None, "action_ev": [None, None]},
        {"hand": "KsKh", "reach": 0.5, "freq": [0.5, 0.5],
         "ev": 10.0, "action_ev": [10.0, None]},
    ]
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "n.htc")
        write_sample(p, "pio", hands)
        got = read_htc(p)["nodes"][0]["hands"]
        check("null ev stays None", got[0]["ev"] is None)
        check("null action_ev stays None", got[0]["action_ev"] == [None, None])
        check("present ev survives alongside", close(got[1]["ev"], 10.0, 0.005))
        check("partial null action_ev", got[1]["action_ev"][1] is None
              and close(got[1]["action_ev"][0], 10.0, 0.005))


def test_header() -> None:
    print("header fields and header-only reads")
    hands = [{"hand": "AsAh", "reach": 0.25, "freq": [1.0, 0.0],
              "ev": 1.0, "action_ev": [1.0, 0.0]},
             {"hand": "KsKh", "reach": 0.75, "freq": [0.0, 1.0],
              "ev": 2.0, "action_ev": [2.0, 0.0]}]
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "h.htc")
        write_sample(p, "pio", hands)
        head = read_htc_header(p)
        check("format version", head["format"] == FORMAT_VERSION)
        check("solver tag", head["solver"] == "pio")
        check("scales shipped", head["scales"] == SCALES)
        check("spot preserved", head["spot"]["config_hash"] == "deadbeef")
        check("hand_order", head["hand_order"] == ["AsAh", "KsKh"])
        node = head["nodes"][0]
        check("node meta", node["id"] == "r:0" and node["position"] == "OOP"
              and node["hands"] == 2 and node["actions"] == ["c", "b50"])
        check("reach_sum", close(node["reach_sum"], 1.0, 1e-6), str(node["reach_sum"]))
        # A header read must not touch the block region: the watcher harvests
        # timings this way, and truncating the blocks must not break it.
        with open(p, "rb") as f:
            head_bytes = f.read(16)
            header_len = int.from_bytes(head_bytes[8:12], "little")
            truncated = head_bytes + f.read(header_len)
        tp = os.path.join(d, "truncated.htc")
        with open(tp, "wb") as f:
            f.write(truncated)
        check("header reads without the block region",
              read_htc_header(tp)["nodes"][0]["hands"] == 2)


def test_two_solver_files_are_independent() -> None:
    print("two files for one spot decode independently")
    ht = [{"hand": "AsAh", "reach": 1.0, "freq": [1.0, 0.0],
           "ev": 50.0, "action_ev": [50.0, 40.0]}]
    # Pio's file may legitimately carry a different hand set and its own reach.
    pio = [{"hand": "AsAh", "reach": 0.9, "freq": [0.8, 0.2],
            "ev": 49.5, "action_ev": [49.5, 41.0]},
           {"hand": "QsQh", "reach": 0.1, "freq": [0.0, 1.0],
            "ev": 5.0, "action_ev": [4.0, 5.0]}]
    with tempfile.TemporaryDirectory() as d:
        hp, pp = os.path.join(d, "a.ht.htc"), os.path.join(d, "a.pio.htc")
        write_sample(hp, "ht", ht)
        write_sample(pp, "pio", pio)
        h, p = read_htc(hp), read_htc(pp)
        check("solvers tagged apart",
              h["header"]["solver"] == "ht" and p["header"]["solver"] == "pio")
        check("same spot", h["header"]["spot"] == p["header"]["spot"])
        check("different hand counts survive",
              len(h["nodes"][0]["hands"]) == 1 and len(p["nodes"][0]["hands"]) == 2)
        check("each keeps its own reach",
              close(h["nodes"][0]["hands"][0]["reach"], 1.0, 1e-3)
              and close(p["nodes"][0]["hands"][0]["reach"], 0.9, 1e-3))


def test_rejects_bad_input() -> None:
    print("clear errors on bad input")
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "junk.htc")
        with open(p, "wb") as f:
            f.write(b"NOTHTC01" + b"\0" * 16)
        try:
            read_htc_header(p)
            check("non-htc file rejected", False, "no error raised")
        except ValueError as e:
            check("non-htc file rejected", "not an .htc payload" in str(e))
        try:
            HtcWriter("bogus")
            check("unknown solver rejected", False, "no error raised")
        except ValueError:
            check("unknown solver rejected", True)


def main() -> int:
    for fn in (test_roundtrip, test_ev_wide, test_nulls, test_header,
               test_two_solver_files_are_independent, test_rejects_bad_input):
        fn()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED: {', '.join(FAILURES)}")
        return 1
    print("all htc format tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
