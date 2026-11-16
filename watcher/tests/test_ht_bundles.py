"""ht_bundles: dump-streets documents -> extraction.py's own schema-4 output."""

import json

import pytest

import extraction
import ht_bundles
from ht_bundles import CANONICAL_HANDS, street_to_walk
from ht_fakes import HANDS, METADATA, ROOT_POT, flop_street, turn_street, write_dump


def test_canonical_order_first_and_last():
    assert len(CANONICAL_HANDS) == 1326
    assert len(set(CANONICAL_HANDS)) == 1326
    assert CANONICAL_HANDS[0] == "AsAh"
    assert CANONICAL_HANDS[1] == "AsAd"
    assert CANONICAL_HANDS[-1] == "2d2c"


def test_canonical_positions_accept_either_card_order():
    assert ht_bundles.canonical_positions(["AsAh", "AhAs", "2d2c"]) == [0, 0, 1325]


def _bundle(seed="r:0", doc=None, root_weight=None):
    doc = doc or flop_street()
    views, meta = street_to_walk(doc, HANDS, root_pot=ROOT_POT, root_weight=root_weight)
    ctx = extraction.build_board_context(
        board="8d4c2c", cfr_file="", src_gametree_path="gametrees/2026/11/16/u/folder=400SB_400BTN/N.json",
        base_prefix="gametrees", stats={"ev_oop": 46.0}, tree_info={},
        alive_positions=["SB", "BTN"], acting_pos="SB",
    )
    return views, meta, extraction.build_street_bundle(seed, views, meta, ctx, CANONICAL_HANDS)


def test_meta_types_split_node_and_allin_runout():
    _views, meta, _ = _bundle()
    assert meta["r.0"] == {"type": "OOP_DEC", "street": "flop", "actions": ["c", "b50"], "extracted": True}
    assert meta["r.0.b50"]["type"] == "IP_DEC"
    # A deal with decisions below it opens the viewer's card picker ...
    assert meta["r.0.c.c"] == {"type": "SPLIT_NODE", "street": "flop", "extracted": False}
    # ... an all-in and call never does: it is where the hand ends.
    assert meta["r.0.b50.c"] == {"type": "terminal"}
    assert meta["r.0.b50.f"] == {"type": "terminal"}


def test_view_shape_matches_walk_street():
    views, _, _ = _bundle()
    v = views["r:0"]
    assert set(v) == {
        "node_id", "position", "node_type", "board", "pot", "flags", "street", "actions",
        "children", "strategy", "evs", "seats", "global_freq", "action_evs",
    }
    assert v["position"] == "OOP" and v["node_type"] == "OOP_DEC"
    assert v["pot"] == [0, 0, ROOT_POT]
    assert views["r:0:b50"]["pot"] == [50, 0, ROOT_POT]
    assert v["children"] == {"c": "r:0:c", "b50": "r:0:b50"}
    assert len(v["strategy"]) == 2 and all(len(r) == 1326 for r in v["strategy"])
    # A hand the actor does not hold plays 0.0, so it weighs nothing.
    assert v["strategy"][0][CANONICAL_HANDS.index("QsJs")] == 0.0
    for s in ("oop", "ip"):
        assert set(v["seats"][s]) == {"range", "equity", "matchups", "equity_total", "ev"}
        assert len(v["seats"][s]["range"]) == 1326


def test_bundle_combos_fixed_point_and_seat_stats():
    _views, _meta, bundle = _bundle()
    assert bundle["hand_order"] == CANONICAL_HANDS
    node = bundle["nodes"]["r.0"]
    combos = node["combos"]
    pos = {h: CANONICAL_HANDS.index(h) for h in HANDS}
    oop = combos["oop"]
    # Only held combos are emitted, indexed into the bundle's 1326 order.
    assert oop["idx"] == sorted([pos["AsAh"], pos["AdAc"], pos["KsKh"]])
    by_hand = {CANONICAL_HANDS[i]: k for k, i in enumerate(oop["idx"])}
    k = by_hand["AdAc"]
    assert oop["w"][k] == 500          # reach 0.5 per mille
    assert oop["eq"][k] == 330         # equity 0.33 per mille
    assert oop["ev"][k] == 1200        # EV 12.0 chips per cent
    assert oop["mu"][k] == 29800       # matchups 298.0 per cent
    assert combos["ip"]["idx"] == sorted([pos["QsJs"], pos["7h6h"], pos["AhKh"]])
    assert combos["actor"] == "oop"
    assert combos["strategy"][1][by_hand["AsAh"]] == 800
    assert combos["action_ev"][1][by_hand["KsKh"]] == 3100
    # Equity is present, so the viewer's Equity mode has data.
    oop_stats = node["seat_stats"]["oop"]
    assert oop_stats["combos"] == pytest.approx(1.75)
    expected_eq = (1.0 * 0.71 + 0.5 * 0.33 + 0.25 * 0.6) / 1.75
    assert oop_stats["equity"] == pytest.approx(expected_eq)
    assert node["seat_stats"]["ip"]["equity"] is not None


