"""Compare watcher: executes htsolver jobs queued through the API.

Runs on the machine that has both solvers (htsolver's engine.exe and
PioSolver). Claims jobs from POST /api/enginecompare/claim and walks them
through Claimed -> Running -> Uploading -> Done, mirroring the main
watcher's queue protocol (X-Watcher-Key, heartbeats, stale-claim requeue on
the server).

Job modes:
  compare  solve with htsolver, then build + solve the IDENTICAL tree in Pio
           (engine_compare.py --solve-pio) and upload the per-hand comparison
           payload (gzipped .htc, see htc_format.py) to ADLS
           enginecompare/{id}.htc.gz. This is the htsolver-verification loop
           behind the frontend /compare page.
  publish  solve with htsolver only and POST the artifact to the API, which
           converts it to schema-4 bundles and publishes it to the solutions
           library. This is the post-Pio production path.

Env (same .env as the main watcher):
  HOLDEMTOOLS_API_BASE, WATCHER_API_KEY, WATCHER_ID   queue API (api_client)
  AZURE_STORAGE_CONNECTION_STRING, AZURE_STORAGE_CONTAINER   result upload
  ENGINE_EXE   default ../engine/build/engine.exe (relative to this file)

Run alongside the main watcher:  python engine_compare_watcher.py
Only ONE compare watcher instance should run (it spawns Pio processes).
"""

from __future__ import annotations

import gzip
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Dict, Optional

import requests

WATCHER_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WATCHER_DIR)

from api_client import log, watcher_id, _base, _key, enabled  # noqa: E402
from htc_format import read_htc_header  # noqa: E402

POLL_SECS = float(os.getenv("ENGINE_WATCHER_POLL_SECS", "5"))
TIMEOUT_SECS = 30.0
ENGINE_EXE = os.path.abspath(
    os.getenv("ENGINE_EXE") or os.path.join(WATCHER_DIR, "..", "engine", "build", "engine.exe"))


def _headers() -> Dict[str, str]:
    return {"X-Watcher-Key": _key()}


def claim() -> Optional[Dict[str, Any]]:
    try:
        resp = requests.post(f"{_base()}/api/enginecompare/claim",
                             json={"watcherId": watcher_id()},
                             headers=_headers(), timeout=TIMEOUT_SECS)
        if resp.status_code == 204:
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log(f"  [enginecompare] claim failed: {e}")
        return None


def report(job_id: str, status: Optional[str] = None, error: Optional[str] = None,
           heartbeat: bool = False, result_blob_path: Optional[str] = None,
           timings: Optional[Dict[str, Any]] = None) -> bool:
    body: Dict[str, Any] = {"watcherId": watcher_id(), "heartbeat": heartbeat}
    if status is not None:
        body["status"] = status
    if error is not None:
        body["error"] = error[:2000]
    if result_blob_path is not None:
        body["resultBlobPath"] = result_blob_path
    if timings:
        body["timings"] = timings
    try:
        resp = requests.patch(f"{_base()}/api/enginecompare/{job_id}", json=body,
                              headers=_headers(), timeout=TIMEOUT_SECS)
        if resp.status_code == 409:
            log(f"  [enginecompare] report rejected for {job_id}: {resp.text}")
            return False
        resp.raise_for_status()
        return True
    except Exception as e:
        log(f"  [enginecompare] report failed for {job_id}: {e}")
        return False


class Heartbeat:
    def __init__(self, job_id: str, interval: float = 60.0):
        self.job_id = job_id
        self.interval = interval
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def __enter__(self) -> "Heartbeat":
        self._thread = threading.Thread(
            target=lambda: [report(self.job_id, heartbeat=True)
                            for _ in iter(lambda: not self._stop.wait(self.interval), False)],
            daemon=True)
        self._thread.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)


def upload_result(job_id: str, result_path: str) -> str:
    """Gzip + upload the comparison payload; returns the blob path.

    The blob keeps its format in the extension: the API picks the content
    type from it, and old `.json.gz` rows stay readable alongside new
    `.htc.gz` ones."""
    from azure.storage.filedatalake import DataLakeServiceClient

    conn = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    container = os.getenv("AZURE_STORAGE_CONTAINER", "onlinerangedata")
    if not conn:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING is not set")
    fs = DataLakeServiceClient.from_connection_string(conn).get_file_system_client(container)
    with open(result_path, "rb") as f:
        payload = gzip.compress(f.read())
    rel_path = f"enginecompare/{job_id}.htc.gz"
    fs.get_file_client(rel_path).upload_data(payload, overwrite=True)
    return rel_path


def run_engine(config: Dict[str, Any], run_dir: str) -> str:
    """Solve with htsolver; returns the artifact path."""
    artifact = os.path.join(run_dir, "solve.hta")
    config["output"] = dict(config.get("output") or {})
    config["output"]["path"] = artifact.replace("\\", "/")
    config_path = os.path.join(run_dir, "config.json")
    with open(config_path, "w", encoding="utf8") as f:
        json.dump(config, f)
    out = subprocess.run([ENGINE_EXE, "solve", config_path],
                         capture_output=True, text=True, timeout=600)
    if out.returncode != 0 or not os.path.exists(artifact):
        raise RuntimeError(f"htsolver solve failed (exit {out.returncode}): "
                           f"{(out.stdout + out.stderr)[-1500:]}")
    log(f"  htsolver: {out.stdout.strip().splitlines()[-1] if out.stdout.strip() else 'done'}")
    return artifact


