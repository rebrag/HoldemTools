"""HTTP client for the SolveJobs queue API (backend SolveJobsWatcherController).

Deliberately free of pywinauto/Azure imports so it runs on any machine - the
watcher-simulation tests drive this exact module against a local backend, and
the headless htsolver worker (ht_solve_watcher.py) uses it unchanged.

Env:
  HOLDEMTOOLS_API_BASE   e.g. https://<appservice>.azurewebsites.net (no trailing /)
  WATCHER_API_KEY        shared secret, must match the API's Watcher:ApiKey
  WATCHER_ID             defaults to the machine hostname
  WATCHER_HEARTBEAT_SECS keepalive cadence while a job is in flight (default 60)
  WATCHER_TERMINAL_RETRY_SECS  how long a Done/Failed report keeps retrying (default 300)

Network errors are logged and swallowed: an API blip must never kill a
10-minute solve, and the server's claim-timeout window (5 min) absorbs a few
missed heartbeats. Terminal reports are the exception that retries: losing a
Done would leave a finished board looking stuck until the stale sweep fails it.
"""

import os
import socket
import threading
import time
from datetime import datetime
from typing import Any, Dict, Optional

import requests

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

TIMEOUT_SECS = 10.0
TERMINAL_STATUSES = ("Done", "Failed")

# Seams for the tests: an object with requests' post/patch, and the sleep the
# terminal-report backoff uses.
_http: Any = requests
_sleep = time.sleep

# Claim routes per solver. The Pio watcher keeps the original, unfiltered-by-
# name route (the API hard-wires it to Pio jobs); every other solver has its
# own, so an old Pio watcher can never pop an htsolver job.
CLAIM_ROUTES = {
    "pio": "/api/solvejobs/claim",
    "htsolver": "/api/solvejobs/claim/htsolver",
}

_last_missing_route_log: Dict[str, float] = {}
MISSING_ROUTE_LOG_SECS = 600.0


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


def claim_next(solver: str = "pio") -> Optional[Dict[str, Any]]:
    """Atomically claim the next queued job for `solver`. None when the queue
    is empty or the API is unreachable.

    A 404 on a non-Pio route means the API predates that route: this worker is
    newer than the server it talks to. That is logged plainly (every ten
    minutes, not every poll) and treated as an empty queue - never as a reason
    to fall back to the Pio route, which would pop Pio's jobs.
    """
    route = CLAIM_ROUTES.get(solver)
    if route is None:
        raise ValueError(f"unknown solver {solver!r}")
    try:
        resp = _http.post(
            f"{_base()}{route}",
            json={"watcherId": watcher_id()},
            headers=_headers(),
            timeout=TIMEOUT_SECS,
        )
        if resp.status_code == 204:
            return None
        if resp.status_code == 404 and solver != "pio":
            now = time.monotonic()
            last = _last_missing_route_log.get(solver)
            if last is None or now - last >= MISSING_ROUTE_LOG_SECS:
                _last_missing_route_log[solver] = now
                log(
                    f"  [queue] {route} returned 404: the API at {_base()} has no "
                    f"{solver} claim route yet (deploy the backend first). "
                    "Treating it as an empty queue."
                )
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log(f"  [queue] claim failed: {e}")
        return None


def _report_body(
    status: Optional[str],
    error: Optional[str],
    heartbeat: bool,
    result: Optional[Dict[str, Any]],
    index_entry: Optional[Dict[str, Any]],
    progress: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {"watcherId": watcher_id(), "heartbeat": heartbeat}
    if progress and progress.get("iteration") is not None and progress.get("exploitable_pct") is not None:
        body["progress"] = {
            "iteration": int(progress["iteration"]),
            "exploitablePct": float(progress["exploitable_pct"]),
            "targetPct": progress.get("target_pct"),
        }
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
    if index_entry is not None:
        body["indexEntry"] = index_entry
    return body


def report(
    job_id: str,
    status: Optional[str] = None,
    error: Optional[str] = None,
    heartbeat: bool = False,
    result: Optional[Dict[str, Any]] = None,
    index_entry: Optional[Dict[str, Any]] = None,
    retry_secs: Optional[float] = None,
    progress: Optional[Dict[str, Any]] = None,
) -> bool:
    """Report a status transition, failure, or keepalive for a claimed job.
    `result` may carry {stacks, node_name, board} on Done; `index_entry` is the
    library index entry the API upserts into enginesolutions-index.json.
    `progress` is {iteration, exploitable_pct, target_pct}: how far a running
    solve has got, which the API hands to whoever is waiting on the job. An
    API that predates it ignores the field.

    A terminal status (Done / Failed) is retried with backoff for
    `retry_secs` (WATCHER_TERMINAL_RETRY_SECS, default 300). A 409 that
    answers a RETRY - after an attempt whose fate is unknown (timeout,
    connection drop, 5xx) - means that attempt landed, and counts as recorded.
    A 409 on the first attempt is a real rejection (requeued or cancelled).
    """
    body = _report_body(status, error, heartbeat, result, index_entry, progress)
    terminal = status in TERMINAL_STATUSES
    if retry_secs is None:
        retry_secs = float(os.getenv("WATCHER_TERMINAL_RETRY_SECS", "300")) if terminal else 0.0
    deadline = time.monotonic() + retry_secs
    delay = 2.0
    waited = 0.0
    maybe_landed = False
    attempt = 0
    while True:
        attempt += 1
        try:
            resp = _http.patch(
                f"{_base()}/api/solvejobs/{job_id}",
                json=body,
                headers=_headers(),
                timeout=TIMEOUT_SECS,
            )
            if resp.status_code == 409:
                if maybe_landed:
                    log(f"  [queue] {status} for {job_id} already recorded (409 on retry {attempt})")
                    return True
                # The server requeued this job (stale claim) or it is terminal;
                # this claimer's reports are no longer welcome.
                log(f"  [queue] report rejected for {job_id}: {resp.text}")
                return False
            if resp.status_code >= 500:
                maybe_landed = True
                raise RuntimeError(f"HTTP {resp.status_code}")
            if resp.status_code >= 400:
                # A client error will not change on retry.
                log(f"  [queue] report refused for {job_id}: HTTP {resp.status_code} {resp.text[:300]}")
                return False
            return True
        except Exception as e:
            if isinstance(e, (requests.ConnectionError, requests.Timeout)):
                maybe_landed = True
            log(f"  [queue] report failed for {job_id}: {e}")
            # Bounded by the backoff actually spent as well as the clock, so
            # slow attempts cannot stretch the window and the budget holds
            # however the sleep is provided.
            waited += delay
            if not terminal or waited > retry_secs or time.monotonic() + delay > deadline:
                return False
            _sleep(delay)
            delay = min(delay * 2, 60.0)


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
