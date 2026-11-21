"""ht_solve_watcher.Worker: job flow, node requests and drain, all with fakes."""

import json
import os
import threading
import time

import pytest

from artifact_registry import ArtifactRegistry
from ht_fakes import (
    BASE, BLOB_PATH, BOARD_KEY, METADATA, NODE_NAME, RIVER_SEED, STACKS, FakeApi, FakeEngine, FakeFs,
    FakeMessage, FakeQueue, gametree_blob,
)
from ht_solve_watcher import ProgressReporter, Settings, Worker


def _settings(tmp_path, **kw):
    return Settings(engine_exe="engine.exe", artifact_dir=str(tmp_path / "artifacts"),
                    work_dir=str(tmp_path / "work"), watcher_id="m13001", claim_poll_secs=0.01, **kw)


def _worker(tmp_path, *, engine=None, api=None, fs=None, queue=None, poison=None, **kw):
    settings = _settings(tmp_path, **kw)
    fs = fs or FakeFs()
    worker = Worker(
        fs=fs, api=api or FakeApi(), engine=engine or FakeEngine(),
        registry=ArtifactRegistry(settings.artifact_dir, max_gb=1, ext=".hta"),
        settings=settings, queue=queue, poison=poison, wait=lambda s: time.sleep(0.005),
    )
    return worker, fs


def _job(fs, blob=None, job_id="job-1"):
    fs.put_json(BLOB_PATH, blob if blob is not None else gametree_blob())
    return {"id": job_id, "blobPath": BLOB_PATH, "attemptCount": 1}


# --------------------------------------------------------------------- jobs

def test_job_flow_stages_publish_and_solve_json(tmp_path):
    worker, fs = _worker(tmp_path)
    api, engine = worker.api, worker.engine
    worker.process_job(_job(fs))

    assert api.statuses() == ["Solving", "Extracting", "Uploading", "Done"]
    assert engine.calls == ["dry_run", "solve", "dump:flop", "dump:turn"]
    assert all(d["equity"] for d in engine.dumps)

    # The flop's index entry rides a heartbeat BEFORE Uploading, so the board
    # lists while the turns are still being dumped.
    hb = [i for i, r in enumerate(api.reports) if r["heartbeat"] and r["index_entry"]]
    uploading = api.statuses().index("Uploading")
    assert hb and hb[0] < [i for i, r in enumerate(api.reports) if r["status"] == "Uploading"][0]
    early = api.reports[hb[0]]["index_entry"]
    assert early["turn_streets"] == 0 and early["flop_nodes"] == 3 and early["solver"] == "htsolver"
    assert uploading == 2

    done = api.reports[-1]
    assert done["result"] == {"stacks": STACKS, "node_name": NODE_NAME, "board": BOARD_KEY}
    assert done["index_entry"]["turn_streets"] == 1 and done["index_entry"]["cfr_available"] is False

    manifest = fs.json(f"{BASE}/manifest.json")
    assert manifest["engine"] == {
        "solver": "htsolver", "version": "0.1.0", "build": "build-1", "config_hash": "abc123",
        "iterations": 640, "exploitable": pytest.approx(0.2), "watcher_id": "m13001",
    }
    assert manifest["summary"]["ev_oop"] == 46.0 and manifest["summary"]["exploitable"] == pytest.approx(0.2)
    assert manifest["pot_chips"] == 100 and manifest["effective_stack_chips"] == 400
    assert manifest["chip_scale"] == 1.0 and manifest["hand_bb"] == 2
    assert manifest["seat_meta"][0]["name"] == "Hero"
    assert manifest["preflop"]["gametree_path"] == BLOB_PATH
    assert manifest["preflop"]["line"] == ["Root", "Call"]
    assert manifest["stacks_map"] == {"SB": 400, "BTN": 400}
    assert set(manifest["streets"]) == {"r.0", "r.0.c.c.Th"}
    assert fs.uploads.count(f"{BASE}/streets/r.0.json.gz") == 1   # flop uploaded once

    record = fs.json(f"{BASE}/solve.json")
    assert record["iterations_run"] == 640
    assert record["engine_version"] == "0.1.0" and record["engine_build"] == "build-1"
    assert record["watcher_id"] == "m13001" and record["artifact_bytes"] == 1024
    assert "path" not in record["config"]["output"] and "threads" not in record["config"]
    assert "max_seconds" not in record["config"]["budget"] and "stop_file" not in record["config"]["budget"]

    # The artifact is kept for rivers, and the run directory is gone.
    assert worker.registry.lookup(STACKS, NODE_NAME, BOARD_KEY)
    assert not os.path.exists(os.path.join(worker.settings.work_dir, "job-job-1"))
    # The worker never writes the Pio watcher's index.
    assert "piosolutions-index.json" not in fs.files


