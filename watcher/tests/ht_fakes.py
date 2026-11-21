"""Fakes and contract-shaped fixtures for the htsolver watcher tests.

Nothing here touches Azure, the API or a real engine. The street documents
follow the `engine dump-streets` contract (htsolver solve-jobs plan, section
2) on a toy six-hand universe, small enough to check values by hand.
"""

from __future__ import annotations

import contextlib
import copy
import gzip
import json
import os
import threading
from typing import Any, Dict, List, Optional

from engine_proc import ChildResult

# ---------------------------------------------------------------------------
# Fake ADLS file system
# ---------------------------------------------------------------------------


class FakeFs:
    """Dict-backed stand-in for a DataLake file-system client."""

    def __init__(self) -> None:
        self.files: Dict[str, bytes] = {}
        self.uploads: List[str] = []
        self.history: Dict[str, List[bytes]] = {}
        self._lock = threading.Lock()

    def get_file_client(self, path: str) -> "_FakeFile":
        return _FakeFile(self, path)

    # conveniences for assertions
    def json(self, path: str) -> Any:
        data = self.files[path]
        if path.endswith(".gz"):
            data = gzip.decompress(data)
        return json.loads(data)

    def put_json(self, path: str, obj: Any) -> None:
        self.files[path] = json.dumps(obj).encode("utf-8")

    def versions(self, path: str) -> List[Any]:
        return [json.loads(v) for v in self.history.get(path, [])]


class _FakeFile:
    def __init__(self, fs: FakeFs, path: str) -> None:
        self.fs = fs
        self.path = path

    def upload_data(self, data: Any, overwrite: bool = True) -> None:
        raw = data.encode("utf-8") if isinstance(data, str) else bytes(data)
        with self.fs._lock:
            self.fs.files[self.path] = raw
            self.fs.uploads.append(self.path)
            self.fs.history.setdefault(self.path, []).append(raw)

    def download_file(self) -> "_FakeFile":
        if self.path not in self.fs.files:
            raise FileNotFoundError(self.path)
        return self

    def readall(self) -> bytes:
        return self.fs.files[self.path]

    def exists(self) -> bool:
        return self.path in self.fs.files


# ---------------------------------------------------------------------------
# Fake API (the api_client surface the worker uses)
# ---------------------------------------------------------------------------


class FakeApi:
    def __init__(self, jobs: Optional[List[Dict[str, Any]]] = None) -> None:
        self.jobs = list(jobs or [])
        self.reports: List[Dict[str, Any]] = []
        self.claims: List[str] = []
        self._lock = threading.Lock()

    def claim_next(self, solver: str = "pio") -> Optional[Dict[str, Any]]:
        with self._lock:
            self.claims.append(solver)
            return self.jobs.pop(0) if self.jobs else None

    def report(self, job_id: str, status: Optional[str] = None, error: Optional[str] = None,
               heartbeat: bool = False, result: Optional[Dict[str, Any]] = None,
               index_entry: Optional[Dict[str, Any]] = None,
               progress: Optional[Dict[str, Any]] = None, **_: Any) -> bool:
        with self._lock:
            self.reports.append({"job_id": job_id, "status": status, "error": error,
                                 "heartbeat": heartbeat, "result": result,
                                 "index_entry": copy.deepcopy(index_entry),
                                 "progress": copy.deepcopy(progress)})
        return True

    @contextlib.contextmanager
    def Heartbeat(self, job_id: str):  # noqa: N802 - mirrors api_client.Heartbeat
        yield

    def statuses(self) -> List[Optional[str]]:
        return [r["status"] for r in self.reports if r["status"]]


# ---------------------------------------------------------------------------
# Fake queue
# ---------------------------------------------------------------------------


class FakeMessage:
    def __init__(self, content: str, dequeue_count: int = 1) -> None:
        self.content = content
        self.dequeue_count = dequeue_count


class FakeQueue:
    def __init__(self, messages: Optional[List[FakeMessage]] = None) -> None:
        self.messages = list(messages or [])
        self.deleted: List[FakeMessage] = []
        self.sent: List[str] = []

    def receive_message(self, visibility_timeout: int = 30) -> Optional[FakeMessage]:
        return self.messages.pop(0) if self.messages else None

    def delete_message(self, msg: FakeMessage) -> None:
        self.deleted.append(msg)

    def send_message(self, content: str) -> None:
        self.sent.append(content)


