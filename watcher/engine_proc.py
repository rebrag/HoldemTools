"""Engine child-process helpers shared by the htsolver watchers.

Moved out of engine_compare_watcher.py so the compare watcher and the
SolveJobs worker (ht_solve_watcher.py) run engine.exe the same way: output
streamed to the terminal as it arrives, a bounded tail kept for error
messages, a hard deadline that holds even for a silent child, and a
cooperative stop (the engine's `budget.stop_file`) before any kill.

Stdlib only: no Azure, no requests, no GUI.
"""

from __future__ import annotations

import ctypes
import math
import os
import re
import subprocess
import sys
import threading
import time
from collections import deque
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Sequence


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


class Cancelled(Exception):
    """The solve stopped before it had anything to save. Not a failure."""


class Cancellation:
    """An owner-requested stop, shared between the heartbeat thread and the solve.

    Three facts rather than one flag, because they lead to different endings:
      requested  the owner pressed Stop. Ask the engine to stop cleanly.
      applied    the engine was actually asked (the stop file exists), so the
                 solve on disk is a stopped one and the job ends Cancelled. A
                 Stop that arrives after the solver already finished leaves
                 this false and the job ends Done, which is what happened.
      disowned   the API says this job is not ours any more (409). Stop
                 working, and do not report - the report would 409 too.
    """

    def __init__(self) -> None:
        self.requested = threading.Event()
        self.applied = False
        self.disowned = False

    def observe(self, resp: Optional[Dict[str, Any]]) -> None:
        """Fold one report response into this state."""
        if not resp:
            return
        if resp.get("conflict"):
            self.disowned = True
            self.requested.set()
        elif resp.get("cancelRequested"):
            self.requested.set()


class ChildResult:
    """What a streamed child produced: its exit code and a bounded tail."""

    def __init__(self, returncode: int, tail: Sequence[str]) -> None:
        self.returncode = returncode
        self.tail: List[str] = list(tail)

    @property
    def text(self) -> str:
        return "\n".join(self.tail)

    def last_line(self) -> str:
        for line in reversed(self.tail):
            if line.strip():
                return line.strip()
        return ""


# =========================
# CPU affinity
# =========================
def parse_cpu_list(spec: str) -> List[int]:
    """'0-3,8,10-11' -> [0, 1, 2, 3, 8, 10, 11]."""
    cpus: List[int] = []
    for part in (spec or "").split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, hi = part.split("-", 1)
            cpus.extend(range(int(lo), int(hi) + 1))
        else:
            cpus.append(int(part))
    if any(c < 0 for c in cpus):
        raise ValueError(f"negative CPU in {spec!r}")
    return sorted(set(cpus))


def parse_slot_affinity(spec: Optional[str]) -> List[Optional[List[int]]]:
    """'0-19;20-39' -> [[0..19], [20..39]]; an empty segment means no pinning
    for that slot."""
    if not spec or not spec.strip():
        return []
    return [parse_cpu_list(seg) or None for seg in spec.split(";")]


def set_process_affinity(pid: int, cpus: Sequence[int]) -> None:
    """Pin a running process to `cpus`.

    Windows: SetProcessAffinityMask, which constrains every thread of the
    process including ones already started. It addresses one processor group
    (64 logical CPUs), so CPU numbers are group-relative there.
    Elsewhere: os.sched_setaffinity, which affects the given thread only; the
    POSIX path therefore prefers `affinity_preexec`, applied before exec so
    every engine thread inherits it.
    """
    if not cpus:
        return
    if sys.platform == "win32":
        mask = 0
        for c in cpus:
            if c >= 64:
                raise ValueError("SetProcessAffinityMask addresses CPUs 0-63 of one group")
            mask |= 1 << c
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        PROCESS_SET_INFORMATION = 0x0200
        PROCESS_QUERY_INFORMATION = 0x0400
        kernel32.OpenProcess.restype = ctypes.c_void_p
        handle = kernel32.OpenProcess(
            PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION, False, pid)
        if not handle:
            raise OSError(ctypes.get_last_error(), "OpenProcess failed")
        try:
            kernel32.SetProcessAffinityMask.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
            if not kernel32.SetProcessAffinityMask(handle, mask):
                raise OSError(ctypes.get_last_error(), "SetProcessAffinityMask failed")
        finally:
            kernel32.CloseHandle(ctypes.c_void_p(handle))
    else:
        os.sched_setaffinity(pid, set(cpus))  # type: ignore[attr-defined]


def affinity_preexec(cpus: Optional[Sequence[int]]) -> Optional[Callable[[], None]]:
    """A Popen preexec_fn pinning the child before exec (POSIX only)."""
    if not cpus or sys.platform == "win32":
        return None
    cpu_set = set(cpus)
    return lambda: os.sched_setaffinity(0, cpu_set)  # type: ignore[attr-defined]