def test_solve_progress_rides_a_report_while_solving(tmp_path):
    worker, fs = _worker(tmp_path)
    worker.process_job(_job(fs))
    reports = worker.api.reports
    progress = [r for r in reports if r["progress"]]
    # The fake engine's two checkpoints land inside one reporting interval:
    # the first is sent and the second is superseded, not queued.
    assert [r["progress"] for r in progress] == [
        {"iteration": 25, "exploitable_pct": 4.8, "target_pct": 0.2}]
    # A keepalive, never a status change, and only while the job is Solving.
    assert progress[0]["heartbeat"] and progress[0]["status"] is None
    assert [r["status"] for r in reports[:reports.index(progress[0])] if r["status"]] == ["Solving"]


def test_progress_reporter_spaces_reports_and_ignores_other_lines():
    api, now = FakeApi(), [100.0]
    reporter = ProgressReporter(api, "job-1", target_pct=0.2, min_interval_secs=5.0, clock=lambda: now[0])
    line = "iter {}  nashconv 2  exploitable 1 ({}% of pot)  ev 46 54  elapsed 3 s"
    reporter("solve id abc123")
    reporter("iter 25")                    # a sampled solve's line: no accuracy on it
    assert api.reports == []
    reporter(line.format(25, 4.8))
    now[0] += 1.0
    reporter(line.format(50, 1.1))         # too soon: dropped
    now[0] += 5.0
    reporter(line.format(75, 0.4))
    assert [(r["job_id"], r["progress"]["iteration"], r["progress"]["exploitable_pct"])
            for r in api.reports] == [("job-1", 25, 4.8), ("job-1", 75, 0.4)]
    assert all(r["progress"]["target_pct"] == 0.2 for r in api.reports)


def test_dry_run_refusal_fails_the_job_before_solving(tmp_path):
    engine = FakeEngine(dry_ok=False, dry_message="tree needs 31.2 GB, memory_limit_gb is 24")
    worker, fs = _worker(tmp_path, engine=engine)
    worker.process_job(_job(fs))
    assert worker.api.statuses() == ["Failed"]
    assert "31.2 GB" in worker.api.reports[-1]["error"]
    assert "solve" not in engine.calls


def test_missing_engine_tree_fails_with_a_clear_message(tmp_path):
    worker, fs = _worker(tmp_path)
    blob = gametree_blob()
    del blob["EngineTree"]
    worker.process_job(_job(fs, blob))
    assert worker.api.statuses() == ["Failed"]
    assert "no engine tree" in worker.api.reports[-1]["error"]
    assert worker.engine.calls == []


def test_icm_blob_is_refused(tmp_path):
    worker, fs = _worker(tmp_path)
    worker.process_job(_job(fs, gametree_blob(IsICM=True)))
    assert worker.api.statuses() == ["Failed"]
    assert "ICM" in worker.api.reports[-1]["error"]


def test_solve_failure_reports_the_engine_error(tmp_path):
    worker, fs = _worker(tmp_path, engine=FakeEngine(solve_exit=3))
    worker.process_job(_job(fs))
    assert worker.api.statuses() == ["Solving", "Failed"]
    assert "out of memory" in worker.api.reports[-1]["error"]


# ------------------------------------------------------------ node requests

def _solved_board(tmp_path, **kw):
    worker, fs = _worker(tmp_path, **kw)
    worker.process_job(_job(fs))
    assert worker.api.statuses()[-1] == "Done"
    return worker, fs


