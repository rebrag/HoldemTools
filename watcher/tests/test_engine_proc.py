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


def test_parse_progress_line():
    parsed = engine_proc.parse_progress_line(
        "iter 150  nashconv 2.79  exploitable 1.395 (0.45% of pot)  ev 152.1 157.9  elapsed 96.4 s")
    assert parsed == {"iteration": 150, "exploitable_pct": 0.45, "elapsed_secs": 96.4}
    # The stream's default formatting goes scientific on a tight solve.
    assert engine_proc.parse_progress_line(
        "iter 2000  nashconv 4e-05  exploitable 2e-05 (6.4e-06% of pot)  ev 1 2  elapsed 1e+03 s"
    ) == {"iteration": 2000, "exploitable_pct": 6.4e-06, "elapsed_secs": 1000.0}
    # An engine from before the elapsed suffix still reports its accuracy.
    assert engine_proc.parse_progress_line(
        "iter 25  nashconv 9.6  exploitable 4.8 (4.8% of pot)  ev 44 56"
    ) == {"iteration": 25, "exploitable_pct": 4.8, "elapsed_secs": None}
    # Not progress toward an accuracy target: no measurement, a zero pot, a
    # number that is not one, and the lines around the loop.
    for line in ("iter 150", "iter 150  nashconv 2.79  exploitable 1.395  ev 1 2  elapsed 3 s",
                 "iter 150  nashconv nan  exploitable nan (nan% of pot)  ev 1 2  elapsed 3 s",
                 "target_exploitable_pct reached", "solve id abc123", ""):
        assert engine_proc.parse_progress_line(line) is None


def test_on_line_sees_each_line_and_cannot_break_the_child(capsys):
    script = "print('one', flush=True); print(); print('two', flush=True)"
    seen = []
    out = engine_proc.run_streamed([sys.executable, "-c", script], timeout=30, prefix="t",
                                   on_line=seen.append)
    assert out.returncode == 0 and seen == ["one", "two"]

    def boom(line):
        raise RuntimeError("report failed")

    out = engine_proc.run_streamed([sys.executable, "-c", script], timeout=30, prefix="t", on_line=boom)
    assert out.returncode == 0 and out.last_line() == "two"
    assert capsys.readouterr().out.count("line callback failed") == 1


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
