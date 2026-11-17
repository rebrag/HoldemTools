"""publish.BoardPublisher against a fake fs.

The Pio watcher's `publish_streets` closure was moved into publish.py. The
watcher itself cannot run here (it drives the PioViewer GUI), so equivalence
is proven against a verbatim copy of the closure's old body: both run the
same flop-then-full sequence on the same Pio-shaped extract, and every file
they write and every index entry they produce must be identical.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed

import adls_store
from adls_store import board_base_path, download_manifest, upload_manifest, upload_street_bundle
from extraction import build_board_context, build_manifest, build_street_bundle, node_id_to_suffix, street_entry
from ht_fakes import FakeFs
from publish import BoardPublisher
from test_extraction_golden import GAMETREE_PATH, _synthetic_pio_extract

BOARD = "QhJhTh"
CFR_SIZE = 987654


def _ctx_args():
    return dict(
        board=BOARD, cfr_file="QhJhTh__abc.cfr", src_gametree_path=GAMETREE_PATH, base_prefix="gametrees",
        tree_info={"Pot": "550"}, alive_positions=["UTG", "SB"], acting_pos="SB",
        preflop_line=["Root", "Call"], is_icm=False, seat_meta=None, hand_bb=2, chip_scale=10,
    )


def _legacy_publish(fs, stats, index_entries):
    """The body of the old closure, verbatim apart from returning the entry
    instead of calling upsert_library_index."""
    published_suffixes = set()

    def publish_streets(extract_like):
        merged_stats = {**stats, **{k: v for k, v in (extract_like.get("results") or {}).items() if v is not None}}
        ctx = build_board_context(stats=merged_stats, **{**_ctx_args(), "tree_info": extract_like["tree_info"]})
        stacks = ctx["stacks"] or "nostacks"
        node_name = ctx["node_name"] or "nonode"
        base = board_base_path(stacks, node_name, BOARD)
        ctx["effective_stack_chips"] = extract_like.get("effective_stack")
        root_view = (extract_like["streets"].get("r:0") or {}).get("views", {}).get("r:0")
        if root_view and root_view.get("pot"):
            ctx["pot_chips"] = root_view["pot"][-1]
        to_upload = []
        for seed_id, walk in extract_like["streets"].items():
            suffix = node_id_to_suffix(seed_id)
            if suffix in published_suffixes:
                continue
            bundle = build_street_bundle(seed_id, walk["views"], walk["nodes_meta"], ctx, extract_like["hand_order"])
            to_upload.append((suffix, walk, bundle))
        streets_map = {}
        if to_upload:
            with ThreadPoolExecutor(max_workers=8) as pool:
                futures = {pool.submit(upload_street_bundle, fs, base, bundle, None): (suffix, walk, bundle)
                           for suffix, walk, bundle in to_upload}
                for fut in as_completed(futures):
                    suffix, walk, bundle = futures[fut]
                    if fut.result():
                        streets_map[suffix] = street_entry(suffix, bundle["street"], len(walk["views"]))
                        published_suffixes.add(suffix)
        existing_manifest = download_manifest(fs, stacks, node_name, BOARD)
        manifest = build_manifest(ctx, streets_map, cfr_size_bytes=CFR_SIZE, existing=existing_manifest)
        upload_manifest(fs, base, manifest)
        turn_streets = sum(1 for e in manifest["streets"].values() if e.get("street") == "turn" and e.get("extracted"))
        flop_views = (extract_like["streets"].get("r:0") or {}).get("views") or {}
        index_entries.append({
            "stacks": stacks, "node_name": node_name, "board": BOARD,
            "preflop_line": ["Root", "Call"], "alive_positions": ctx["alive_positions"],
            "icm": ctx["is_icm"], "created_utc": ctx["created_utc"], "flop_nodes": len(flop_views),
            "turn_streets": turn_streets, "cfr_available": True,
        })

    return publish_streets


def _new_publisher(fs, stats):
    def build_ctx(extract_like):
        merged_stats = {**stats, **{k: v for k, v in (extract_like.get("results") or {}).items() if v is not None}}
        return build_board_context(stats=merged_stats, **{**_ctx_args(), "tree_info": extract_like["tree_info"]})

    return BoardPublisher(fs, board=BOARD, build_ctx=build_ctx, upload_workers=8,
                          cfr_size=lambda: CFR_SIZE, cfr_available=True)


def _flop_only(ex):
    return {**ex, "streets": {"r:0": ex["streets"]["r:0"]}}


def test_matches_the_old_closure_byte_for_byte(frozen_time):
    ex = _synthetic_pio_extract()
    stats = {"ev_oop": 1.0, "ev_ip": 2.0, "exploitable": 0.5}

    legacy_fs, legacy_entries = FakeFs(), []
    legacy = _legacy_publish(legacy_fs, stats, legacy_entries)
    legacy(_flop_only(ex))
    legacy(ex)

    new_fs = FakeFs()
    pub = _new_publisher(new_fs, stats)
    new_entries = [pub.publish(_flop_only(ex)), pub.publish(ex)]

    assert new_entries == legacy_entries
    assert new_fs.files == legacy_fs.files
    assert sorted(new_fs.uploads) == sorted(legacy_fs.uploads)


def test_flop_first_then_full_uploads_each_bundle_once(frozen_time):
    ex = _synthetic_pio_extract()
    fs = FakeFs()
    pub = _new_publisher(fs, {})
    base = board_base_path("750SB_2000UTG", "Root_Call_pos=SB_icm=0", BOARD)

    first = pub.publish(_flop_only(ex))
    assert first["flop_nodes"] == 2 and first["turn_streets"] == 0
    assert fs.json(f"{base}/manifest.json")["streets"].keys() == {"r.0"}

    second = pub.publish(ex)
    assert second["turn_streets"] == 1
    bundle_uploads = [p for p in fs.uploads if p.endswith(".json.gz")]
    assert sorted(bundle_uploads) == sorted([f"{base}/streets/r.0.json.gz",
                                             f"{base}/streets/r.0.b100.c.2c.json.gz"])
    assert fs.uploads.count(f"{base}/manifest.json") == 2
    assert set(fs.json(f"{base}/manifest.json")["streets"]) == {"r.0", "r.0.b100.c.2c"}


def test_merge_keeps_streets_extracted_earlier(frozen_time):
    ex = _synthetic_pio_extract()
    fs = FakeFs()
    base = board_base_path("750SB_2000UTG", "Root_Call_pos=SB_icm=0", BOARD)
    fs.put_json(f"{base}/manifest.json", {
        "created_utc": "2025-01-01T00:00:00+00:00",
        "streets": {"r.0.b100.c.2c.c.3d": {"street": "river", "extracted": True}},
    })
    _new_publisher(fs, {}).publish(ex)
    manifest = fs.json(f"{base}/manifest.json")
    assert "r.0.b100.c.2c.c.3d" in manifest["streets"]
    assert manifest["created_utc"] == "2025-01-01T00:00:00+00:00"


def test_engine_board_entry_and_manifest(frozen_time):
    ex = _synthetic_pio_extract()
    fs = FakeFs()
    pub = BoardPublisher(fs, board=BOARD,
                         build_ctx=lambda e: build_board_context(stats={}, **_ctx_args()),
                         engine={"solver": "htsolver", "version": "0.1.0"}, cfr_available=False)
    entry = pub.publish(ex)
    assert entry["cfr_available"] is False and entry["solver"] == "htsolver"
    assert pub.manifest["engine"]["solver"] == "htsolver"
    assert pub.manifest["cfr"]["available"] is False


def test_failed_bundle_upload_is_retried_next_pass(frozen_time, monkeypatch):
    ex = _synthetic_pio_extract()
    fs = FakeFs()
    pub = _new_publisher(fs, {})
    real = adls_store.upload_gzip_json
    calls = {"n": 0}

    def flaky(fs_, path, obj):
        calls["n"] += 1
        if calls["n"] == 1:
            return False
        return real(fs_, path, obj)

    monkeypatch.setattr(adls_store, "upload_gzip_json", flaky)
    pub.publish(_flop_only(ex))
    assert "r.0" not in pub.published_suffixes
    pub.publish(ex)
    assert {"r.0", "r.0.b100.c.2c"} <= pub.published_suffixes