def _req(node_id=RIVER_SEED):
    return {"stacks": STACKS, "node_name": NODE_NAME, "board": BOARD_KEY, "node_id": node_id}


def test_river_from_a_held_artifact(tmp_path):
    worker, fs = _solved_board(tmp_path)
    worker.handle_node_request(_req())
    assert worker.engine.dumps[-1] == {"through": None, "seeds": [RIVER_SEED], "equity": True}
    assert "solve" not in worker.engine.calls[2:]
    manifest = fs.json(f"{BASE}/manifest.json")
    entry = manifest["streets"][RIVER_SEED.replace(":", ".")]
    assert entry["extracted"] is True and entry["street"] == "river"
    bundle = fs.json(f"{BASE}/streets/{RIVER_SEED.replace(':', '.')}.json.gz")
    assert len(bundle["hand_order"]) == 1326
    assert bundle["nodes"][RIVER_SEED.replace(":", ".")]["seat_stats"]["oop"]["equity"] is not None
    # Asking again is a no-op.
    n = len(worker.engine.calls)
    worker.handle_node_request(_req())
    assert len(worker.engine.calls) == n


def test_evicted_artifact_resolves_pinned_then_extracts(tmp_path):
    worker, fs = _solved_board(tmp_path)
    os.remove(worker.registry.lookup(STACKS, NODE_NAME, BOARD_KEY))
    worker.handle_node_request(_req())

    # The viewer saw "resolving" before the re-solve ran.
    suffix = RIVER_SEED.replace(":", ".")
    states = [m["streets"].get(suffix, {}) for m in fs.versions(f"{BASE}/manifest.json")]
    assert any(s.get("status") == "resolving" for s in states)
    assert states[-1]["extracted"] is True and "status" not in states[-1]

    pinned = worker.engine.solve_configs[-1]
    assert pinned["budget"]["iterations"] == 640
    assert pinned["budget"]["target_exploitable_pct"] == 0
    assert "max_seconds" not in pinned["budget"]
    assert pinned["output"]["path"].endswith(".hta")
    # Same engine build: flop and turns are not republished.
    assert worker.engine.calls[-2:] == ["solve", f"dump:{RIVER_SEED}"]


def test_engine_build_change_republishes_and_drops_old_rivers(tmp_path):
    worker, fs = _solved_board(tmp_path)
    old_river = "r:0:c:c:Th:c:c:5s"
    from ht_fakes import river_street
    worker.engine.rivers[old_river] = river_street(old_river)
    worker.handle_node_request(_req(old_river))
    assert old_river.replace(":", ".") in fs.json(f"{BASE}/manifest.json")["streets"]

    os.remove(worker.registry.lookup(STACKS, NODE_NAME, BOARD_KEY))
    worker.engine.metadata = {**METADATA, "engine_build": "build-2"}
    flop_uploads = fs.uploads.count(f"{BASE}/streets/r.0.json.gz")
    worker.handle_node_request(_req())

    manifest = fs.json(f"{BASE}/manifest.json")
    assert old_river.replace(":", ".") not in manifest["streets"]
    assert manifest["streets"][RIVER_SEED.replace(":", ".")]["extracted"] is True
    assert set(manifest["streets"]) == {"r.0", "r.0.c.c.Th", RIVER_SEED.replace(":", ".")}
    assert fs.uploads.count(f"{BASE}/streets/r.0.json.gz") == flop_uploads + 1
    assert manifest["engine"]["build"] == "build-2"
    assert fs.json(f"{BASE}/solve.json")["engine_build"] == "build-2"
    assert fs.json(f"{BASE}/solve.json")["iterations_run"] == 640


def test_pio_manifest_is_refused(tmp_path):
    worker, fs = _worker(tmp_path)
    fs.put_json(f"{BASE}/manifest.json", {"board": BOARD_KEY, "streets": {}, "cfr": {"available": True}})
    worker.handle_node_request(_req())
    assert worker.engine.calls == []
    assert fs.uploads == []


def test_street_without_decisions_removes_the_entry(tmp_path):
    worker, fs = _solved_board(tmp_path)
    os.remove(worker.registry.lookup(STACKS, NODE_NAME, BOARD_KEY))
    seed = "r:0:c:c:Th:c:c:9s"   # FakeEngine answers unknown seeds with an empty street
    worker.handle_node_request(_req(seed))
    assert seed.replace(":", ".") not in fs.json(f"{BASE}/manifest.json")["streets"]


