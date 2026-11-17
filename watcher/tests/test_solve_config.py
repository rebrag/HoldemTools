"""compose_solve_config / recorded_config / pinned_config and Settings."""

import pytest

from ht_fakes import ENGINE_TREE
from ht_solve_watcher import Settings, compose_solve_config, pinned_config, recorded_config


def _settings(tmp_path, **kw):
    return Settings(engine_exe="engine.exe", artifact_dir=str(tmp_path / "a"), work_dir=str(tmp_path / "w"), **kw)


def test_compose_exact_dict(tmp_path):
    s = _settings(tmp_path)
    cfg = compose_solve_config(ENGINE_TREE, artifact_path=r"C:\art\8d4c2c__x.hta", settings=s,
                               stop_file=r"C:\w\job-1\STOP")
    assert cfg == {
        **ENGINE_TREE,
        "algorithm": {"update": "dcfr", "recalc": {"enabled": True}},
        "isomorphism": True,
        "qre": {"mode": "nash"},
        "budget": {"iterations": 2000, "target_exploitable_pct": 0.2, "checkpoint_every": 25,
                   "max_seconds": 1500.0, "stop_file": "C:/w/job-1/STOP"},
        "memory_limit_gb": 24.0,
        "threads": 0,
        "output": {"path": "C:/art/8d4c2c__x.hta", "strategy_quantize_u8": False,
                   "ev_float32": True, "rollups_169": False},
    }


def test_compose_overrides_any_solver_knob_in_the_tree(tmp_path):
    tree = {**ENGINE_TREE, "budget": {"iterations": 10**9}, "output": {"path": "/etc/x"},
            "algorithm": {"family": "sampled"}, "threads": 99}
    cfg = compose_solve_config(tree, artifact_path="/a.hta", settings=_settings(tmp_path), threads=8)
    assert cfg["budget"]["iterations"] == 2000
    assert cfg["output"]["path"] == "/a.hta"
    assert cfg["algorithm"] == {"update": "dcfr", "recalc": {"enabled": True}}
    assert cfg["threads"] == 8
    assert "stop_file" not in cfg["budget"]
    assert ENGINE_TREE.get("budget") is None  # the input is never mutated


def test_recorded_config_drops_machine_local_keys(tmp_path):
    cfg = compose_solve_config(ENGINE_TREE, artifact_path="/a.hta", settings=_settings(tmp_path),
                               threads=8, stop_file="/w/STOP")
    rec = recorded_config(cfg)
    assert "threads" not in rec
    assert "path" not in rec["output"]
    assert "max_seconds" not in rec["budget"] and "stop_file" not in rec["budget"]
    assert rec["budget"]["iterations"] == 2000 and rec["memory_limit_gb"] == 24.0
    assert cfg["threads"] == 8 and cfg["output"]["path"] == "/a.hta"  # not mutated


def test_pinned_resolve_config(tmp_path):
    cfg = compose_solve_config(ENGINE_TREE, artifact_path="/a.hta", settings=_settings(tmp_path))
    record = {"config": recorded_config(cfg), "iterations_run": 640}
    pinned = pinned_config(record, artifact_path="/b.hta", threads=4, stop_file="/w/STOP")
    assert pinned["budget"] == {"iterations": 640, "target_exploitable_pct": 0, "checkpoint_every": 25,
                                "stop_file": "/w/STOP"}
    assert pinned["threads"] == 4
    assert pinned["output"]["path"] == "/b.hta"
    assert {k: v for k, v in pinned.items() if k not in ("budget", "threads", "output")} == {
        k: v for k, v in cfg.items() if k not in ("budget", "threads", "output")}


def test_settings_from_env_defaults_and_affinity(tmp_path):
    s = Settings.from_env({"HT_WORK_DIR": str(tmp_path), "HT_SOLVE_SLOTS": "2",
                           "HT_SLOT_AFFINITY": "0-3;4-7", "ENGINE_EXE": "e.exe"})
    assert s.artifact_max_gb == 200.0 and s.max_iterations == 2000 and s.checkpoint_every == 25
    assert s.accuracy_pot_pct == 0.2 and s.memory_limit_gb == 24.0 and s.solve_timeout_secs == 1800.0
    assert s.claim_poll_secs == 5.0 and s.upload_workers == 8
    assert s.noderequest_queue_name == "noderequests-htsolver"
    assert s.drain_file == str(tmp_path / "DRAIN")
    assert s.affinity_for_slot(1) == [4, 5, 6, 7]
    assert s.threads_for_slot(0) == 4  # auto threads on a pinned slot = its CPU count
    with pytest.raises(ValueError):
        Settings.from_env({"HT_WORK_DIR": str(tmp_path), "HT_SOLVE_SLOTS": "3", "HT_SLOT_AFFINITY": "0-3;4-7"})
