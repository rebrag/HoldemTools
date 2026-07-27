r"""Smoke test: extract street bundles from a locally solved .cfr and validate
the v3 shapes without touching ADLS.

Usage: python test_flop_walk.py [path\to\file.cfr] [--no-turns]
Defaults to the newest registry-tracked .cfr in C:\PioSOLVER\Solved.
"""

import glob
import os
import sys

from extraction import (
    CHANCE_TYPE,
    build_board_context,
    build_manifest,
    build_street_bundle,
    extract_board,
    node_id_to_suffix,
    street_entry,
)

PIO_DIR = os.getenv("PIO_DIR_FOR_PYOSOLVER", r"C:\PioSOLVER")
SOLVED_DIR = os.path.join(PIO_DIR, "Solved")


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    turns = "--no-turns" not in sys.argv

    if args:
        cfr = args[0]
    else:
        candidates = sorted(
            glob.glob(os.path.join(SOLVED_DIR, "*__*.cfr")), key=os.path.getmtime
        )
        if not candidates:
            print(f"No registry-named .cfr files in {SOLVED_DIR}")
            return 1
        cfr = candidates[-1]

    print(f"Using CFR: {cfr} (turn precompute: {turns})")
    extract = extract_board(cfr, PIO_DIR, turn_precompute=turns)
    assert extract is not None, "extract_board returned None"
    assert len(extract["hand_order"]) == 1326

    streets = extract["streets"]
    flop = streets.get("r:0")
    assert flop and "r:0" in flop["views"], "flop street/root missing"

    flop_chance = [
        s for s, m in flop["nodes_meta"].items() if m.get("type") == CHANCE_TYPE
    ]
    print(f"\nFlop: {len(flop['views'])} decision node(s), {len(flop_chance)} chance node(s)")

    if turns:
        turn_seeds = [k for k in streets if k != "r:0"]
        print(f"Turn streets extracted: {len(turn_seeds)}")
        assert flop_chance, "flop should end in turn deals"
        # every flop chance node should yield ~49 turn streets (>=45 allows quirks)
        for chance_suffix in flop_chance:
            prefix = chance_suffix.replace(".", ":") + ":"
            count = sum(1 for k in turn_seeds if k.startswith(prefix))
            print(f"  {chance_suffix}: {count} turn card(s)")
            assert count >= 45, f"{chance_suffix}: only {count} turn streets"
        sample_turn = streets[turn_seeds[0]]
        sample_view = sample_turn["views"][turn_seeds[0]]
        assert sample_view["street"] == "turn", sample_view["street"]
        assert len(sample_view["board"]) == 4

    board = os.path.basename(cfr).split("__")[0].replace(".cfr", "")
    ctx = build_board_context(
        board=board,
        cfr_file=os.path.basename(cfr),
        src_gametree_path="gametrees/2026/07/24/anon/folder=TEST_STACKS/testnode.json",
        base_prefix="gametrees",
        stats={"ev_oop": 1.0, "ev_ip": 2.0, "exploitable": 0.5},
        tree_info=extract["tree_info"],
        alive_positions=["SB", "BB"],
        acting_pos="BB",
        preflop_line=["Root", "Call"],
    )

    streets_map = {}
    for seed_id, walk in streets.items():
        bundle = build_street_bundle(
            seed_id, walk["views"], walk["nodes_meta"], ctx, extract["hand_order"]
        )
        assert bundle["schema"] == 3 and bundle["kind"] == "street_bundle"
        assert bundle["seed_suffix"] == node_id_to_suffix(seed_id)
        assert set(bundle["nodes"]) <= set(bundle["meta"]), seed_id
        for suffix, doc in bundle["nodes"].items():
            assert doc["schema"] == 3
            assert len(doc["root_169"]["hand_classes"]) == 169, f"{seed_id}/{suffix}"
            assert "tree_info" not in doc and "source" not in doc  # slimmed
            for lbl, hand_map in doc["actions"].items():
                assert len(hand_map) == 169, f"{suffix}/{lbl}"
        streets_map[bundle["seed_suffix"]] = street_entry(
            bundle["seed_suffix"], bundle["street"], len(walk["views"])
        )

    # Root per-action EVs must differ between actions (v2 regression check)
    root_bundle_doc = build_street_bundle(
        "r:0", flop["views"], flop["nodes_meta"], ctx, extract["hand_order"]
    )["nodes"]["r.0"]
    acts = list(root_bundle_doc["actions"].keys())
    if len(acts) >= 2:
        a, b = acts[0], acts[1]
        diffs = sum(
            1
            for cls in root_bundle_doc["root_169"]["hand_classes"]
            if root_bundle_doc["actions"][a][cls][1] is not None
            and root_bundle_doc["actions"][b][cls][1] is not None
            and abs(root_bundle_doc["actions"][a][cls][1] - root_bundle_doc["actions"][b][cls][1]) > 1e-9
        )
        print(f"Root per-action EVs differ for {diffs}/169 classes ({a} vs {b})")
        assert diffs > 0, "per-action EVs identical - child EV wiring broken?"

    manifest = build_manifest(ctx, streets_map, cfr_size_bytes=os.path.getsize(cfr))
    assert manifest["schema"] == 3
    assert "nodes" not in manifest
    assert set(manifest["streets"]) == set(streets_map)
    assert manifest["seats"]["oop"] == "SB" and manifest["seats"]["ip"] == "BB"
    print(f"\nManifest: {len(manifest['streets'])} street(s), seats={manifest['seats']}")
    print("All bundles validated OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
