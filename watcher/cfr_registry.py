"""Local .cfr retention: unique naming per solve + LRU disk budget.

The Solved directory is the master data store for on-demand extraction, but a
full flop save is ~600MB, so it is capped: least-recently-used saves are
deleted once the budget is exceeded. registry.json records what each file is
so evicted boards can be flagged in ADLS (cfr.available=false).

The implementation is artifact_registry.ArtifactRegistry, shared with the
htsolver worker; this subclass pins the extension to ".cfr", so file names and
the existing registry.json stay exactly what the Pio watcher always wrote.
"""

import os
import time
from datetime import datetime

from artifact_registry import ArtifactRegistry


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


class CfrRegistry(ArtifactRegistry):
    def __init__(self, solved_dir: str, max_gb: float = 150.0):
        super().__init__(solved_dir, max_gb=max_gb, ext=".cfr")


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
