"""Local solve-artifact retention: unique naming per solve + LRU disk budget.

The local artifact directory is the master data store for on-demand street
extraction, but a full flop save is gigabytes, so it is capped: the least
recently used files are deleted once the budget is exceeded. `registry.json`
records what each file is so an evicted board can be handled later (the Pio
watcher flags it in ADLS; the htsolver worker re-solves it on demand).

Generalized from cfr_registry.CfrRegistry (now a thin subclass) so both
solvers share one implementation:
  - any file extension (".cfr" for Pio, ".hta" for htsolver);
  - one lock around every read-modify-write, since the htsolver worker
    touches the registry from its solve slots and its node-request thread;
  - pinning, so an artifact being written or read is never evicted from
    under the process using it.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


class ArtifactRegistry:
    def __init__(self, solved_dir: str, max_gb: float = 150.0, ext: str = ".cfr"):
        self.solved_dir = solved_dir
        self.max_bytes = int(max_gb * 1024**3)
        self.ext = ext if ext.startswith(".") else "." + ext
        self.tag = self.ext.lstrip(".")
        self.registry_path = os.path.join(solved_dir, "registry.json")
        os.makedirs(solved_dir, exist_ok=True)
        self._lock = threading.RLock()
        self._pins: Dict[str, int] = {}
        self._entries: Dict[str, Dict[str, Any]] = self._load()

    @staticmethod
    def key(stacks: str, node_name: str, board: str) -> str:
        return f"{stacks}|{node_name}|{board}"

    def filename_for(self, stacks: str, node_name: str, board: str) -> str:
        """Unique, short filename: same board on different sims/lines must not
        collide, and node_name is too long to embed (MAX_PATH)."""
        digest = hashlib.sha1(self.key(stacks, node_name, board).encode()).hexdigest()[:10]
        return f"{board}__{digest}{self.ext}"

    def path_for(self, stacks: str, node_name: str, board: str) -> str:
        return os.path.join(self.solved_dir, self.filename_for(stacks, node_name, board))

    def touch(self, stacks: str, node_name: str, board: str) -> None:
        """Record/refresh an entry after a solve or an on-demand extraction."""
        with self._lock:
            k = self.key(stacks, node_name, board)
            path = self.path_for(stacks, node_name, board)
            size = os.path.getsize(path) if os.path.exists(path) else None
            self._entries[k] = {
                "file": os.path.basename(path),
                "size": size,
                "last_access_utc": datetime.now(timezone.utc).isoformat(),
                "stacks": stacks,
                "node_name": node_name,
                "board": board,
            }
            self._save()

    def lookup(self, stacks: str, node_name: str, board: str) -> Optional[str]:
        """Full path if the artifact for this solve exists locally, else None."""
        path = self.path_for(stacks, node_name, board)
        return path if os.path.exists(path) else None

    # --- pinning ---------------------------------------------------------
    def pin(self, key: str) -> None:
        """Protect `key` (see key()) from eviction until a matching unpin.
        Pins nest: two users of one artifact both have to let go."""
        with self._lock:
            self._pins[key] = self._pins.get(key, 0) + 1

    def unpin(self, key: str) -> None:
        with self._lock:
            n = self._pins.get(key, 0) - 1
            if n > 0:
                self._pins[key] = n
            else:
                self._pins.pop(key, None)

    def is_pinned(self, key: str) -> bool:
        with self._lock:
            return key in self._pins

    @contextlib.contextmanager
    def pinned(self, key: str) -> Iterator[None]:
        self.pin(key)
        try:
            yield
        finally:
            self.unpin(key)

    # --- budget ----------------------------------------------------------
    def enforce_budget(self) -> List[Dict[str, Any]]:
        """Delete least-recently-used files until under budget, never a pinned
        one. Returns the evicted registry entries."""
        with self._lock:
            sized = [
                (k, e) for k, e in self._entries.items()
                if e.get("size") and os.path.exists(os.path.join(self.solved_dir, e["file"]))
            ]
            total = sum(e["size"] for _, e in sized)
            if total <= self.max_bytes:
                return []

            sized.sort(key=lambda kv: kv[1].get("last_access_utc") or "")
            evicted: List[Dict[str, Any]] = []
            for k, e in sized:
                if total <= self.max_bytes:
                    break
                if k in self._pins:
                    continue
                path = os.path.join(self.solved_dir, e["file"])
                try:
                    os.remove(path)
                    total -= e["size"]
                    evicted.append(e)
                    del self._entries[k]
                    log(f"  [{self.tag}] Evicted {e['file']} ({e['size'] / 1e9:.2f} GB) - LRU budget")
                except OSError as err:
                    log(f"  [{self.tag}] Could not evict {path}: {err}")
            if evicted:
                self._save()
            return evicted

    def _load(self) -> Dict[str, Dict[str, Any]]:
        try:
            with open(self.registry_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self) -> None:
        # Write-then-rename so a crash mid-write cannot leave a truncated
        # registry.json that would forget every entry on the next start.
        tmp = self.registry_path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._entries, f, indent=1)
            os.replace(tmp, self.registry_path)
        except OSError as e:
            log(f"  [{self.tag}] Could not write registry: {e}")
