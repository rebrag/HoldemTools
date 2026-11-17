"""Golden test: the Pio-shaped schema-4 output of extraction.py must not move.

The fixture `fixtures/pio_golden.json` was generated from extraction.py BEFORE
the htsolver changes (optional `engine` block, shared publish module) were
made, so a byte-for-byte match proves the Pio path's manifest, street bundle
and node doc are unchanged by them.

Regenerate only on a deliberate schema change:
    python tests/test_extraction_golden.py --write
"""

import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(HERE, "fixtures", "pio_golden.json")

if __name__ == "__main__":  # allow running as a script to regenerate
    sys.path.insert(0, os.path.dirname(HERE))


def _pio_hand_order():
    """A 1326 order in Pio's style (ascending, lower pair first)."""
    ranks = "23456789TJQKA"
    suits = "cdhs"
    cards = [r + s for r in ranks for s in suits]
    out = []
    for hi in range(52):
        for lo in range(hi):
            out.append(cards[hi] + cards[lo])
    return out


def _synthetic_pio_extract():
    """A two-street Pio-shaped extract: a flop root plus one turn seed."""
    rng = random.Random(7)
    hand_order = _pio_hand_order()

    def vec(lo, hi, zero_frac=0.3):
        return [0.0 if rng.random() < zero_frac else round(rng.uniform(lo, hi), 4) for _ in range(1326)]

    def view(node_id, position, board, labels, children):
        strat = [[0.0] * 1326 for _ in labels]
        for i in range(1326):
            raw = [rng.random() for _ in labels]
            tot = sum(raw)
            for a in range(len(labels)):
                strat[a][i] = round(raw[a] / tot, 4)
        oop_range = vec(0.0, 1.0)
        ip_range = vec(0.0, 1.0)
        return {
            "node_id": node_id,
            "position": position,
            "node_type": "OOP_DEC" if position == "OOP" else "IP_DEC",
            "board": board,
            "pot": [0, 0, 550],
            "flags": [],
            "street": "flop" if len(board) == 3 else "turn",
            "actions": labels,
            "children": children,
            "strategy": strat,
            "evs": {"oop": vec(-50, 400, 0), "ip": vec(-50, 400, 0)},
            "seats": {
                "oop": {
                    "range": oop_range,
                    "equity": vec(0, 1, 0),
                    "matchups": vec(0, 900, 0),
                    "equity_total": 0.512,
                    "ev": vec(-50, 400, 0),
                },
                "ip": {
                    "range": ip_range,
                    "equity": vec(0, 1, 0),
                    "matchups": vec(0, 900, 0),
                    "equity_total": None,
                    "ev": vec(-50, 400, 0),
                },
            },
            "global_freq": 0.25,
            "action_evs": {lbl: (None if lbl == "f" else vec(-50, 400, 0)) for lbl in labels},
        }

    flop_root = view(
        "r:0", "OOP", ["Qh", "Jh", "Th"], ["c", "b100"],
        {"c": "r:0:c", "b100": "r:0:b100"},
    )
    flop_ip = view(
        "r:0:b100", "IP", ["Qh", "Jh", "Th"], ["f", "c"],
        {"f": "r:0:b100:f", "c": "r:0:b100:c"},
    )
    turn_root = view(
        "r:0:b100:c:2c", "OOP", ["Qh", "Jh", "Th", "2c"], ["c"],
        {"c": "r:0:b100:c:2c:c"},
    )
    return {
        "hand_order": hand_order,
        "tree_info": {"Pot": "550", "EffectiveStacks": "1000"},
        "effective_stack": 1000,
        "results": {"ev_oop": 270.5, "ev_ip": 279.5, "exploitable": 1.1, "mes_oop": None, "mes_ip": None},
        "streets": {
            "r:0": {
                "views": {"r:0": flop_root, "r:0:b100": flop_ip},
                "nodes_meta": {
                    "r.0": {"type": "OOP_DEC", "street": "flop", "actions": ["c", "b100"], "extracted": True},
                    "r.0.b100": {"type": "IP_DEC", "street": "flop", "actions": ["f", "c"], "extracted": True},
                    "r.0.c": {"type": "SPLIT_NODE", "street": "flop", "extracted": False},
                    "r.0.b100.f": {"type": "terminal"},
                    "r.0.b100.c": {"type": "SPLIT_NODE", "street": "flop", "extracted": False},
                },
            },
            "r:0:b100:c:2c": {
                "views": {"r:0:b100:c:2c": turn_root},
                "nodes_meta": {
                    "r.0.b100.c.2c": {"type": "OOP_DEC", "street": "turn", "actions": ["c"], "extracted": True},
                    "r.0.b100.c.2c.c": {"type": "IP_DEC", "street": "turn", "extracted": True},
                },
            },
        },
    }


GAMETREE_PATH = (
    "gametrees/2026/01/02/uid123/folder=750SB_2000UTG/Root_Call_pos=SB_icm=0.json"
)


def build_golden():
    """Everything the Pio watcher writes for one board, built with the public builders."""
    import extraction

    ex = _synthetic_pio_extract()
    ctx = extraction.build_board_context(
        board="QhJhTh",
        cfr_file="QhJhTh__abc.cfr",
        src_gametree_path=GAMETREE_PATH,
        base_prefix="gametrees",
        stats=ex["results"],
        tree_info=ex["tree_info"],
        alive_positions=["UTG", "SB"],
        acting_pos="SB",
        preflop_line=["Root", "Call"],
        is_icm=False,
        seat_meta=[
            {"Pos": "SB", "Name": "Hero", "StackChips": 7500, "Folded": False, "Hero": True, "Cards": ["As", "Kd"]},
            {"Pos": "UTG", "Name": "Villain", "StackChips": 20000},
        ],
        hand_bb=2,
        chip_scale=10,
    )
    ctx["effective_stack_chips"] = ex["effective_stack"]
    ctx["pot_chips"] = 550
    bundles = {
        seed: extraction.build_street_bundle(
            seed, walk["views"], walk["nodes_meta"], ctx, ex["hand_order"]
        )
        for seed, walk in ex["streets"].items()
    }
    streets_map = {
        b["seed_suffix"]: extraction.street_entry(b["seed_suffix"], b["street"], len(b["nodes"]))
        for b in bundles.values()
    }
    manifest = extraction.build_manifest(ctx, streets_map, cfr_size_bytes=123456789, existing=None)
    # A merge onto an existing manifest is the second-publish shape.
    merged = extraction.build_manifest(
        ctx, {"r.0": streets_map["r.0"]}, cfr_size_bytes=None,
        existing={"created_utc": "2025-12-31T00:00:00+00:00", "streets": {"r.0.x": {"street": "river"}}},
    )
    reparsed = extraction.context_from_manifest(manifest, "QhJhTh__abc.cfr", ex["tree_info"])
    return {
        "manifest": manifest,
        "merged_manifest": merged,
        "bundles": bundles,
        "context_from_manifest": reparsed,
    }


def _serialize(obj) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def test_pio_shaped_output_is_byte_identical(frozen_time):
    with open(GOLDEN, "r", encoding="utf-8") as f:
        expected = f.read()
    assert _serialize(build_golden()) == expected


if __name__ == "__main__" and "--write" in sys.argv:
    from conftest import FrozenDateTime  # noqa: E402
    import extraction  # noqa: E402

    extraction.datetime = FrozenDateTime
    os.makedirs(os.path.dirname(GOLDEN), exist_ok=True)
    with open(GOLDEN, "w", encoding="utf-8", newline="\n") as f:
        f.write(_serialize(build_golden()))
    print(f"wrote {GOLDEN}")
