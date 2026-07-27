"""Local .cfr retention: unique naming per solve + LRU disk budget.

The Solved directory is the master data store for on-demand extraction, but a
full flop save is ~600MB, so it is capped: least-recently-used saves are
deleted once the budget is exceeded. registry.json records what each file is
so evicted boards can be flagged in ADLS (cfr.available=false).
"""

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


class CfrRegistry:
    def __init__(self, solved_dir: str, max_gb: float = 150.0):
        self.solved_dir = solved_dir
        self.max_bytes = int(max_gb * 1024**3)
        self.registry_path = os.path.join(solved_dir, "registry.json")
        os.makedirs(solved_dir, exist_ok=True)
        self._entries: Dict[str, Dict[str, Any]] = self._load()

    @staticmethod
    def key(stacks: str, node_name: str, board: str) -> str:
        return f"{stacks}|{node_name}|{board}"

    def filename_for(self, stacks: str, node_name: str, board: str) -> str:
        """Unique, short filename: same board on different sims/lines must not
        collide, and node_name is too long to embed (MAX_PATH)."""
        digest = hashlib.sha1(self.key(stacks, node_name, board).encode()).hexdigest()[:10]
        return f"{board}__{digest}.cfr"

    def path_for(self, stacks: str, node_name: str, board: str) -> str:
        return os.path.join(self.solved_dir, self.filename_for(stacks, node_name, board))

    def touch(self, stacks: str, node_name: str, board: str) -> None:
        """Record/refresh an entry after a solve or an on-demand extraction."""
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
        """Full path if the cfr for this solve exists locally, else None."""
        path = self.path_for(stacks, node_name, board)
        return path if os.path.exists(path) else None

    def enforce_budget(self) -> List[Dict[str, Any]]:
        """Delete least-recently-used .cfr files until under budget.
        Returns the evicted registry entries (for ADLS availability flips)."""
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
            path = os.path.join(self.solved_dir, e["file"])
            try:
                os.remove(path)
                total -= e["size"]
                evicted.append(e)
                del self._entries[k]
                log(f"  [cfr] Evicted {e['file']} ({e['size'] / 1e9:.2f} GB) - LRU budget")
            except OSError as err:
                log(f"  [cfr] Could not evict {path}: {err}")
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
        try:
            with open(self.registry_path, "w", encoding="utf-8") as f:
                json.dump(self._entries, f, indent=1)
        except OSError as e:
            log(f"  [cfr] Could not write registry: {e}")


def prune_temp_json(temp_dir: str, max_age_days: float = 7.0) -> None:
    """Delete local debug JSON copies older than max_age_days."""
    if not temp_dir or not os.path.isdir(temp_dir):
        return
    cutoff = time.time() - max_age_days * 86400
    removed = 0
    for name in os.listdir(temp_dir):
        path = os.path.join(temp_dir, name)
        try:
            if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                os.remove(path)
                removed += 1
        except OSError:
            pass
    if removed:
        log(f"  [cfr] Pruned {removed} old TempJson file(s)")