def test_failed_resolve_clears_the_resolving_flag(tmp_path):
    worker, fs = _solved_board(tmp_path)
    os.remove(worker.registry.lookup(STACKS, NODE_NAME, BOARD_KEY))
    worker.engine.solve_exit = 1
    with pytest.raises(Exception):
        worker.handle_node_request(_req())
    assert RIVER_SEED.replace(":", ".") not in fs.json(f"{BASE}/manifest.json")["streets"]


def test_queue_handling_deletes_parks_and_redelivers(tmp_path):
    good = FakeMessage(json.dumps({**_req(), "requested_utc": "2026-11-16T00:00:00Z"}))
    junk = FakeMessage("not json")
    poisoned = FakeMessage(json.dumps(_req()), dequeue_count=5)
    queue, poison = FakeQueue([good, junk, poisoned]), FakeQueue()
    worker, fs = _solved_board(tmp_path, queue=queue, poison=poison)
    while worker.drain_node_requests_once():
        pass
    assert queue.deleted == [good, junk, poisoned]
    assert poison.sent == ["not json", poisoned.content]
    assert fs.json(f"{BASE}/manifest.json")["streets"][RIVER_SEED.replace(":", ".")]["extracted"]

    # A transient failure leaves the message to redeliver.
    retry = FakeMessage(json.dumps(_req("r:0:c:c:Th:c:c:4d")))
    queue.messages.append(retry)
    worker.engine.dump_streets = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("disk"))
    assert worker.drain_node_requests_once()
    assert retry not in queue.deleted


# -------------------------------------------------------------------- drain

def test_drain_finishes_in_flight_work_then_exits_0(tmp_path, capsys):
    gate = threading.Event()
    engine = FakeEngine(solve_gate=gate)
    worker, fs = _worker(tmp_path, engine=engine, queue=FakeQueue())
    stale = worker.settings.drain_file
    with open(stale, "w") as f:
        f.write("left over")
    worker.api.jobs.append(_job(fs))

    result = {}
    runner = threading.Thread(target=lambda: result.setdefault("rc", worker.run()))
    runner.start()
    deadline = time.time() + 5
    while "solve" not in engine.calls and time.time() < deadline:
        time.sleep(0.01)
    assert "solve" in engine.calls, "the stale drain file must be cleared at startup"

    open(worker.settings.drain_file, "w").close()   # drain while the solve is running
    time.sleep(0.05)
    assert runner.is_alive()                        # ... it waits for the job
    gate.set()
    runner.join(timeout=10)
    assert not runner.is_alive()
    assert result["rc"] == 0
    assert worker.api.statuses()[-1] == "Done"
    claims_at_exit = len(worker.api.claims)
    assert claims_at_exit == 1                      # nothing claimed after the drain
    assert "drained" in capsys.readouterr().out


# ---------------------------------------------------------------- convergence
# What the engine stamps on a solve that ran out of time 0.913% of the pot
# exploitable, against a 0.2% target (pot 100, so 0.913 chips per player).
TIMED_OUT = {
    **METADATA,
    "final_nashconv": 1.826,
    "final_exploitable_pct_pot": 0.913,
    "solved": {"target_exploitable_pct": 0.2, "reached": False,
               "last_exploitable_pct_pot": 0.913, "stopped_reason": "time_budget"},
}