def test_169_matrix_is_reach_weighted():
    _views, _meta, bundle = _bundle()
    root = bundle["nodes"]["r.0"]["root_169"]
    aa = root["hand_classes"].index("AA")
    # AsAh (reach 1.0) checks 0.2, AdAc (reach 0.5) checks 0.8; the other
    # four AA combos are not held and must not dilute the mix.
    assert root["strategy"]["matrix"][0][aa] == pytest.approx((0.2 * 1.0 + 0.8 * 0.5) / 1.5)
    assert root["strategy"]["matrix"][1][aa] == pytest.approx((0.8 * 1.0 + 0.2 * 0.5) / 1.5)
    # A class neither seat holds has no EV, not a fabricated 0.
    t9 = root["hand_classes"].index("T9s")
    assert root["ev"]["oop"][t9] is None


def test_global_freq_relative_to_root():
    doc = flop_street()
    root_w = ht_bundles.root_pair_weight(doc, HANDS)
    assert root_w and root_w > 0
    views, _, _ = _bundle(root_weight=root_w)
    assert views["r:0"]["global_freq"] == pytest.approx(1.0)
    assert 0 < views["r:0:b50"]["global_freq"] < 1
    # Without the root mass the field is simply absent, never an error.
    views2, _, _ = _bundle(root_weight=None)
    assert views2["r:0"]["global_freq"] is None


def test_pair_weight_removes_shared_cards():
    a = {"idx": [0], "reach": [1.0]}          # AsAh
    b = {"idx": [5, 3], "reach": [1.0, 1.0]}  # AhKh shares the Ah; QsJs does not
    assert ht_bundles.pair_weight(a, b, HANDS) == pytest.approx(1.0)


def test_extract_from_dump_shapes_and_summary(tmp_path):
    out = str(tmp_path / "dump")
    dump = write_dump(out, [flop_street(), turn_street()])
    ex = ht_bundles.extract_from_dump(dump, out)
    assert set(ex["streets"]) == {"r:0", "r:0:c:c:Th"}
    assert ex["hand_order"] == CANONICAL_HANDS
    assert ex["effective_stack"] == 400
    assert ex["results"]["ev_oop"] == 46.0
    assert ex["results"]["exploitable"] == pytest.approx(0.2)   # NashConv / 2
    assert ex["root_weight"] > 0


def test_engine_block_contract():
    block = ht_bundles.engine_block(METADATA, watcher_id="m13001")
    assert block == {
        "solver": "htsolver", "version": "0.1.0", "build": "build-1", "config_hash": "abc123",
        "iterations": 640, "exploitable": pytest.approx(0.2), "watcher_id": "m13001",
    }


def test_run_dump_streets_builds_the_contract_command(tmp_path, monkeypatch):
    seen = {}

    class Done:
        returncode = 0
        stdout = stderr = ""

    def fake_run(cmd, **kw):
        seen["cmd"] = cmd
        write_dump(cmd[cmd.index("--out-dir") + 1], [flop_street()])
        return Done()

    monkeypatch.setattr(ht_bundles.subprocess, "run", fake_run)
    out = str(tmp_path / "d")
    doc = ht_bundles.run_dump_streets("engine.exe", "a.hta", out, seeds=["r:0:c:c:Th", "r:0:c:c:Ts"])
    assert seen["cmd"] == ["engine.exe", "dump-streets", "a.hta", "--out-dir", out,
                           "--seed", "r:0:c:c:Th", "--seed", "r:0:c:c:Ts", "--equity"]
    assert doc["hands"] == HANDS
    with pytest.raises(ValueError):
        ht_bundles.run_dump_streets("engine.exe", "a.hta", out)


def test_local_export_writes_the_library_layout(tmp_path, monkeypatch):
    out_root = tmp_path / "solutions"

    def fake_dump(exe, artifact, out_dir, **kw):
        return write_dump(out_dir, [flop_street(), turn_street()])

    monkeypatch.setattr(ht_bundles, "run_dump_streets", fake_dump)
    from ht_fakes import gametree_blob
    blob_file = tmp_path / "blob.json"
    blob_file.write_text(json.dumps(gametree_blob()), encoding="utf-8")
    entry = ht_bundles.export_local(
        "engine.exe", "a.hta", str(blob_file), str(out_root),
        gametree_path="gametrees/2026/11/16/u/folder=400SB_400BTN/Node.json")
    board_dir = out_root / "piosolutions" / "400SB_400BTN" / "Node" / "8d4c2c"
    manifest = json.loads((board_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["engine"]["solver"] == "htsolver"
    assert manifest["cfr"] == {"file": "", "available": False, "size_bytes": None}
    assert set(manifest["streets"]) == {"r.0", "r.0.c.c.Th"}
    assert (board_dir / "streets" / "r.0.json.gz").exists()
    assert entry["turn_streets"] == 1 and entry["solver"] == "htsolver"
