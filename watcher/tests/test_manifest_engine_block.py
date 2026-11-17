"""extraction.build_manifest's optional engine block and its round trip."""

import json

import extraction
from test_extraction_golden import build_golden


def test_engine_block_replaces_the_cfr_claim(frozen_time):
    golden = build_golden()
    ctx = extraction.context_from_manifest(golden["manifest"], "x.cfr", {})
    engine = {"solver": "htsolver", "version": "0.1.0", "config_hash": "h", "iterations": 9,
              "exploitable": 0.1, "watcher_id": "w"}
    m = extraction.build_manifest(ctx, {}, cfr_size_bytes=123, existing=golden["manifest"], engine=engine)
    assert m["engine"] == engine
    assert m["cfr"] == {"file": "", "available": False, "size_bytes": None}
    keys = list(m)
    assert keys.index("engine") == keys.index("cfr") - 1
    # Everything else is the Pio manifest's own.
    pio = extraction.build_manifest(ctx, {}, cfr_size_bytes=123, existing=golden["manifest"])
    assert {k: v for k, v in m.items() if k not in ("engine", "cfr")} == {
        k: v for k, v in pio.items() if k != "cfr"}


def test_context_from_manifest_round_trips_the_engine_block(frozen_time):
    golden = build_golden()
    ctx = extraction.context_from_manifest(golden["manifest"], "x.cfr", {})
    engine = {"solver": "htsolver", "version": "0.1.0"}
    m = extraction.build_manifest(ctx, {}, cfr_size_bytes=None, engine=engine)
    m2 = extraction.build_manifest(extraction.context_from_manifest(m, "", {}), {}, cfr_size_bytes=None,
                                   existing=m)
    assert m2["engine"] == engine
    assert m2["cfr"]["available"] is False


def test_pio_manifest_context_has_no_engine_key(frozen_time):
    ctx = extraction.context_from_manifest(build_golden()["manifest"], "x.cfr", {})
    assert "engine" not in ctx
    assert json.dumps(extraction.build_manifest(ctx, {}, cfr_size_bytes=1)).count('"engine"') == 0