# ---------------------------------------------------------------------------
# Contract-shaped dump-streets documents
# ---------------------------------------------------------------------------

# The artifact's compact hand dictionary (seat 0's; both seats share it).
HANDS = ["AsAh", "AdAc", "KsKh", "QsJs", "7h6h", "AhKh"]
BOARD = ["8d", "4c", "2c"]
ROOT_POT = 100

METADATA = {
    "board": "8d 4c 2c",
    "pot": ROOT_POT,
    "chip_scale": 1.0,
    "effective_stack": 400,
    "ev_chips": [46.0, 54.0],
    "final_nashconv": 0.4,
    "iterations": 640,
    "config_hash": "abc123",
    "solver_version": "0.1.0",
    "engine_build": "build-1",
    "seats": ["SB", "BTN"],
}


def seat(idx: List[int], reach: List[float], ev: List[float], eq: Optional[List[float]] = None,
         mu: Optional[List[float]] = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {"idx": idx, "reach": reach, "ev": ev}
    if eq is not None:
        out["eq"] = eq
    if mu is not None:
        out["mu"] = mu
    return out


def flop_street() -> Dict[str, Any]:
    """Root decision, an IP decision, a fold terminal, a SPLIT_NODE (check
    through) and an all-in-and-call runout with nothing below it."""
    oop = seat([0, 1, 2], [1.0, 0.5, 0.25], [41.2, 12.0, 30.0], [0.71, 0.33, 0.6], [301.5, 298.0, 280.0])
    ip = seat([3, 4, 5], [1.0, 0.8, 0.6], [20.0, -5.0, 15.5], [0.4, 0.2, 0.55], [300.0, 250.0, 220.0])
    return {
        "seed": "r:0", "street": "flop", "board": list(BOARD),
        "nodes": [
            {"id": "r:0", "node_id": 0, "kind": "decision", "actor": 0, "pot": ROOT_POT,
             "commit": [0, 0], "actions": ["c", "b50"], "children": ["r:0:c", "r:0:b50"],
             "seats": [oop, ip],
             # [action][position in the actor's idx list]
             "strategy": [[0.2, 0.8, 0.5], [0.8, 0.2, 0.5]],
             "action_ev": [[40.0, 11.0, 29.0], [42.0, 13.0, 31.0]]},
            {"id": "r:0:c", "node_id": 1, "kind": "decision", "actor": 1, "pot": ROOT_POT,
             "commit": [0, 0], "actions": ["c"], "children": ["r:0:c:c"],
             "seats": [seat([0, 1, 2], [0.2, 0.4, 0.125], [5.0, 6.0, 7.0], [0.7, 0.3, 0.6], [1, 1, 1]),
                       seat([3, 4, 5], [1.0, 0.8, 0.6], [20.0, -5.0, 15.5], [0.4, 0.2, 0.55], [1, 1, 1])],
             "strategy": [[1.0, 1.0, 1.0]], "action_ev": [[20.0, -5.0, 15.5]]},
            {"id": "r:0:c:c", "node_id": 2, "kind": "chance", "has_decisions": True},
            {"id": "r:0:b50", "node_id": 3, "kind": "decision", "actor": 1, "pot": ROOT_POT,
             "commit": [50, 0], "actions": ["f", "c"], "children": ["r:0:b50:f", "r:0:b50:c"],
             "seats": [seat([0, 1, 2], [0.8, 0.1, 0.125], [60.0, 50.0, 55.0], [0.8, 0.5, 0.6], [1, 1, 1]),
                       seat([3, 4, 5], [1.0, 0.8, 0.6], [10.0, -50.0, 5.0], [0.3, 0.1, 0.4], [1, 1, 1])],
             "strategy": [[0.3, 0.9, 0.5], [0.7, 0.1, 0.5]],
             "action_ev": [[0.0, 0.0, 0.0], [12.0, -60.0, 6.0]]},
            {"id": "r:0:b50:f", "node_id": 4, "kind": "terminal", "terminal": "fold"},
            {"id": "r:0:b50:c", "node_id": 5, "kind": "chance", "has_decisions": False},
        ],
    }


def turn_street() -> Dict[str, Any]:
    return {
        "seed": "r:0:c:c:Th", "street": "turn", "board": BOARD + ["Th"],
        "nodes": [
            {"id": "r:0:c:c:Th", "node_id": 10, "kind": "decision", "actor": 0, "pot": ROOT_POT,
             "commit": [0, 0], "actions": ["c"], "children": ["r:0:c:c:Th:c"],
             "seats": [seat([0, 1], [0.2, 0.4], [5.0, 6.0], [0.7, 0.3], [1, 1]),
                       seat([3, 4, 5], [1.0, 0.8, 0.6], [20.0, -5.0, 15.5], [0.4, 0.2, 0.55], [1, 1, 1])],
             "strategy": [[1.0, 1.0]], "action_ev": [[5.0, 6.0]]},
            {"id": "r:0:c:c:Th:c", "node_id": 11, "kind": "decision", "actor": 1, "pot": ROOT_POT,
             "commit": [0, 0], "actions": ["c"], "children": ["r:0:c:c:Th:c:c"],
             "seats": [seat([0, 1], [0.2, 0.4], [5.0, 6.0], [0.7, 0.3], [1, 1]),
                       seat([3, 4, 5], [1.0, 0.8, 0.6], [20.0, -5.0, 15.5], [0.4, 0.2, 0.55], [1, 1, 1])],
             "strategy": [[1.0, 1.0, 1.0]], "action_ev": [[20.0, -5.0, 15.5]]},
            {"id": "r:0:c:c:Th:c:c", "node_id": 12, "kind": "chance", "has_decisions": True},
        ],
    }


RIVER_SEED = "r:0:c:c:Th:c:c:3d"


def river_street(seed: str = RIVER_SEED) -> Dict[str, Any]:
    return {
        "seed": seed, "street": "river", "board": BOARD + ["Th", seed.split(":")[-1]],
        "nodes": [
            {"id": seed, "node_id": 20, "kind": "decision", "actor": 0, "pot": ROOT_POT,
             "commit": [0, 0], "actions": ["c"], "children": [seed + ":c"],
             "seats": [seat([0, 1], [0.2, 0.4], [5.0, 6.0], [1.0, 0.0], [1, 1]),
                       seat([3, 4, 5], [1.0, 0.8, 0.6], [20.0, -5.0, 15.5], [0.0, 0.0, 1.0], [1, 1, 1])],
             "strategy": [[1.0, 1.0]], "action_ev": [[5.0, 6.0]]},
            {"id": seed + ":c", "node_id": 21, "kind": "terminal", "terminal": "showdown"},
        ],
    }


def empty_street(seed: str) -> Dict[str, Any]:
    """A street the engine wrote with no decision node (nothing to show)."""
    return {"seed": seed, "street": "river", "board": BOARD + ["Th", seed.split(":")[-1]], "nodes": []}


def write_dump(out_dir: str, streets: List[Dict[str, Any]], metadata: Optional[Dict[str, Any]] = None
               ) -> Dict[str, Any]:
    """Write a dump-streets output directory exactly as the contract says."""
    os.makedirs(out_dir, exist_ok=True)
    entries = []
    for doc in streets:
        name = doc["seed"].replace(":", ".") + ".json"
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            json.dump(doc, f)
        entries.append({
            "seed": doc["seed"], "street": doc["street"], "board": doc["board"],
            "decision_nodes": sum(1 for n in doc["nodes"] if n.get("kind") == "decision"),
            "file": name,
        })
    top = {"metadata": dict(metadata or METADATA), "hands": list(HANDS), "streets": entries}
    with open(os.path.join(out_dir, "streets.json"), "w", encoding="utf-8") as f:
        json.dump(top, f)
    return top


# ---------------------------------------------------------------------------
# Fake engine
# ---------------------------------------------------------------------------


# What a solve prints, in the engine's own format (engine/src/main.cpp): a
# header, one line per checkpoint, the stop reason.
SOLVE_LINES = [
    "solve id abc123",
    "iter 25  nashconv 9.6  exploitable 4.8 (4.8% of pot)  ev 44.1 55.9  elapsed 0.4 s",
    "iter 50  nashconv 0.38  exploitable 0.19 (0.19% of pot)  ev 46 54  elapsed 0.8 s",
    "target_exploitable_pct reached",
    "wrote artifact",
]


class FakeEngine:
    """dry_run / solve / dump_streets over the toy street documents.

    `solve` writes a small artifact at the config's output.path and records
    the config it was given; `dump_streets` answers from the documents above
    with `metadata` (so a test can change the engine build between calls).
    """

    def __init__(self, *, dry_ok: bool = True, dry_message: str = "",
                 solve_exit: int = 0, metadata: Optional[Dict[str, Any]] = None,
                 rivers: Optional[Dict[str, Dict[str, Any]]] = None,
                 solve_gate: Optional[threading.Event] = None) -> None:
        self.dry_ok = dry_ok
        self.dry_message = dry_message
        self.solve_exit = solve_exit
        self.metadata = dict(metadata or METADATA)
        self.rivers = rivers or {RIVER_SEED: river_street()}
        self.solve_gate = solve_gate
        self.solve_configs: List[Dict[str, Any]] = []
        self.dumps: List[Dict[str, Any]] = []
        self.calls: List[str] = []

    def dry_run(self, config_path: str):
        self.calls.append("dry_run")
        return self.dry_ok, self.dry_message

    def solve(self, config_path: str, *, timeout: float, affinity=None, on_line=None) -> ChildResult:
        self.calls.append("solve")
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        self.solve_configs.append(config)
        if self.solve_gate is not None:
            self.solve_gate.wait(10)
        if self.solve_exit == 0:
            path = config["output"]["path"]
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(b"HTA0" * 256)
            lines = list(SOLVE_LINES)
        else:
            lines = ["error: out of memory"]
        # As run_streamed does: every line reaches the callback as it arrives.
        for line in lines:
            if on_line is not None:
                on_line(line)
        return ChildResult(self.solve_exit, lines)

    def dump_streets(self, artifact: str, out_dir: str, *, through=None, seeds=None, equity=True):
        self.calls.append(f"dump:{through or ','.join(seeds or [])}")
        self.dumps.append({"through": through, "seeds": list(seeds or []), "equity": equity})
        assert os.path.exists(artifact), "dump-streets on a missing artifact"
        if through == "flop":
            docs = [flop_street()]
        elif through == "turn":
            docs = [flop_street(), turn_street()]
        else:
            docs = [self.rivers.get(s) or empty_street(s) for s in seeds or []]
        return write_dump(out_dir, docs, self.metadata)


# ---------------------------------------------------------------------------
# A gametree blob the API would write
# ---------------------------------------------------------------------------

ENGINE_TREE = {
    "schema": 1, "game": "nlhe", "board": "8d 4c 2c", "pot": ROOT_POT, "chip_scale": 1,
    "players": [{"seat": "SB", "stack": 400, "range": "AA,KK"},
                {"seat": "BTN", "stack": 400, "range": "QJs,76s,AKs"}],
    "bet_sizing": {"flop": {"oop": {"bets": [50]}, "ip": {"bets": [50]}}, "turn": {}, "river": {}},
    "preflop_aggressor": "none",
}

BLOB_PATH = "gametrees/2026/11/16/uid1/folder=400SB_400BTN/Root_Call_pos=SB_icm=0.json"
STACKS = "400SB_400BTN"
NODE_NAME = "Root_Call_pos=SB_icm=0"
BOARD_KEY = "8d4c2c"
BASE = f"piosolutions/{STACKS}/{NODE_NAME}/{BOARD_KEY}"


def gametree_blob(**overrides: Any) -> Dict[str, Any]:
    blob = {
        "Text": "#Board#8d 4c 2c\n#Pot#100\n",
        "EngineTree": copy.deepcopy(ENGINE_TREE),
        "Solver": "htsolver",
        "AlivePositions": ["SB", "BTN"],
        "ActingPos": "SB",
        "Line": ["Root", "Call"],
        "IsICM": False,
        "Seats": [{"Pos": "SB", "Name": "Hero", "StackChips": 400, "Hero": True, "Cards": ["As", "Ah"]},
                  {"Pos": "BTN", "Name": "Villain", "StackChips": 400}],
        "BigBlind": 2,
        "ChipScale": 1,
    }
    blob.update(overrides)
    return blob