def handle_compare(job: Dict[str, Any], run_dir: str, timings: Dict[str, Any]) -> None:
    job_id = job["id"]
    config = json.loads(job["config"])
    # Validation-friendly flags: quantization must not pollute the diff.
    config["output"] = {"strategy_quantize_u8": False, "ev_float32": True, "rollups_169": False}
    phase_start = time.perf_counter()
    artifact = run_engine(config, run_dir)
    timings["engine_solve_s"] = round(time.perf_counter() - phase_start, 3)

    htc_out = os.path.join(run_dir, "compare.htc")
    cmd = [sys.executable, "-u", os.path.join(WATCHER_DIR, "engine_compare.py"),
           "--artifact", artifact, "--engine-exe", ENGINE_EXE,
           "--solve-pio", "--pio-accuracy-pct", str(job.get("pioAccuracyPct", 0.02)),
           "--top", "0", "--htc-out", htc_out]
    phase_start = time.perf_counter()
    out = subprocess.run(cmd, cwd=WATCHER_DIR, capture_output=True, text=True, timeout=1800)
    timings["compare_total_s"] = round(time.perf_counter() - phase_start, 3)
    if not os.path.exists(htc_out):
        raise RuntimeError(f"engine_compare failed (exit {out.returncode}): "
                           f"{(out.stdout + out.stderr)[-1500:]}")
    for line in out.stdout.splitlines():
        if any(k in line for k in ("exploitability", "PASS", "FAIL")):
            log(f"  {line.strip()}")
    # Harvest the child's per-phase numbers (pio build/solve, dump, compare
    # loop) so the whole breakdown rides one job row. Never fail the job on
    # a harvest problem - the result itself is already good.
    try:
        child_timing = read_htc_header(htc_out).get("summary", {}).get("timing", {})
        timings.update({k: v for k, v in child_timing.items() if v is not None})
    except Exception as e:
        log(f"  timing harvest failed (ignored): {e}")

    report(job_id, status="Uploading")
    phase_start = time.perf_counter()
    blob_path = upload_result(job_id, htc_out)
    timings["upload_s"] = round(time.perf_counter() - phase_start, 3)
    report(job_id, status="Done", result_blob_path=blob_path, timings=timings)
    log(f"  done -> {blob_path}")


def handle_publish(job: Dict[str, Any], run_dir: str, timings: Dict[str, Any]) -> None:
    job_id = job["id"]
    config = json.loads(job["config"])
    # Viewer-quality flags: quantized strategy + 169 rollups.
    config["output"] = {"strategy_quantize_u8": True, "ev_float32": True, "rollups_169": True}
    phase_start = time.perf_counter()
    artifact = run_engine(config, run_dir)
    timings["engine_solve_s"] = round(time.perf_counter() - phase_start, 3)

    report(job_id, status="Uploading")
    phase_start = time.perf_counter()
    with open(artifact, "rb") as f:
        resp = requests.post(
            f"{_base()}/api/enginecompare/{job_id}/publish-artifact",
            headers=_headers(),
            data={"watcherId": watcher_id()},
            files={"artifact": ("solve.hta", f, "application/octet-stream")},
            timeout=300,
        )
    resp.raise_for_status()
    # Includes the server-side schema-4 export, not just the transfer.
    timings["upload_s"] = round(time.perf_counter() - phase_start, 3)
    coords = resp.json()
    report(job_id, status="Done", timings=timings)
    log(f"  published -> {coords.get('stacks')}/{coords.get('nodeName')}/{coords.get('board')}")


def main() -> int:
    if not enabled():
        print("HOLDEMTOOLS_API_BASE / WATCHER_API_KEY not set; see watcher/.env.example")
        return 2
    if not os.path.exists(ENGINE_EXE):
        print(f"htsolver binary not found at {ENGINE_EXE} - build it (engine/build.ps1) "
              f"or set ENGINE_EXE")
        return 2
    log(f"engine compare watcher up (engine={ENGINE_EXE}, api={_base()})")

    while True:
        job = claim()
        if job is None:
            time.sleep(POLL_SECS)
            continue
        job_id = job["id"]
        mode = job.get("mode", "compare")
        log(f"claimed {mode} job {job_id} (board={job.get('board')})")
        timings: Dict[str, Any] = {"schema": 1}
        with tempfile.TemporaryDirectory(prefix="htsolver_job_") as run_dir:
            try:
                with Heartbeat(job_id):
                    report(job_id, status="Running")
                    if mode == "publish":
                        handle_publish(job, run_dir, timings)
                    else:
                        handle_compare(job, run_dir, timings)
            except Exception as e:
                log(f"  job {job_id} FAILED: {e}")
                # Partial timings still ride along - they show which stage died.
                report(job_id, status="Failed", error=str(e), timings=timings)


if __name__ == "__main__":
    sys.exit(main())
