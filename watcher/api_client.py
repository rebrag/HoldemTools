"""HTTP client for the SolveJobs queue API (backend SolveJobsWatcherController).

Deliberately free of pywinauto/Azure imports so it runs on any machine - the
watcher-simulation tests drive this exact module against a local backend.

Env:
  HOLDEMTOOLS_API_BASE   e.g. https://<appservice>.azurewebsites.net (no trailing /)
  WATCHER_API_KEY        shared secret, must match the API's Watcher:ApiKey
  WATCHER_ID             defaults to the machine hostname
  WATCHER_HEARTBEAT_SECS keepalive cadence while a job is in flight (default 60)

Network errors are logged and swallowed: an API blip must never kill a
10-minute solve, and the server's claim-timeout window (5 min) absorbs a few
missed heartbeats.
"""

import os
import socket
import threading
from datetime import datetime
from typing import Any, Dict, Optional

import requests

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

TIMEOUT_SECS = 10.0


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _base() -> str:
    return (os.getenv("HOLDEMTOOLS_API_BASE") or "").rstrip("/")


def _key() -> str:
    return os.getenv("WATCHER_API_KEY") or ""


def watcher_id() -> str:
    return os.getenv("WATCHER_ID") or socket.gethostname()


def enabled() -> bool:
    """True when the queue API is configured (base URL + key present)."""
    return bool(_base() and _key())


def _headers() -> Dict[str, str]:
    return {"X-Watcher-Key": _key()}


def claim_next() -> Optional[Dict[str, Any]]:
    """Atomically claim the next queued job. None when the queue is empty or
    the API is unreachable."""
    try:
        resp = requests.post(
            f"{_base()}/api/solvejobs/claim",
            json={"watcherId": watcher_id()},
            headers=_headers(),
            timeout=TIMEOUT_SECS,
        )
        if resp.status_code == 204:
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log(f"  [queue] claim failed: {e}")
        return None


def report(
    job_id: str,
    status: Optional[str] = None,
    error: Optional[str] = None,
    heartbeat: bool = False,
    result: Optional[Dict[str, Any]] = None,
) -> bool:
    """Report a status transition, failure, or keepalive for a claimed job.
    `result` may carry {stacks, node_name, board} on Done."""
    body: Dict[str, Any] = {"watcherId": watcher_id(), "heartbeat": heartbeat}
    if status is not None:
        body["status"] = status
    if error is not None:
        body["error"] = error[:2000]
    if result:
        if result.get("stacks"):
            body["resultStacks"] = result["stacks"]
        if result.get("node_name"):
            body["resultNodeName"] = result["node_name"]
        if result.get("board"):
            body["board"] = result["board"]
    try:
        resp = requests.patch(
            f"{_base()}/api/solvejobs/{job_id}",
            json=body,
            headers=_headers(),
            timeout=TIMEOUT_SECS,
        )
        if resp.status_code == 409:
            # The server requeued this job (stale claim) or it is terminal;
            # this claimer's reports are no longer welcome.
            log(f"  [queue] report rejected for {job_id}: {resp.text}")
            return False
        resp.raise_for_status()
        return True
    except Exception as e:
        log(f"  [queue] report failed for {job_id}: {e}")
        return False


class Heartbeat:
    """Context manager: a daemon thread posting keepalives while a job runs,
    so the server's stale-claim sweep leaves it alone."""

    def __init__(self, job_id: str, interval_secs: Optional[float] = None):
        self.job_id = job_id
        self.interval = interval_secs or float(os.getenv("WATCHER_HEARTBEAT_SECS", "60"))
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            report(self.job_id, heartbeat=True)

    def __enter__(self) -> "Heartbeat":
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
