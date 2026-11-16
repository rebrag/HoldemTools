"""ArtifactRegistry: LRU budget, pinning, and CfrRegistry compatibility."""

import hashlib
import json
import os
import threading

from artifact_registry import ArtifactRegistry
from cfr_registry import CfrRegistry


def _write(reg, stacks, node, board, size):
    path = reg.path_for(stacks, node, board)
    with open(path, "wb") as f:
        f.write(b"x" * size)
    reg.touch(stacks, node, board)
    return path


def _set_access(reg, stacks, node, board, stamp):
    reg._entries[reg.key(stacks, node, board)]["last_access_utc"] = stamp


def test_cfr_filenames_are_unchanged(tmp_path):
    reg = CfrRegistry(str(tmp_path))
    digest = hashlib.sha1("25LJ_25BB|Root_pos=LJ|AhKd9c".encode()).hexdigest()[:10]
    assert reg.filename_for("25LJ_25BB", "Root_pos=LJ", "AhKd9c") == f"AhKd9c__{digest}.cfr"
    assert reg.registry_path == os.path.join(str(tmp_path), "registry.json")


def test_cfr_registry_reads_an_existing_registry_json(tmp_path):
    legacy = {"s|n|b": {"file": "b__x.cfr", "size": 5, "last_access_utc": "2025", "stacks": "s",
                        "node_name": "n", "board": "b"}}
    (tmp_path / "registry.json").write_text(json.dumps(legacy), encoding="utf-8")
    reg = CfrRegistry(str(tmp_path), max_gb=1)
    assert reg._entries == legacy


def test_extension_and_lookup(tmp_path):
    reg = ArtifactRegistry(str(tmp_path), max_gb=1, ext="hta")
    assert reg.filename_for("s", "n", "8d4c2c").endswith(".hta")
    assert reg.lookup("s", "n", "8d4c2c") is None
    path = _write(reg, "s", "n", "8d4c2c", 10)
    assert reg.lookup("s", "n", "8d4c2c") == path


def test_lru_eviction_order_and_budget(tmp_path):
    reg = ArtifactRegistry(str(tmp_path), max_gb=250 / 1024**3, ext=".hta")
    a = _write(reg, "s", "n", "A", 100)
    b = _write(reg, "s", "n", "B", 100)
    c = _write(reg, "s", "n", "C", 100)
    _set_access(reg, "s", "n", "A", "2026-01-03")
    _set_access(reg, "s", "n", "B", "2026-01-01")
    _set_access(reg, "s", "n", "C", "2026-01-02")
    evicted = reg.enforce_budget()
    assert [e["board"] for e in evicted] == ["B"]
    assert not os.path.exists(b) and os.path.exists(a) and os.path.exists(c)
    assert reg.enforce_budget() == []


def test_pinned_artifacts_are_never_evicted(tmp_path):
    reg = ArtifactRegistry(str(tmp_path), max_gb=150 / 1024**3, ext=".hta")
    a = _write(reg, "s", "n", "A", 100)
    b = _write(reg, "s", "n", "B", 100)
    _set_access(reg, "s", "n", "A", "2026-01-01")
    _set_access(reg, "s", "n", "B", "2026-01-02")
    key_a = reg.key("s", "n", "A")
    reg.pin(key_a)
    reg.pin(key_a)  # pins nest
    evicted = reg.enforce_budget()
    assert [e["board"] for e in evicted] == ["B"]
    assert os.path.exists(a)
    reg.unpin(key_a)
    assert reg.is_pinned(key_a)
    reg.unpin(key_a)
    assert not reg.is_pinned(key_a)
    with reg.pinned(key_a):
        assert reg.is_pinned(key_a)
    assert not reg.is_pinned(key_a)


def test_concurrent_touches_keep_every_entry(tmp_path):
    reg = ArtifactRegistry(str(tmp_path), max_gb=1, ext=".hta")
    boards = [f"B{i}" for i in range(40)]
    for b in boards:
        open(reg.path_for("s", "n", b), "wb").close()
    threads = [threading.Thread(target=reg.touch, args=("s", "n", b)) for b in boards]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    reloaded = ArtifactRegistry(str(tmp_path), max_gb=1, ext=".hta")
    assert len(reloaded._entries) == 40