# =========================
# Streamed child
# =========================
def run_streamed(cmd: Sequence[str], *, timeout: float, prefix: str,
                 cwd: Optional[str] = None, tail_lines: int = 60,
                 cancel: Optional[Cancellation] = None,
                 on_cancel: Optional[Callable[[], None]] = None,
                 cancel_grace: float = 0.0,
                 affinity: Optional[Sequence[int]] = None,
                 on_line: Optional[Callable[[str], None]] = None) -> ChildResult:
    """Run a child, printing its output AS IT ARRIVES, and keep a bounded tail.

    subprocess.run(capture_output=True) only drains the pipes once the child
    has exited, so a solve that takes ten minutes produced ten minutes of
    silence in this terminal and then one summary line - even though htsolver
    prints a progress line every `budget.checkpoint_every` iterations the whole
    way through. Streaming is the only change needed to surface it; nothing in
    the engine had to be touched.

    The tail is still retained because the failure path needs it for the
    RuntimeError message and the success path wants the last line, so this
    tees rather than simply inheriting stdout.

    The pipe is drained on a THREAD rather than in this one, so the deadline is
    enforced by proc.wait() no matter what the child does. Reading inline looks
    simpler and is wrong: a child that produces no output blocks the readline
    loop until it exits on its own, so a hung solve would never be killed - the
    exact guarantee subprocess.run(timeout=...) was giving before.

    `cancel` makes the child stoppable mid-run. When it fires, `on_cancel` is
    called once (the engine's stop file gets created there) and the child is
    given `cancel_grace` seconds to finish the way it wants to - writing its
    checkpoint and artifact - before being killed. A child with no cooperative
    stop passes no on_cancel and a grace of 0, and is simply killed.

    `affinity` pins the child to a CPU list (one solve slot per NUMA node).

    `on_line` is handed every non-empty line as it arrives, on the reader
    thread. It is how a solve's progress leaves this process while the solve
    is still running. An exception in it is logged once and never reaches the
    child: a progress report must not be able to cost a solve.
    """
    proc = subprocess.Popen(
        list(cmd), cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1, preexec_fn=affinity_preexec(affinity),
    )
    if affinity and sys.platform == "win32":
        try:
            set_process_affinity(proc.pid, affinity)
        except OSError as e:
            log(f"  {prefix}: could not set CPU affinity ({e}); running unpinned")
    tail: deque = deque(maxlen=tail_lines)
    on_line_failed = False

    def drain() -> None:
        nonlocal on_line_failed
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip("\n")
            tail.append(line)
            if not line.strip():
                continue
            print(f"    {prefix}| {line}", flush=True)
            if on_line is not None:
                try:
                    on_line(line)
                except Exception as e:  # noqa: BLE001 - see the docstring
                    if not on_line_failed:
                        on_line_failed = True
                        log(f"  {prefix}: line callback failed ({e}); the solve continues")

    reader = threading.Thread(target=drain, name=f"{prefix}-stdout", daemon=True)
    reader.start()
    deadline = time.monotonic() + timeout
    kill_at: Optional[float] = None       # set once a cancel starts its grace
    try:
        while True:
            try:
                proc.wait(timeout=0.5)
                break
            except subprocess.TimeoutExpired:
                pass
            now = time.monotonic()
            if cancel is not None and cancel.requested.is_set() and kill_at is None:
                # Recorded here rather than in on_cancel, so it means the same
                # thing for a child that stops cooperatively and one that is
                # simply killed: this run was cut short by the owner.
                cancel.applied = True
                if on_cancel is not None:
                    on_cancel()
                kill_at = now + cancel_grace
                if cancel_grace > 0:
                    log(f"  cancel requested - asked {prefix} to stop cleanly "
                        f"(up to {cancel_grace:.0f}s to write its results)")
            if kill_at is not None and now >= kill_at:
                if cancel_grace > 0:
                    log(f"  {prefix} did not stop within the grace period; killing it")
                proc.kill()
                proc.wait()
                reader.join(timeout=5)
                return ChildResult(proc.returncode, tail)
            if now >= deadline:
                raise subprocess.TimeoutExpired(list(cmd), timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        reader.join(timeout=5)
        raise
    # The child is gone; let the reader finish whatever is still buffered.
    reader.join(timeout=10)
    if proc.stdout is not None:
        proc.stdout.close()
    return ChildResult(proc.returncode, tail)


# The engine's per-checkpoint line (engine/src/main.cpp):
#   iter 150  nashconv 2.79  exploitable 1.395 (0.45% of pot)  ev 152.1 157.9  elapsed 96.4 s
# Only the vectorized core with an exact best response prints the bracket, so
# a line without it (a sampled solve, `iter 150` alone) is not progress toward
# an accuracy target and parses to None.
_PROGRESS_RE = re.compile(
    r"^iter\s+(?P<iter>\d+)\s+nashconv\s+\S+\s+exploitable\s+\S+\s+"
    r"\((?P<pct>[-+0-9.eE]+|nan|inf|-inf)% of pot\)"
    r"(?:.*?\s+elapsed\s+(?P<elapsed>[-+0-9.eE]+)\s+s)?"
)


def parse_progress_line(line: str) -> Optional[Dict[str, Any]]:
    """`{iteration, exploitable_pct, elapsed_secs}` out of one engine progress
    line, or None when the line is not one. `elapsed_secs` is None on an
    engine old enough not to print it."""
    m = _PROGRESS_RE.match((line or "").strip())
    if not m:
        return None
    try:
        pct = float(m.group("pct"))
        elapsed = float(m.group("elapsed")) if m.group("elapsed") else None
    except ValueError:
        return None
    if not math.isfinite(pct) or pct < 0:
        return None
    if elapsed is not None and not math.isfinite(elapsed):
        elapsed = None
    return {"iteration": int(m.group("iter")), "exploitable_pct": pct, "elapsed_secs": elapsed}


def engine_error_line(text: str) -> str:
    """The engine's own `error: ...` line out of a child's output, or the
    last non-empty line when it printed none."""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    for ln in lines:
        if ln.startswith("error:"):
            return ln[len("error:"):].strip()
    return lines[-1] if lines else ""
