"""extraction.build_manifest's optional engine block and its round trip."""

import json

import extraction
import ht_bundles
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


def _meta(pct, target, reached=None):
    return {"solver_version": "0.1.0", "engine_build": "b", "config_hash": "h", "iterations": 575,
            "final_nashconv": 1.4, "final_exploitable_pct_pot": pct,
            "solved": {"target_exploitable_pct": target, "reached": reached,
                       "last_exploitable_pct_pot": pct}}


def test_engine_block_says_whether_the_solve_reached_its_target():
    short = ht_bundles.engine_block(_meta(0.227, 0.2, False), watcher_id="w")
    assert (short["converged"], short["exploitable_pct_pot"], short["target_exploitable_pct"]) == (
        False, 0.227, 0.2)
    assert short["exploitable"] == 0.7          # chips: nashconv / 2, unchanged
    # At the target counts as reached, the engine's own stopping rule.
    assert ht_bundles.engine_block(_meta(0.2, 0.2, True), watcher_id="w")["converged"] is True
    assert ht_bundles.engine_block(_meta(0.19, 0.2, True), watcher_id="w")["converged"] is True


def test_engine_block_makes_no_accuracy_claim_without_a_target_or_a_measurement():
    for meta in (_meta(0.227, None), _meta(0.227, 0), _meta(None, 0.2), _meta(float("nan"), 0.2),
                 {"solver_version": "0.1.0"}):
        block = ht_bundles.engine_block(meta, watcher_id="w")
        assert not {"converged", "exploitable_pct_pot", "target_exploitable_pct"} & set(block)


def test_a_pinned_resolve_is_measured_against_the_original_target():
    # No target of its own, same measurement (the engine is deterministic at
    # a fixed iteration count): the board's verdict must not change.
    pinned = _meta(0.227, None)
    assert ht_bundles.engine_block(pinned, watcher_id="w", target_pct=0.2)["converged"] is False
    assert ht_bundles.engine_block(_meta(0.19, None), watcher_id="w", target_pct=0.2)["converged"] is True
    # An absent or unusable override falls back to what the artifact says.
    for bad in (None, 0, float("nan")):
        assert ht_bundles.engine_block(_meta(0.227, 0.2), watcher_id="w", target_pct=bad)["converged"] is False


def test_pio_manifest_context_has_no_engine_key(frozen_time):
    ctx = extraction.context_from_manifest(build_golden()["manifest"], "x.cfr", {})
    assert "engine" not in ctx
    assert json.dumps(extraction.build_manifest(ctx, {}, cfr_size_bytes=1)).count('"engine"') == 0
