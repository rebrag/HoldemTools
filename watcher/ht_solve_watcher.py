"""Headless htsolver worker for the SolveJobs queue.

The htsolver twin of watch_adls_and_run_pio_headless.py, with no GUI at all:
it claims jobs the API routed to htsolver (`POST /api/solvejobs/claim/htsolver`),
solves each gametree's engine tree with engine.exe, and publishes the same
schema-4 manifest and street bundles the Pio watcher does, through the same
builders (extraction.py, via ht_bundles.py and publish.py). Rivers are served
on demand from the artifact it keeps locally, off a Storage Queue of its own.

It imports nothing from pywinauto, pyperclip, pyosolver or the Pio watcher
(tests/test_ht_import_set.py pins that), and needs only requirements-ht.txt.

Per job (one solve slot):
  claim -> download the gametree blob -> compose the solve config
  -> engine dry-run (a refusal, e.g. the memory estimate, fails the job)
  -> Solving: engine solve, heartbeating
  -> Extracting: dump the flop, publish it + the manifest, send the index
     entry on a heartbeat so the board lists early
  -> dump flop + turns, Uploading: publish the turns
  -> solve.json beside the manifest (what a pinned re-solve needs)
  -> Done with {stacks, node_name, board} and the final index entry.

The worker never writes piosolutions-index.json (the Pio watcher's): the API
owns enginesolutions-index.json and upserts whatever entry a report carries.

Node requests (rivers): a thread drains the `HT_NODEREQ_QUEUE_NAME` queue. A
held artifact is dumped for the one street; an evicted one is re-solved first,
PINNED to the recorded iteration count (the solve is deterministic at a fixed
count), in a solve slot so two solves never share one. If the engine build
moved since the board was published, flop and turns are republished and every
earlier river entry is dropped, so a board never mixes two engines' output.

Drain: while `HT_DRAIN_FILE` exists the slots stop claiming and the request
thread stops receiving; once in-flight work is finished the process logs
"drained" and exits 0. A stale drain file is deleted at startup.

Env: see watcher/.env.example (the "htsolver SolveJobs worker" section).
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
import logging
import os
import shutil
import socket
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from typing import Any, Callable, Dict, Iterator, List, Mapping, Optional, Tuple

WATCHER_DIR = os.path.dirname(os.path.abspath(__file__))
if WATCHER_DIR not in sys.path:
    sys.path.insert(0, WATCHER_DIR)

from adls_store import (  # noqa: E402
    board_base_path,
    download_json,
    download_manifest,
    upload_json,
    upload_manifest,
    upload_street_bundle,
)
from artifact_registry import ArtifactRegistry  # noqa: E402
from engine_proc import (  # noqa: E402
    ChildResult,
    engine_error_line,
    parse_slot_affinity,
    run_streamed,
)
from extraction import (  # noqa: E402
    CARD_SEG_RE,
    build_board_context,
    build_street_bundle,
    context_from_manifest,
    node_id_to_suffix,
    parse_gametree_path,
    sanitize_float,
    street_entry,
)
import ht_bundles  # noqa: E402
from ht_bundles import (  # noqa: E402
    CANONICAL_HANDS,
    board_from_tree,
    engine_block,
    extract_from_dump,
    parse_gametree_blob,
)
from publish import BoardPublisher  # noqa: E402

BASE_PREFIX = "gametrees"
SOLVER = "htsolver"
# A queue message dequeued this many times without being deleted is parked on
# the poison queue instead of being retried forever (as the Pio watcher does).
QUEUE_MAX_DEQUEUE = 5
NODEREQ_POLL_SECS = 1.0


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


class JobFailed(Exception):
    """A job that cannot succeed; the message is what the user sees."""


# =========================
# Settings
# =========================
def _env_float(env: Mapping[str, str], name: str, default: float) -> float:
    raw = (env.get(name) or "").strip()
    return float(raw) if raw else default


def _env_int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = (env.get(name) or "").strip()
    return int(raw) if raw else default


@dataclass
class Settings:
    engine_exe: str
    artifact_dir: str
    work_dir: str
    watcher_id: str = "ht-worker"
    artifact_max_gb: float = 200.0
    solve_slots: int = 1
    threads: int = 0
    slot_affinity: List[Optional[List[int]]] = field(default_factory=list)
    memory_limit_gb: float = 24.0
    accuracy_pot_pct: float = 0.2
    max_iterations: int = 2000
    checkpoint_every: int = 25
    solve_timeout_secs: float = 1800.0
    claim_poll_secs: float = 5.0
    noderequest_queue_name: str = "noderequests-htsolver"
    upload_workers: int = 8
    log_dir: Optional[str] = None
    drain_file: str = ""

    def __post_init__(self) -> None:
        if not self.drain_file:
            self.drain_file = os.path.join(self.work_dir, "DRAIN")
        if self.solve_slots < 1:
            raise ValueError("HT_SOLVE_SLOTS must be at least 1")
        if self.slot_affinity and len(self.slot_affinity) != self.solve_slots:
            raise ValueError(
                f"HT_SLOT_AFFINITY names {len(self.slot_affinity)} CPU list(s) "
                f"for {self.solve_slots} slot(s)"
            )

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "Settings":
        env = os.environ if env is None else env
        work_dir = env.get("HT_WORK_DIR") or os.path.join(WATCHER_DIR, "ht_work")
        return cls(
            engine_exe=os.path.abspath(
                env.get("ENGINE_EXE") or os.path.join(WATCHER_DIR, "..", "engine", "build", "engine.exe")
            ),
            artifact_dir=env.get("HT_ARTIFACT_DIR") or os.path.join(WATCHER_DIR, "ht_artifacts"),
            work_dir=work_dir,
            watcher_id=env.get("WATCHER_ID") or socket.gethostname(),
            artifact_max_gb=_env_float(env, "HT_ARTIFACT_MAX_GB", 200.0),
            solve_slots=_env_int(env, "HT_SOLVE_SLOTS", 1),
            threads=_env_int(env, "HT_THREADS", 0),
            slot_affinity=parse_slot_affinity(env.get("HT_SLOT_AFFINITY")),
            memory_limit_gb=_env_float(env, "HT_MEMORY_LIMIT_GB", 24.0),
            accuracy_pot_pct=_env_float(env, "HT_ACCURACY_POT_PCT", 0.2),
            max_iterations=_env_int(env, "HT_MAX_ITERATIONS", 2000),
            checkpoint_every=_env_int(env, "HT_CHECKPOINT_EVERY", 25),
            solve_timeout_secs=_env_float(env, "HT_SOLVE_TIMEOUT_SECS", 1800.0),
            claim_poll_secs=_env_float(env, "HT_CLAIM_POLL_SECS", 5.0),
            noderequest_queue_name=env.get("HT_NODEREQ_QUEUE_NAME") or "noderequests-htsolver",
            upload_workers=_env_int(env, "HT_UPLOAD_WORKERS", 8),
            log_dir=env.get("HT_LOG_DIR") or None,
            drain_file=env.get("HT_DRAIN_FILE") or "",
        )

    def engine_max_seconds(self) -> float:
        """The engine's own time budget: the kill ceiling minus a margin to
        run the EV pass and write the artifact. A solve that runs out of time
        then ends cleanly, with metadata saying how far it got, and
        require_converged turns that into a readable failure; a kill would
        leave only "timed out"."""
        margin = min(300.0, 0.2 * self.solve_timeout_secs)
        return max(60.0, self.solve_timeout_secs - margin)

    def affinity_for_slot(self, slot: int) -> Optional[List[int]]:
        return self.slot_affinity[slot] if slot < len(self.slot_affinity) else None

    def threads_for_slot(self, slot: int) -> int:
        """HT_THREADS, or (when it is 0 = auto and the slot is pinned) the
        slot's CPU count: the engine's auto count is the whole machine."""
        cpus = self.affinity_for_slot(slot)
        if self.threads == 0 and cpus:
            return len(cpus)
        return self.threads

    @property
    def queue_visibility_secs(self) -> int:
        """A request may re-solve a whole board, so its message stays hidden
        for longer than the longest solve."""
        return int(self.solve_timeout_secs + 900)


# =========================
# Solve config (pure)
# =========================
def compose_solve_config(
    engine_tree: Dict[str, Any],
    *,
    artifact_path: str,
    settings: Settings,
    threads: Optional[int] = None,
    stop_file: Optional[str] = None,
) -> Dict[str, Any]:
    """The full engine config for one job.

    The client describes WHAT the tree is (the tree block, copied verbatim);
    this worker owns HOW it is solved, so every solver knob below overrides
    anything a tree block might carry. Pure: no I/O.
    """
    cfg = copy.deepcopy(engine_tree)
    cfg["algorithm"] = {"update": "dcfr", "recalc": {"enabled": True}}
    cfg["isomorphism"] = True
    cfg["qre"] = {"mode": "nash"}
    budget: Dict[str, Any] = {
        "iterations": settings.max_iterations,
        "target_exploitable_pct": settings.accuracy_pot_pct,
        "checkpoint_every": settings.checkpoint_every,
        "max_seconds": settings.engine_max_seconds(),
    }
    if stop_file:
        budget["stop_file"] = stop_file.replace("\\", "/")
    cfg["budget"] = budget
    cfg["memory_limit_gb"] = settings.memory_limit_gb
    cfg["threads"] = settings.threads if threads is None else threads
    cfg["output"] = {
        "path": artifact_path.replace("\\", "/"),
        "strategy_quantize_u8": False,
        "ev_float32": True,
        "rollups_169": False,
    }
    return cfg


def recorded_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """The config as solve.json keeps it: everything that decides the result,
    nothing that is this machine's (paths, threads, the wall-clock budget and
    the stop file)."""
    cfg = copy.deepcopy(config)
    cfg.pop("threads", None)
    out = dict(cfg.get("output") or {})
    out.pop("path", None)
    cfg["output"] = out
    budget = dict(cfg.get("budget") or {})
    budget.pop("max_seconds", None)
    budget.pop("stop_file", None)
    cfg["budget"] = budget
    return cfg


def pinned_config(
    record: Dict[str, Any],
    *,
    artifact_path: str,
    threads: int,
    stop_file: Optional[str] = None,
) -> Dict[str, Any]:
    """The config that reproduces a published board: the recorded config with
    the iteration count pinned to what the original solve actually ran and no
    early stop of any kind (no target, no wall-clock budget)."""
    cfg = copy.deepcopy(record["config"])
    budget = dict(cfg.get("budget") or {})
    budget["iterations"] = int(record["iterations_run"])
    budget["target_exploitable_pct"] = 0
    budget.pop("max_seconds", None)
    if stop_file:
        budget["stop_file"] = stop_file.replace("\\", "/")
    else:
        budget.pop("stop_file", None)
    cfg["budget"] = budget
    cfg["threads"] = threads
    cfg["output"] = {**(cfg.get("output") or {}), "path": artifact_path.replace("\\", "/")}
    return cfg


def require_converged(metadata: Dict[str, Any]) -> None:
    """Refuse to publish a solve that stopped short of its accuracy target.

    The engine always writes an artifact, even when it ran out of iterations
    or hit the time budget first. Publishing that would put a half-solved tree
    in the library with nothing in the viewer to say so, which is the same
    reason the Pio watcher raises when a solve does not converge inside
    PIO_SOLVE_WAIT_SECS. A failed job is visible and retryable; a quietly
    loose strategy is neither.

    A pinned re-solve sets no target (it reproduces a published solve by
    iteration count), so `target_exploitable_pct` null or 0 passes.
    """
    solved = metadata.get("solved") or {}
    target = solved.get("target_exploitable_pct")
    if not target or solved.get("reached") is True:
        return
    got = solved.get("last_exploitable_pct_pot")
    got_text = f"{got:.3f}% of pot" if isinstance(got, (int, float)) else "an unmeasured accuracy"
    raise JobFailed(
        f"the solve stopped at {got_text} after {metadata.get('iterations')} iterations "
        f"({solved.get('stopped_reason') or 'budget'}) without reaching the {target}% target; "
        "raise HT_MAX_ITERATIONS or HT_SOLVE_TIMEOUT_SECS on the worker if this tree is expected to be this hard"
    )


def engine_identity(metadata: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    return metadata.get("solver_version"), metadata.get("engine_build")


# =========================
# Engine CLI
# =========================
class EngineCli:
    """engine.exe behind the three calls the worker makes."""

    def __init__(self, exe: str) -> None:
        self.exe = exe

    def dry_run(self, config_path: str) -> Tuple[bool, str]:
        import subprocess

        try:
            proc = subprocess.run([self.exe, "dry-run", config_path],
                                  capture_output=True, text=True, timeout=600)
        except (OSError, subprocess.TimeoutExpired) as e:
            return False, f"engine dry-run did not run: {e}"
        text = (proc.stderr or "") + "\n" + (proc.stdout or "")
        if proc.returncode != 0:
            return False, engine_error_line(text) or f"exit {proc.returncode}"
        return True, engine_error_line(text)

    def solve(self, config_path: str, *, timeout: float,
              affinity: Optional[List[int]] = None) -> ChildResult:
        return run_streamed([self.exe, "solve", config_path], timeout=timeout,
                            prefix="ht", affinity=affinity)

    def dump_streets(self, artifact: str, out_dir: str, *, through: Optional[str] = None,
                     seeds: Optional[List[str]] = None, equity: bool = True) -> Dict[str, Any]:
        return ht_bundles.run_dump_streets(self.exe, artifact, out_dir,
                                           through=through, seeds=seeds, equity=equity)


# =========================
# Small helpers
# =========================
def download_text(fs: Any, path: str) -> Optional[str]:
    try:
        return fs.get_file_client(path).download_file().readall().decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        log(f"[download] error for {path}: {e}")
        return None


def street_of_seed(node_id: str) -> str:
    """'r:0:c:c:Th' -> 'turn'; two dealt cards -> 'river'."""
    deals = sum(1 for seg in node_id.split(":")[2:] if CARD_SEG_RE.match(seg))
    return "river" if deals >= 2 else "turn"


def parse_node_request(content: str) -> Optional[Dict[str, str]]:
    """A queue message is raw UTF-8 JSON {stacks, node_name, board, node_id,
    requested_utc}; node_id must be a colon path ending in a dealt card."""
    try:
        obj = json.loads(content)
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    req = {k: obj.get(k) for k in ("stacks", "node_name", "board", "node_id")}
    if not all(isinstance(v, str) and v for v in req.values()):
        return None
    segs = req["node_id"].split(":")
    if len(segs) < 3 or segs[0] != "r" or not CARD_SEG_RE.match(segs[-1]):
        return None
    return req  # type: ignore[return-value]


class _KeyedLocks:
    """One re-entrant lock per key, created on first use."""

    def __init__(self) -> None:
        self._guard = threading.Lock()
        self._locks: Dict[str, threading.RLock] = {}

    def get(self, key: str) -> "threading.RLock":
        with self._guard:
            lock = self._locks.get(key)
            if lock is None:
                lock = self._locks[key] = threading.RLock()
            return lock


# =========================
# Worker
# =========================
class Worker:
    """The job and node-request logic, with every collaborator injected.

    fs        ADLS file-system client (get_file_client(path).upload_data /
              download_file().readall()); a dict-backed fake in the tests.
    api       claim_next(solver), report(job_id, ...), Heartbeat(job_id): the
              api_client module in production.
    engine    dry_run / solve / dump_streets: EngineCli in production.
    registry  ArtifactRegistry for .hta files.
    queue, poison  Storage Queue clients (receive_message / delete_message /
              send_message); None runs without node requests.

    Lock order, everywhere: solve slot, then the board's artifact lock, then
    the board's manifest lock. Holding them in one order is what keeps a job
    and a node request for the same board from deadlocking.
    """

    def __init__(
        self,
        *,
        fs: Any,
        api: Any,
        engine: Any,
        registry: ArtifactRegistry,
        settings: Settings,
        queue: Any = None,
        poison: Any = None,
        wait: Optional[Callable[[float], Any]] = None,
    ) -> None:
        self.fs = fs
        self.api = api
        self.engine = engine
        self.registry = registry
        self.settings = settings
        self.queue = queue
        self.poison = poison
        self._stop = threading.Event()
        self._wait = wait or self._stop.wait
        self.slot_locks = [threading.Lock() for _ in range(settings.solve_slots)]
        self._artifact_locks = _KeyedLocks()
        self._board_locks = _KeyedLocks()
        os.makedirs(settings.work_dir, exist_ok=True)

    # --- locks -----------------------------------------------------------
    def board_lock(self, key: str) -> "threading.RLock":
        """Held around every manifest read-modify-write for one board."""
        return self._board_locks.get(key)

    def artifact_lock(self, key: str) -> "threading.RLock":
        """Held while a board's artifact is written or read."""
        return self._artifact_locks.get(key)

    @contextlib.contextmanager
    def solve_slot(self) -> Iterator[int]:
        """Any free slot, waiting for one when all are busy."""
        while True:
            for i, lock in enumerate(self.slot_locks):
                if lock.acquire(blocking=False):
                    try:
                        yield i
                    finally:
                        lock.release()
                    return
            if self.slot_locks[0].acquire(timeout=1.0):
                try:
                    yield 0
                finally:
                    self.slot_locks[0].release()
                return

    # --- drain -----------------------------------------------------------
    def draining(self) -> bool:
        return self._stop.is_set() or os.path.exists(self.settings.drain_file)

    def clear_stale_drain(self) -> None:
        try:
            os.remove(self.settings.drain_file)
            log(f"removed a stale drain file: {self.settings.drain_file}")
        except FileNotFoundError:
            pass

    # --- context / publishing -------------------------------------------
    def _board_publisher(self, *, board: str, key: str, metadata: Dict[str, Any],
                         build_ctx: Callable[[Dict[str, Any]], Dict[str, Any]]) -> BoardPublisher:
        return BoardPublisher(
            self.fs,
            board=board,
            build_ctx=build_ctx,
            upload_workers=self.settings.upload_workers,
            engine=engine_block(metadata, watcher_id=self.settings.watcher_id),
            cfr_available=False,
            manifest_lock=lambda: self.board_lock(key),
        )

    @staticmethod
    def _blob_ctx_builder(board: str, blob: Dict[str, Any], blob_path: str):
        def build(ex: Dict[str, Any]) -> Dict[str, Any]:
            return build_board_context(
                board=board,
                cfr_file="",
                src_gametree_path=blob_path,
                base_prefix=BASE_PREFIX,
                stats=ex["results"],
                tree_info=ex["tree_info"],
                alive_positions=blob["alive_positions"],
                acting_pos=blob["acting_pos"],
                preflop_line=blob["preflop_line"],
                is_icm=blob["is_icm"],
                seat_meta=blob["seat_meta"],
                hand_bb=blob["hand_bb"],
                chip_scale=blob["chip_scale"],
            )
        return build

    @staticmethod
    def _manifest_ctx_builder(manifest: Dict[str, Any]):
        def build(ex: Dict[str, Any]) -> Dict[str, Any]:
            ctx = context_from_manifest(manifest, "", ex["tree_info"], base_prefix=BASE_PREFIX)
            ctx.pop("engine", None)  # the publisher's own block is the new one
            for k, v in (ex.get("results") or {}).items():
                if v is not None:
                    ctx["summary"][k] = sanitize_float(v)
            return ctx
        return build

    def _run_dir(self, name: str) -> str:
        path = os.path.join(self.settings.work_dir, name)
        shutil.rmtree(path, ignore_errors=True)
        os.makedirs(path, exist_ok=True)
        return path

    def _write_config(self, run_dir: str, config: Dict[str, Any]) -> str:
        path = os.path.join(run_dir, "config.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(config, f)
        return path

    def _solve(self, config_path: str, artifact: str, slot: int, *, timeout: float) -> None:
        if os.path.exists(artifact):
            # A leftover from an earlier solve of these coordinates must not
            # pass for this solve's output if this one writes nothing.
            os.remove(artifact)
        out = self.engine.solve(config_path, timeout=timeout,
                                affinity=self.settings.affinity_for_slot(slot))
        if out.returncode != 0 or not os.path.exists(artifact):
            raise JobFailed(
                f"htsolver solve failed (exit {out.returncode}): "
                f"{engine_error_line(out.text) or 'no artifact written'}"
            )
        log(f"  htsolver: {out.last_line() or 'done'}")

    # --- jobs ------------------------------------------------------------
    def process_job(self, job: Dict[str, Any], slot: int = 0) -> None:
        """Run one claimed job end to end. Never raises: every failure becomes
        a Failed report plus a log line."""
        job_id = str(job["id"])
        blob_path = job.get("blobPath") or ""
        log(f"[JOB {job_id}] slot {slot}, attempt {job.get('attemptCount')}: {blob_path}")
        run_dir = self._run_dir(f"job-{job_id}")
        try:
            result, entry = self._solve_and_publish(job_id, blob_path, run_dir, slot)
        except Exception as e:  # noqa: BLE001 - reported, never propagated
            log(f"  -> job {job_id} FAILED: {e}")
            self.api.report(job_id, status="Failed", error=str(e) or type(e).__name__)
            return
        finally:
            shutil.rmtree(run_dir, ignore_errors=True)
        self.api.report(job_id, status="Done", result=result, index_entry=entry)
        log(f"  -> job {job_id} done: {result['stacks']}/{result['node_name']}/{result['board']}")

    def _solve_and_publish(self, job_id: str, blob_path: str, run_dir: str,
                           slot: int) -> Tuple[Dict[str, str], Dict[str, Any]]:
        raw = download_text(self.fs, blob_path)
        if raw is None:
            raise JobFailed(f"could not download gametree blob {blob_path}")
        blob = parse_gametree_blob(raw)
        if blob["is_icm"]:
            raise JobFailed("ICM solves run on PioSOLVER only; this job should not have been routed to htsolver")
        tree = blob["engine_tree"]
        if not isinstance(tree, dict):
            raise JobFailed(
                "the gametree has no engine tree (it was uploaded by a client that predates "
                "htsolver solves), so htsolver cannot solve it"
            )
        board = board_from_tree(tree)
        if len(board) != 6:
            raise JobFailed(f"htsolver solves flop spots only; the engine tree's board is {tree.get('board')!r}")
        stacks, node_name, _ = parse_gametree_path(blob_path, BASE_PREFIX)
        stacks, node_name = stacks or "nostacks", node_name or "nonode"
        key = self.registry.key(stacks, node_name, board)
        artifact = self.registry.path_for(stacks, node_name, board)

        with self.registry.pinned(key), self.artifact_lock(key):
            config = compose_solve_config(
                tree, artifact_path=artifact, settings=self.settings,
                threads=self.settings.threads_for_slot(slot),
                stop_file=os.path.join(run_dir, "STOP"),
            )
            config_path = self._write_config(run_dir, config)
            ok, message = self.engine.dry_run(config_path)
            if not ok:
                raise JobFailed(f"the engine refused this tree: {message}")

            self.api.report(job_id, status="Solving")
            with self.api.Heartbeat(job_id):
                t0 = time.perf_counter()
                self._solve(config_path, artifact, slot, timeout=self.settings.solve_timeout_secs)
                log(f"  solved in {time.perf_counter() - t0:.1f}s")

                self.api.report(job_id, status="Extracting")
                flop_dir = os.path.join(run_dir, "dump-flop")
                flop = extract_from_dump(
                    self.engine.dump_streets(artifact, flop_dir, through="flop", equity=True), flop_dir)
                metadata = flop["metadata"]
                require_converged(metadata)
                publisher = self._board_publisher(
                    board=board, key=key, metadata=metadata,
                    build_ctx=self._blob_ctx_builder(board, blob, blob_path))
                entry = publisher.publish(flop)
                # The board lists as soon as its flop is up, minutes before Done.
                self.api.report(job_id, heartbeat=True, index_entry=entry)

                turn_dir = os.path.join(run_dir, "dump-turn")
                full = extract_from_dump(
                    self.engine.dump_streets(artifact, turn_dir, through="turn", equity=True),
                    turn_dir, root_weight=flop.get("root_weight"))
                self.api.report(job_id, status="Uploading")
                entry = publisher.publish(full)

                version, build = engine_identity(metadata)
                record = {
                    "config": recorded_config(config),
                    "iterations_run": metadata.get("iterations"),
                    "engine_version": version,
                    "engine_build": build,
                    "artifact_bytes": os.path.getsize(artifact),
                    "solved_utc": datetime.now(timezone.utc).isoformat(),
                    "watcher_id": self.settings.watcher_id,
                }
                base = board_base_path(publisher.stacks, publisher.node_name, board)
                if not upload_json(self.fs, f"{base}/solve.json", record):
                    raise JobFailed("could not upload solve.json (rivers would not be re-solvable)")

            self.registry.touch(stacks, node_name, board)
            for evicted in self.registry.enforce_budget():
                log(f"  evicted {evicted.get('board')} ({evicted.get('stacks')}); "
                    "its rivers will re-solve on demand")
        return {"stacks": publisher.stacks, "node_name": publisher.node_name, "board": board}, entry

    def slot_loop(self, slot: int) -> None:
        log(f"slot {slot} up (threads {self.settings.threads_for_slot(slot) or 'auto'}, "
            f"cpus {self.settings.affinity_for_slot(slot) or 'any'})")
        lock = self.slot_locks[slot]
        while not self.draining():
            if not lock.acquire(timeout=1.0):
                continue
            job = None
            try:
                if not self.draining():
                    job = self.api.claim_next(SOLVER)
                    if job is not None:
                        self.process_job(job, slot)
            finally:
                lock.release()
            if job is None:
                self._wait(self.settings.claim_poll_secs)
        log(f"slot {slot} stopped claiming (drain)")

    # --- node requests ---------------------------------------------------
    def handle_node_request(self, req: Dict[str, str]) -> None:
        """Serve one on-demand street. Raises on a transient failure so the
        message redelivers; returns on success and on requests that can never
        succeed (no manifest, not an htsolver board)."""
        stacks, node_name, board, node_id = req["stacks"], req["node_name"], req["board"], req["node_id"]
        key = self.registry.key(stacks, node_name, board)
        suffix = node_id_to_suffix(node_id)
        base = board_base_path(stacks, node_name, board)

        # Phase 1: decide, and flag a re-solve so the viewer says so.
        with self.board_lock(key):
            manifest = download_manifest(self.fs, stacks, node_name, board)
            if manifest is None:
                log(f"  [nodereq] no manifest for {board}; dropping {node_id}")
                return
            solver = (manifest.get("engine") or {}).get("solver")
            if solver != SOLVER:
                log(f"  [nodereq] {board} is not an htsolver board ({solver or 'pio'}); refusing {node_id}")
                return
            streets = manifest.setdefault("streets", {})
            if (streets.get(suffix) or {}).get("extracted"):
                log(f"  [nodereq] {board} {node_id}: already extracted")
                return
            # Requests are handled one at a time on one thread, so a second
            # request for this board cannot start a second re-solve here; a
            # job re-solving the same coordinates is serialized by the
            # artifact lock instead.
            held = self.registry.lookup(stacks, node_name, board) is not None
            if not held:
                streets[suffix] = {
                    "street": street_of_seed(node_id),
                    "file": f"streets/{suffix}.json.gz",
                    "extracted": False,
                    "status": "resolving",
                    "requested_utc": datetime.now(timezone.utc).isoformat(),
                }
                upload_manifest(self.fs, base, manifest)

        record: Optional[Dict[str, Any]] = None
        if not held:
            try:
                record = self._resolve(key, stacks, node_name, board)
            except Exception:
                self._drop_entry(key, stacks, node_name, board, suffix)
                raise

        # Phase 3: extract (and republish when the engine moved).
        with self.registry.pinned(key), self.artifact_lock(key):
            artifact = self.registry.lookup(stacks, node_name, board)
            if artifact is None:
                raise RuntimeError(f"{board}: no artifact after re-solve")
            run_dir = self._run_dir(f"req-{abs(hash((key, node_id))) % 10**10}")
            try:
                dump_dir = os.path.join(run_dir, "dump")
                dump = self.engine.dump_streets(artifact, dump_dir, seeds=[node_id], equity=True)
                ex = extract_from_dump(dump, dump_dir)
                with self.board_lock(key):
                    manifest = download_manifest(self.fs, stacks, node_name, board)
                    if manifest is None:
                        raise RuntimeError(f"{board}: manifest vanished")
                    if record is not None and engine_identity(ex["metadata"]) != (
                            record.get("engine_version"), record.get("engine_build")):
                        manifest = self._republish(manifest, record, ex["metadata"], artifact,
                                                   run_dir, key, suffix, base)
                    streets = manifest.setdefault("streets", {})
                    walk = ex["streets"].get(node_id)
                    if not walk or not walk["views"]:
                        log(f"  [nodereq] {board} {node_id}: no decision nodes; removing the entry")
                        streets.pop(suffix, None)
                        upload_manifest(self.fs, base, manifest)
                        return
                    ctx = context_from_manifest(manifest, "", ex["tree_info"], base_prefix=BASE_PREFIX)
                    bundle = build_street_bundle(node_id, walk["views"], walk["nodes_meta"], ctx, CANONICAL_HANDS)
                    if not upload_street_bundle(self.fs, base, bundle):
                        raise RuntimeError(f"{board}: bundle upload failed for {node_id}")
                    streets[suffix] = street_entry(suffix, bundle["street"], len(walk["views"]))
                    manifest["updated_utc"] = datetime.now(timezone.utc).isoformat()
                    upload_manifest(self.fs, base, manifest)
                    log(f"  [nodereq] {board} {node_id}: extracted {len(walk['views'])} node(s)")
            finally:
                shutil.rmtree(run_dir, ignore_errors=True)
            self.registry.touch(stacks, node_name, board)

    def _drop_entry(self, key: str, stacks: str, node_name: str, board: str, suffix: str) -> None:
        """Undo a 'resolving' flag after a failed re-solve, so the viewer is
        not left waiting on a street nobody is producing."""
        try:
            with self.board_lock(key):
                manifest = download_manifest(self.fs, stacks, node_name, board)
                entry = ((manifest or {}).get("streets") or {}).get(suffix) or {}
                if manifest is not None and entry.get("status") == "resolving":
                    manifest["streets"].pop(suffix, None)
                    upload_manifest(self.fs, board_base_path(stacks, node_name, board), manifest)
        except Exception as e:  # noqa: BLE001
            log(f"  [nodereq] could not clear the resolving flag on {board}: {e}")

    def _resolve(self, key: str, stacks: str, node_name: str, board: str) -> Dict[str, Any]:
        """Re-solve an evicted board, pinned to its recorded iterations, in a
        solve slot. Returns the solve.json record it reproduced."""
        base = board_base_path(stacks, node_name, board)
        record = download_json(self.fs, f"{base}/solve.json")
        if not isinstance(record, dict) or not record.get("config") or not record.get("iterations_run"):
            raise RuntimeError(f"{board}: no usable solve.json; cannot re-solve")
        log(f"  [nodereq] {board}: artifact not held here; re-solving pinned to "
            f"{record['iterations_run']} iterations")
        with self.solve_slot() as slot:
            with self.registry.pinned(key), self.artifact_lock(key):
                if self.registry.lookup(stacks, node_name, board) is not None:
                    return record  # another path produced it while we waited
                artifact = self.registry.path_for(stacks, node_name, board)
                run_dir = self._run_dir(f"resolve-{abs(hash(key)) % 10**10}")
                try:
                    config = pinned_config(record, artifact_path=artifact,
                                           threads=self.settings.threads_for_slot(slot),
                                           stop_file=os.path.join(run_dir, "STOP"))
                    path = self._write_config(run_dir, config)
                    self._solve(path, artifact, slot, timeout=self.settings.solve_timeout_secs + 600)
                finally:
                    shutil.rmtree(run_dir, ignore_errors=True)
                self.registry.touch(stacks, node_name, board)
                self.registry.enforce_budget()
        return record

    def _republish(self, manifest: Dict[str, Any], record: Dict[str, Any], metadata: Dict[str, Any],
                   artifact: str, run_dir: str, key: str, keep_suffix: str, base: str) -> Dict[str, Any]:
        """The engine build moved since this board was published: republish
        flop and turns from the new artifact and drop every river extracted
        from the old one, so no board mixes two engines' output."""
        board = manifest["board"]
        log(f"  [nodereq] {board}: engine changed ({record.get('engine_version')}/"
            f"{record.get('engine_build')} -> {metadata.get('solver_version')}/"
            f"{metadata.get('engine_build')}); republishing flop and turns")
        streets = manifest.setdefault("streets", {})
        for sfx in [s for s, e in streets.items() if e.get("street") == "river" and s != keep_suffix]:
            streets.pop(sfx, None)
        upload_manifest(self.fs, base, manifest)

        turn_dir = os.path.join(run_dir, "dump-turn")
        full = extract_from_dump(
            self.engine.dump_streets(artifact, turn_dir, through="turn", equity=True), turn_dir)
        publisher = self._board_publisher(board=board, key=key, metadata=full["metadata"],
                                          build_ctx=self._manifest_ctx_builder(manifest))
        publisher.publish(full)

        version, build = engine_identity(full["metadata"])
        upload_json(self.fs, f"{base}/solve.json", {
            **record, "engine_version": version, "engine_build": build,
            "artifact_bytes": os.path.getsize(artifact),
        })
        return download_manifest(self.fs, manifest["stacks"], manifest["node_name"], board) or manifest

    def drain_node_requests_once(self) -> bool:
        """Receive and handle at most one message. True when one was taken.

        One at a time, as the Pio watcher does: a batch receive under the long
        visibility timeout would let later messages age toward the poison
        threshold while an earlier re-solve runs."""
        if self.queue is None:
            return False
        try:
            msg = self.queue.receive_message(visibility_timeout=self.settings.queue_visibility_secs)
        except Exception as e:  # noqa: BLE001
            log(f"  [nodereq] queue receive failed: {e}")
            return False
        if msg is None:
            return False
        content = msg.content or ""
        if (msg.dequeue_count or 0) >= QUEUE_MAX_DEQUEUE:
            log(f"  [nodereq] poison message after {msg.dequeue_count} dequeues; parking: {content[:200]}")
            self._park(msg)
            return True
        req = parse_node_request(content)
        if req is None:
            log(f"  [nodereq] unparseable message; parking: {content[:200]}")
            self._park(msg)
            return True
        log(f"  [nodereq] {req['board']} {req['node_id']}")
        try:
            self.handle_node_request(req)
        except Exception as e:  # noqa: BLE001 - redelivers after the visibility timeout
            log(f"  [nodereq] ERROR for {req['board']} {req['node_id']}: {e} (message will redeliver)")
            return True
        try:
            self.queue.delete_message(msg)
        except Exception as e:  # noqa: BLE001
            log(f"  [nodereq] failed to delete a handled message: {e}")
        return True

    def _park(self, msg: Any) -> None:
        """Copy to the poison queue, then delete. A failed copy keeps the
        original for redelivery - better retried than silently lost."""
        try:
            if self.poison is not None:
                self.poison.send_message(msg.content)
        except Exception as e:  # noqa: BLE001
            log(f"  [nodereq] failed to park poison message: {e}")
            return
        try:
            self.queue.delete_message(msg)
        except Exception as e:  # noqa: BLE001
            log(f"  [nodereq] failed to delete parked message: {e}")

    def node_request_loop(self) -> None:
        while not self.draining():
            if not self.drain_node_requests_once():
                self._wait(NODEREQ_POLL_SECS)
        log("node requests stopped receiving (drain)")

    # --- process ---------------------------------------------------------
    def run(self) -> int:
        """Start every slot and the node-request thread; return 0 once a
        drain has let all of them finish their in-flight work."""
        self.clear_stale_drain()
        threads = [
            threading.Thread(target=self.slot_loop, args=(i,), name=f"slot-{i}", daemon=True)
            for i in range(self.settings.solve_slots)
        ]
        if self.queue is not None:
            threads.append(threading.Thread(target=self.node_request_loop, name="noderequests", daemon=True))
        for t in threads:
            t.start()
        try:
            while any(t.is_alive() for t in threads):
                for t in threads:
                    t.join(timeout=0.5)
        except KeyboardInterrupt:
            log("Ctrl+C: stopping after in-flight work (create the drain file to do this remotely)")
            self._stop.set()
            for t in threads:
                t.join()
        log("drained")
        return 0


# =========================
# Process setup
# =========================
class _TeeToLog(io.TextIOBase):
    """A text stream writing to the console and, line by line, to a logger."""

    def __init__(self, stream: Any, logger: logging.Logger) -> None:
        self._stream = stream
        self._logger = logger
        self._buf = ""
        self._lock = threading.Lock()

    def write(self, s: str) -> int:
        self._stream.write(s)
        with self._lock:
            self._buf += s
            while "\n" in self._buf:
                line, self._buf = self._buf.split("\n", 1)
                self._logger.info(line)
        return len(s)

    def flush(self) -> None:
        self._stream.flush()


def setup_logging(log_dir: Optional[str]) -> None:
    """Rotating file logs under HT_LOG_DIR, in addition to stdout."""
    if not log_dir:
        return
    os.makedirs(log_dir, exist_ok=True)
    logger = logging.getLogger("ht_solve_watcher")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    handler = RotatingFileHandler(os.path.join(log_dir, "ht_solve_watcher.log"),
                                  maxBytes=20 * 1024 * 1024, backupCount=10, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    logger.addHandler(handler)
    sys.stdout = _TeeToLog(sys.stdout, logger)  # type: ignore[assignment]
    sys.stderr = _TeeToLog(sys.stderr, logger)  # type: ignore[assignment]


def _storage(settings: Settings) -> Tuple[Any, Any, Any]:
    """ADLS file system + node-request queue and its poison sibling.
    Imported here, not at module level, so the module (and its tests) load
    without any Azure SDK."""
    from azure.core.exceptions import ResourceExistsError
    from azure.storage.filedatalake import DataLakeServiceClient
    from azure.storage.queue import QueueClient

    conn = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not conn:
        raise SystemExit("AZURE_STORAGE_CONNECTION_STRING is not set; see watcher/.env.example")
    container = os.getenv("AZURE_STORAGE_CONTAINER", "onlinerangedata")
    fs = DataLakeServiceClient.from_connection_string(conn).get_file_system_client(container)
    main_q = QueueClient.from_connection_string(conn, settings.noderequest_queue_name)
    poison = QueueClient.from_connection_string(conn, f"{settings.noderequest_queue_name}-poison")
    for client in (main_q, poison):
        try:
            client.create_queue()
        except ResourceExistsError:
            pass
    return fs, main_q, poison


def main() -> int:
    try:
        from dotenv import load_dotenv

        load_dotenv(os.path.join(WATCHER_DIR, ".env"))
    except Exception:  # noqa: BLE001 - python-dotenv is optional
        pass
    import api_client

    settings = Settings.from_env()
    setup_logging(settings.log_dir)
    if not api_client.enabled():
        log("HOLDEMTOOLS_API_BASE / WATCHER_API_KEY not set; see watcher/.env.example")
        return 2
    if not os.path.exists(settings.engine_exe):
        log(f"engine binary not found at {settings.engine_exe} (build engine/ or set ENGINE_EXE)")
        return 2
    fs, queue, poison = _storage(settings)
    registry = ArtifactRegistry(settings.artifact_dir, max_gb=settings.artifact_max_gb, ext=".hta")
    log(f"htsolver worker {settings.watcher_id} up: engine {settings.engine_exe}, "
        f"{settings.solve_slots} slot(s), artifacts {settings.artifact_dir} "
        f"(budget {settings.artifact_max_gb:.0f} GB), queue {settings.noderequest_queue_name}, "
        f"drain file {settings.drain_file}")
    worker = Worker(fs=fs, api=api_client, engine=EngineCli(settings.engine_exe),
                    registry=registry, settings=settings, queue=queue, poison=poison)
    return worker.run()


if __name__ == "__main__":
    sys.exit(main())
