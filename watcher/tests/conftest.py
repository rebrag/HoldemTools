"""Shared pytest setup for the watcher tests.

The watcher modules are flat scripts in `watcher/`, not a package, so the
directory goes on sys.path here once for every test module.
Nothing in this suite talks to Azure, the API or an engine process: every
collaborator is a fake defined in the tests themselves. The one piece of real
engine output is data, not a process: the committed dump-streets fixture that
test_ht_real_dump.py feeds the adapter.
"""

import os
import sys
from datetime import datetime, timezone

import pytest

WATCHER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if WATCHER_DIR not in sys.path:
    sys.path.insert(0, WATCHER_DIR)

# api_client calls load_dotenv() at import, which would pull a developer's
# real watcher/.env into this process. python-dotenv never overrides a
# variable that is already set, so pinning harmless values FIRST guarantees
# no test can reach the real API or storage account even by accident.
os.environ["HOLDEMTOOLS_API_BASE"] = "http://127.0.0.1:9"
os.environ["WATCHER_API_KEY"] = "test-key"
os.environ["WATCHER_ID"] = "test-watcher"
os.environ["AZURE_STORAGE_CONNECTION_STRING"] = ""

FIXED_NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


class FrozenDateTime(datetime):
    """datetime with a pinned now(), so builders that stamp times are golden-testable."""

    @classmethod
    def now(cls, tz=None):  # type: ignore[override]
        return FIXED_NOW if tz is not None else FIXED_NOW.replace(tzinfo=None)


@pytest.fixture
def frozen_time(monkeypatch):
    """Pin every timestamp the schema builders write."""
    import extraction

    monkeypatch.setattr(extraction, "datetime", FrozenDateTime)
    return FIXED_NOW
