"""engine_proc: affinity parsing, the engine's error line, a pinned child."""

import os
import sys

import pytest

import engine_compare_watcher
import engine_proc


def test_parse_cpu_lists():
    assert engine_proc.parse_cpu_list("0-3,8,10-11") == [0, 1, 2, 3, 8, 10, 11]
    assert engine_proc.parse_slot_affinity("0-19;20-39")[1] == list(range(20, 40))
    assert engine_proc.parse_slot_affinity("") == []
    assert engine_proc.parse_slot_affinity("0-1;") == [[0, 1], None]
    with pytest.raises(ValueError):
        engine_proc.parse_cpu_list("a-b")


def test_engine_error_line():
    assert engine_proc.engine_error_line("loading\nerror: tree needs 31.2 GB, limit 24 GB\n") == \
        "tree needs 31.2 GB, limit 24 GB"
    assert engine_proc.engine_error_line("a\nlast words\n") == "last words"
    assert engine_proc.engine_error_line("") == ""


def test_compare_watcher_reexports_the_shared_helpers():
    assert engine_compare_watcher.run_streamed is engine_proc.run_streamed
    assert engine_compare_watcher.Cancellation is engine_proc.Cancellation


def test_pinned_child_runs_on_its_cpu():
    script = (
        "import os, sys\n"
        "print(sorted(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else 'n/a')\n"
    )
    out = engine_proc.run_streamed([sys.executable, "-c", script], timeout=30, prefix="aff", affinity=[0])
    assert out.returncode == 0
    if hasattr(os, "sched_getaffinity"):
        assert out.last_line() == "[0]"
