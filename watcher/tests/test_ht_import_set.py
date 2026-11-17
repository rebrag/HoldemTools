"""The headless worker must not pull in anything Pio or GUI.

Imported in a fresh interpreter so nothing this test process already loaded
can mask an import, and so the check sees exactly what `python
ht_solve_watcher.py` would load at startup.
"""

import json
import os
import subprocess
import sys

WATCHER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORBIDDEN = ("pywinauto", "pyperclip", "pyosolver", "watch_adls_and_run_pio_headless")


def test_worker_imports_nothing_pio_or_gui():
    code = (
        "import json, sys\n"
        "import ht_solve_watcher\n"
        f"bad = sorted(m for m in sys.modules if m.split('.')[0] in {FORBIDDEN!r})\n"
        "print(json.dumps(bad))\n"
    )
    env = {**os.environ, "HOLDEMTOOLS_API_BASE": "http://127.0.0.1:9", "WATCHER_API_KEY": "x",
           "AZURE_STORAGE_CONNECTION_STRING": ""}
    out = subprocess.run([sys.executable, "-c", code], cwd=WATCHER_DIR, env=env,
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout.strip().splitlines()[-1]) == []
