"""Tests for the compare watcher's cancel path. Run directly: python test_cancel.py

Stopping a solve is a three-party protocol - the owner presses Stop, the API
records it, the watcher acts on it - and the pieces here are the watcher's:
how a report response becomes a decision, and what `run_streamed` does to a
child that cooperates versus one that ignores it. The API half is covered by
backend/Tests/EngineCompareJobsTests.cs; a real engine solve stopping and
resuming is covered by engine/tests plus the measured run in the PR.

Stdlib only, no framework, exits non-zero on the first failure - same shape as
test_htc_format.py.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The module reaches for these at import time; nothing here contacts an API.
os.environ.setdefault("HOLDEMTOOLS_API_BASE", "http://localhost:1")
os.environ.setdefault("WATCHER_API_KEY", "unused")

from engine_compare_watcher import (  # noqa: E402
    Cancellation, run_streamed, terminal_status,
)

failures = 0


def check(ok: bool, what: str) -> None:
    global failures
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        failures += 1


def test_observe() -> None:
    print("Cancellation.observe")

    c = Cancellation()
    c.observe({"ok": True, "status": "Running", "cancelRequested": False})
    check(not c.requested.is_set(), "a normal heartbeat does not stop the solve")

    c.observe({"ok": True, "status": "Running", "cancelRequested": True})
    check(c.requested.is_set(), "cancelRequested stops the solve")
    check(not c.disowned, "a cancel is still our job to finish and upload")

    # A failed PATCH must not read as a cancel: the network dropping a
    # response would otherwise kill a solve nobody asked to stop.
    c2 = Cancellation()
    c2.observe(None)
    check(not c2.requested.is_set(), "a failed report is not a cancel")

    # 409 means the row is no longer ours - stop, and do not report.
    c3 = Cancellation()
    c3.observe({"conflict": True})
    check(c3.requested.is_set() and c3.disowned, "a 409 stops the solve and disowns it")


def test_terminal_status() -> None:
    print("terminal_status")

    c = Cancellation()
    check(terminal_status(c) == "Done", "an untouched solve finishes Done")

    c.requested.set()
    check(terminal_status(c) == "Done",
          "Stop pressed after the solver finished still reports Done")

    c.applied = True
    check(terminal_status(c) == "Cancelled",
          "a solve actually cut short reports Cancelled")


def _child(script: str) -> list:
    return [sys.executable, "-u", "-c", script]


def test_cooperative_child_is_not_killed() -> None:
    print("run_streamed: a child that honours the stop file")

    with tempfile.TemporaryDirectory() as run_dir:
        stop = os.path.join(run_dir, "STOP")
        # Stands in for the engine: works until the file appears, then spends a
        # moment "writing its artifact" and exits 0 of its own accord.
        script = (
            "import os,sys,time\n"
            f"stop={stop!r}\n"
            "while not os.path.exists(stop):\n"
            "    time.sleep(0.05)\n"
            "print('stopping cleanly')\n"
            "time.sleep(0.4)\n"
            "print('wrote artifact')\n"
        )
        cancel = Cancellation()
        threading.Timer(0.5, cancel.requested.set).start()
        t0 = time.perf_counter()
        out = run_streamed(_child(script), timeout=30, prefix="fake", cancel=cancel,
                           on_cancel=lambda: open(stop, "w").close(),
                           cancel_grace=10)
        elapsed = time.perf_counter() - t0

    check(cancel.applied, "the cancel is recorded as applied")
    check(out.returncode == 0, f"the child exits on its own terms (got {out.returncode})")
    check("wrote artifact" in out.text, "its post-stop work completed")
    check(elapsed < 5, f"and it was not made to wait out the grace ({elapsed:.1f}s)")


def test_stubborn_child_is_killed_after_the_grace() -> None:
    print("run_streamed: a child that ignores the stop file")

    with tempfile.TemporaryDirectory() as run_dir:
        stop = os.path.join(run_dir, "STOP")
        script = "import time\nwhile True:\n    time.sleep(0.05)\n"
        cancel = Cancellation()
        cancel.requested.set()
        t0 = time.perf_counter()
        out = run_streamed(_child(script), timeout=60, prefix="fake", cancel=cancel,
                           on_cancel=lambda: open(stop, "w").close(),
                           cancel_grace=1.5)
        elapsed = time.perf_counter() - t0

    # The grace is a bound, not a promise: past it the process is killed, which
    # is what keeps one wedged solve from holding the watcher forever.
    check(out.returncode != 0, "the child is killed rather than waited on")
    check(1.5 <= elapsed < 8, f"killed at about the grace ({elapsed:.1f}s)")
    check(os.path.exists(stop) is False, "the run directory is gone with the temp dir")


def test_uncancelled_child_is_untouched() -> None:
    print("run_streamed: no cancel")

    cancel = Cancellation()
    out = run_streamed(_child("print('done')"), timeout=30, prefix="fake", cancel=cancel)
    check(out.returncode == 0, "a normal run still exits 0")
    check("done" in out.text, "its output is still captured")
    check(not cancel.applied, "and nothing is marked cancelled")


def test_timeout_still_raises() -> None:
    print("run_streamed: the hang backstop survives")

    cancel = Cancellation()  # never set
    try:
        run_streamed(_child("import time\nwhile True: time.sleep(0.05)\n"),
                     timeout=1.0, prefix="fake", cancel=cancel)
        check(False, "a hung child raises TimeoutExpired")
    except subprocess.TimeoutExpired:
        check(True, "a hung child raises TimeoutExpired")


if __name__ == "__main__":
    test_observe()
    test_terminal_status()
    test_cooperative_child_is_not_killed()
    test_stubborn_child_is_killed_after_the_grace()
    test_uncancelled_child_is_untouched()
    test_timeout_still_raises()
    print("\n" + ("FAILED" if failures else "all cancel tests passed"))
    sys.exit(1 if failures else 0)