def test_a_solve_that_missed_its_target_is_published_and_says_so(tmp_path, capsys):
    engine = FakeEngine(metadata=TIMED_OUT)
    worker, fs = _worker(tmp_path, engine=engine)
    worker.process_job(_job(fs))

    # The whole flow ran: the job is Done and the board is in the library.
    assert worker.api.statuses() == ["Solving", "Extracting", "Uploading", "Done"]
    assert worker.api.reports[-1]["index_entry"]["turn_streets"] == 1
    out = capsys.readouterr().out
    assert "not converged: stopped at 0.913% of pot after 640 iterations (time_budget)" in out

    # ... and the manifest says how far it got, beside the target it missed.
    block = fs.json(f"{BASE}/manifest.json")["engine"]
    assert block["converged"] is False
    assert block["exploitable_pct_pot"] == pytest.approx(0.913)
    assert block["target_exploitable_pct"] == pytest.approx(0.2)
    assert block["exploitable"] == pytest.approx(0.913)      # chips, as before
    # The record a river re-solve pins to keeps the target it was solved against.
    record = fs.json(f"{BASE}/solve.json")
    assert record["iterations_run"] == 640
    assert record["config"]["budget"]["target_exploitable_pct"] == 0.2


def test_a_board_that_stopped_short_still_says_so_after_a_pinned_rebuild(tmp_path):
    # Solved short of the target, artifact evicted, engine rebuilt: the first
    # river request re-solves pinned (no target, so the artifact claims no
    # shortfall of its own) and republishes the flop and turns from it.
    worker, fs = _worker(tmp_path, engine=FakeEngine(metadata=TIMED_OUT))
    worker.process_job(_job(fs))
    os.remove(worker.registry.lookup(STACKS, NODE_NAME, BOARD_KEY))
    worker.engine.metadata = {
        **TIMED_OUT, "engine_build": "build-2",
        "solved": {"target_exploitable_pct": None, "reached": None,
                   "last_exploitable_pct_pot": 0.913, "stopped_reason": "budget"},
    }
    worker.handle_node_request(_req())

    block = fs.json(f"{BASE}/manifest.json")["engine"]
    assert block["build"] == "build-2"
    assert block["converged"] is False
    assert block["exploitable_pct_pot"] == pytest.approx(0.913)
    assert block["target_exploitable_pct"] == pytest.approx(0.2)


def test_a_converged_board_carries_its_accuracy_too(tmp_path):
    engine = FakeEngine(metadata={
        **METADATA, "final_exploitable_pct_pot": 0.19,
        "solved": {"target_exploitable_pct": 0.2, "reached": True,
                   "last_exploitable_pct_pot": 0.19, "stopped_reason": "budget"},
    })
    worker, fs = _worker(tmp_path, engine=engine)
    worker.process_job(_job(fs))
    block = fs.json(f"{BASE}/manifest.json")["engine"]
    assert block["converged"] is True and block["exploitable_pct_pot"] == pytest.approx(0.19)


@pytest.mark.parametrize("solved, expected", [
    # Never measured: there is no number to put on the board.
    ({"target_exploitable_pct": 0.2, "reached": None, "last_exploitable_pct_pot": None,
      "stopped_reason": "time_budget"}, "before its accuracy was measured"),
    # Stopped on request, not by its budget: not a result.
    ({"target_exploitable_pct": 0.2, "reached": False, "last_exploitable_pct_pot": 0.913,
      "stopped_reason": "cancelled"}, "stopped on request at 0.913% of pot"),
])
def test_a_solve_that_cannot_be_labelled_is_still_failed(tmp_path, solved, expected):
    engine = FakeEngine(metadata={**METADATA, "solved": solved})
    worker, fs = _worker(tmp_path, engine=engine)
    worker.process_job(_job(fs))

    status, error = worker.api.reports[-1]["status"], worker.api.reports[-1]["error"]
    assert status == "Failed" and expected in error and "0.2% target" in error
    # Nothing was published: no manifest, no bundle, no index entry.
    assert not [p for p in fs.files if p.startswith("piosolutions/")]
    assert all(r.get("index_entry") is None for r in worker.api.reports)


def test_a_solve_that_reached_its_target_and_a_pinned_resolve_have_no_shortfall():
    from ht_solve_watcher import convergence_shortfall

    assert convergence_shortfall({"solved": {"target_exploitable_pct": 0.2, "reached": True}}) is None
    # A pinned re-solve reproduces a published solve by iteration count and
    # sets no target, so there is nothing to have missed.
    assert convergence_shortfall({"solved": {"target_exploitable_pct": None, "reached": None}}) is None
    assert convergence_shortfall({"solved": {"target_exploitable_pct": 0, "reached": None}}) is None
    assert convergence_shortfall({}) is None
