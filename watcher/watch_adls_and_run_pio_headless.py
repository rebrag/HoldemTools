import os
import sys
import json
import time
import re
from datetime import datetime, timedelta, timezone
from typing import List, Tuple, Set, Optional, IO, Any, Dict
import subprocess
import math
import threading
import queue
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- Azure Data Lake (Gen2) ---
from azure.core.exceptions import ResourceExistsError
from azure.storage.blob import BlobServiceClient
from azure.storage.filedatalake import DataLakeServiceClient
from azure.storage.queue import QueueClient

# --- Local pipeline modules ---
from extraction import (
    CARD_SEG_RE,
    build_board_context,
    build_manifest,
    build_street_bundle,
    context_from_manifest,
    extract_board,
    node_id_to_suffix,
    parse_gametree_path,
    street_entry,
)
from adls_store import (
    board_base_path,
    download_manifest,
    mark_cfr_unavailable,
    upload_manifest,
    upload_street_bundle,
    upsert_library_index,
)
from cfr_registry import CfrRegistry, prune_temp_json
import api_client

# --- Windows UI automation & clipboard ---
from pywinauto import Application, keyboard, findwindows
from pywinauto.mouse import click
from pywinauto.timings import Timings
import pyperclip

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

try:
    from pywinauto.base_wrapper import BaseWrapper  # type: ignore
except Exception:
    BaseWrapper = object  # fallback


# =========================
# Speed knobs
# =========================
try:
    Timings.fast()
except Exception:
    pass


def _set_timing(name: str, value: float):
    if hasattr(Timings, name):
        setattr(Timings, name, value)


_set_timing("after_clickinput_wait", 0.05)
_set_timing("after_setfocus_wait", 0.05)
_set_timing("after_sendkeys_key_wait", 0.05)
_set_timing("wait_between_actions", 0.05)

POLL_SECS = float(os.getenv("POLL_SECS", "0.6"))
# Gametree claim polls hit the App Service (Free F1: 60 CPU-min/day is the
# scarce resource there). One gametree per 1-2 hours feeding a ~10-minute
# solve does not need sub-second pickup, so those polls run on their own slow
# timer. Also paces gametree blob listing in blob mode.
CLAIM_POLL_SECS = float(os.getenv("WATCHER_CLAIM_POLL_SECS", "10"))
# Reconcile listing interval for noderequests: the safety net behind the
# storage-queue push path. When the queue is off this collapses to every
# iteration (the old pure-polling behavior).
NODEREQ_RECONCILE_SECS = float(os.getenv("NODEREQ_RECONCILE_SECS", "45"))
# After UTC midnight, keep listing yesterday's dated directory for this long,
# so a blob written just before the boundary but first listed after it is not
# missed (see scan_bases).
MIDNIGHT_GRACE_SECS = float(os.getenv("POLL_MIDNIGHT_GRACE_SECS", "300"))
TINY = 0.02
END_MARK = "END"  # Pio UPI end marker

# =========================
# Config / Environment
# =========================
CONN_STR = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
CONTAINER = os.getenv("AZURE_STORAGE_CONTAINER", "onlinerangedata")
BASE_PREFIX = "gametrees"
NODEREQ_PREFIX = "noderequests"
# Handled request blobs are moved here (a SIBLING of noderequests/, not nested
# under it, so nothing that lists the noderequests/ root ever pages through
# processed history). Anything still under noderequests/ is by definition
# unhandled, which is what lets a restarted watcher pick up requests that
# arrived while it was down.
NODEREQ_PROCESSED_PREFIX = "noderequests-processed"
WATCH_TODAY_ONLY = True

# Storage-queue push path for noderequests: the API enqueues each request's
# path+payload as it writes the blob; polling the queue replaces listing ADLS
# as the primary discovery mechanism. "0" disables it (pure listing fallback).
NODEREQ_QUEUE_ENV = os.getenv("WATCHER_NODEREQ_QUEUE")
NODEREQ_QUEUE_NAME = os.getenv("WATCHER_NODEREQ_QUEUE_NAME", "noderequests")
NODEREQ_POISON_QUEUE_NAME = f"{NODEREQ_QUEUE_NAME}-poison"
# Message invisibility while a request is being handled. Sized for the worst
# case - a cfr-evicted request re-solves the whole board (~10 min) - not the
# seconds-scale normal case.
QUEUE_VISIBILITY_SECS = int(os.getenv("WATCHER_QUEUE_VISIBILITY_SECS", "900"))
# A message dequeued this many times without being deleted is parked on the
# poison queue instead of being retried forever.
QUEUE_MAX_DEQUEUE = int(os.getenv("WATCHER_QUEUE_MAX_DEQUEUE", "5"))

# Precompute every turn street at solve time (adds a few minutes per solve).
# Set PIO_TURN_PRECOMPUTE=0 to fall back to on-demand turns via noderequests.
PIO_TURN_PRECOMPUTE = os.getenv("PIO_TURN_PRECOMPUTE", "1") != "0"

# Concurrent street-bundle uploads per publish (each thread gets its own ADLS
# file client, and gzip releases the GIL, so both overlap cleanly).
UPLOAD_WORKERS = int(os.getenv("PIO_UPLOAD_WORKERS", "8"))

# Gametree discovery mode. Unset = auto: use the SolveJobs queue API when
# HOLDEMTOOLS_API_BASE + WATCHER_API_KEY are configured, else fall back to
# ADLS blob-listing. "1" forces queue mode (startup error if unconfigured),
# "0" forces blob mode (the cutover rollback switch). Noderequests are always
# blob-driven either way.
WATCHER_USE_QUEUE_ENV = os.getenv("WATCHER_USE_QUEUE")

PIO_TITLE_RE = os.getenv("PIO_TITLE_RE", r"(?i).*PioViewer.*")

# Pio console exe (headless solver)
PIO_EXE = os.getenv("PIO_EXE", r"C:\PioSOLVER\PioSOLVER2-edge.exe")

# Where Save current parameters writes the scripts
TREEBUILD_DIR = os.getenv("PIO_TREEBUILD_DIR", r"C:\PioSOLVER\TreeBuilding")

# Name of the tree script file Pio saves (without .txt) – now fixed "temp"
TREE_SCRIPT_BASENAME = os.getenv("PIO_TREE_SCRIPT_BASENAME", "temp")

# Where we want .cfr files (subdir under Pio dir)
CFR_SUBDIR = os.getenv("PIO_CFR_SUBDIR", "Solved")

# Accuracy in CHIPS of exploitability, the value handed to Pio's set_accuracy.
# Used only as the floor/fallback: the effective accuracy is normally derived
# from the tree's own pot (see PIO_ACCURACY_POT_FRACTION), because solves no
# longer share one chip scale.
ACCURACY = float(os.getenv("PIO_ACCURACY", "0.05"))
# Exploitability target as a fraction of the pot. 0.002 is ~1 chip on the
# 550-chip pot a typical preflop-sim solve produces, i.e. what this pipeline
# has effectively been running at. Set to 0 to force the absolute PIO_ACCURACY.
ACCURACY_POT_FRACTION = float(os.getenv("PIO_ACCURACY_POT_FRACTION", "0.002"))

# pyosolver Pio dir (where PioSOLVER2-edge.exe lives)
PIO_DIR_FOR_PYOSOLVER = os.getenv("PIO_DIR_FOR_PYOSOLVER", r"C:\PioSOLVER")

# Optional local JSON dump dir for debugging / inspection
TEMP_JSON_DIR = os.getenv("PIO_TEMP_JSON_DIR", r"C:\PioSOLVER\TempJson")
if TEMP_JSON_DIR:
    os.makedirs(TEMP_JSON_DIR, exist_ok=True)


# =========================
# Logging
# =========================
def ts() -> str:
    return datetime.now().strftime("%H:%M:%S")


def log(msg: str) -> None:
    print(f"[{ts()}] {msg}", flush=True)


def today_subpath_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y/%m/%d")


# =========================
# Azure helpers
# =========================
def get_fs_client():
    if not CONN_STR:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING env var not set")
    dls = DataLakeServiceClient.from_connection_string(CONN_STR)
    return dls.get_file_system_client(CONTAINER)


def scan_bases(prefix_base: str, only_today: bool) -> List[str]:
    """Directories to hand to fs.get_paths(). Listing today's dated directory
    server-side keeps Azure from enumerating every historical date on every
    poll. Producers stamp these paths with UTC dates (DateTimeOffset.UtcNow in
    GameTreesController / NodeRequestsController), matching the UTC date used
    here; yesterday is still scanned for a grace window after UTC midnight so
    a blob written just before the boundary but first listed after it is not
    missed."""
    base = prefix_base.rstrip("/")
    if not only_today:
        return [base]
    now = datetime.now(timezone.utc)
    bases = [f"{base}/{now.strftime('%Y/%m/%d')}"]
    since_midnight = (
        now - now.replace(hour=0, minute=0, second=0, microsecond=0)
    ).total_seconds()
    if since_midnight < MIDNIGHT_GRACE_SECS:
        yesterday = now - timedelta(days=1)
        bases.append(f"{base}/{yesterday.strftime('%Y/%m/%d')}")
    return bases


def _iter_json_files(fs, scan_base: str, tag: str):
    """Yield non-directory .json paths under scan_base. A dated directory that
    does not exist yet (nothing uploaded that day) is an empty result, not an
    error worth logging."""
    try:
        for p in fs.get_paths(path=scan_base, recursive=True):
            if p.is_directory or not p.name.endswith(".json"):
                continue
            yield p
    except Exception as e:
        if "PathNotFound" not in str(e):
            log(f"[{tag}] error: {e}")


def list_existing_json(fs, prefix_base: str, only_today: bool) -> Set[str]:
    seen: Set[str] = set()
    for scan_base in scan_bases(prefix_base, only_today):
        for p in _iter_json_files(fs, scan_base, "seed"):
            seen.add(p.name)
    return seen


def list_new_json(
    fs, seen: Set[str], prefix_base: str, only_today: bool
) -> List[Tuple[str, str, str]]:
    results: List[Tuple[str, str, str]] = []
    for scan_base in scan_bases(prefix_base, only_today):
        for p in _iter_json_files(fs, scan_base, "list"):
            if p.name in seen:
                continue
            lm = (p.last_modified or datetime.now(timezone.utc)).isoformat()
            fname = p.name.rsplit("/", 1)[-1]
            results.append((p.name, fname, lm))
    results.sort(key=lambda t: t[2])
    return results


def download_text(fs, full_path: str) -> Optional[str]:
    try:
        file_client = fs.get_file_client(full_path)
        data = file_client.download_file().readall()
        return data.decode("utf-8", errors="replace")
    except Exception as e:
        log(f"[download] error for {full_path}: {e}")
        return None


# =========================
# PioViewer attach & actions
# =========================
def _set_focus_with_timeout(win, timeout: float = 10.0) -> None:
    """set_focus() can block indefinitely (foreground lock while the user is
    typing, busy UIA provider, ...). Run it in a thread and move on if it
    doesn't return; later click_input() calls raise the window themselves."""
    done = threading.Event()

    def _do() -> None:
        try:
            win.set_focus()
        except Exception as e:
            log(f"  -> set_focus failed: {e}")
        finally:
            done.set()

    threading.Thread(target=_do, daemon=True).start()
    if not done.wait(timeout):
        log(f"  -> set_focus did not return within {timeout:.0f}s; continuing without it")


def attach_pioviewer(title_re: str) -> Optional[Application]:
    try:
        hwnds = findwindows.find_windows(title_re=title_re)
    except Exception:
        hwnds = []
    if not hwnds:
        log("  -> No PioViewer windows found")
        return None
    try:
        app = Application(backend="uia").connect(handle=hwnds[0])
        log(f"  -> Attached to PioViewer via handle {hwnds[0]}")
        _set_focus_with_timeout(app.top_window())
        return app
    except Exception as e:
        log(f"  -> Failed to attach by handle: {e}")
        try:
            app = Application(backend="uia").connect(title_re=title_re, timeout=0.4)
            log("  -> Attached to PioViewer via title regex")
            _set_focus_with_timeout(app.top_window())
            return app
        except Exception as e2:
            log(f"  -> Failed to attach by title regex: {e2}")
            return None


def ensure_treebuilding_tab(win) -> None:
    """PioViewer's Paste / Save-current-parameters buttons only exist on the
    'Postflop Tree Building and Calculations' tab. Users (or a prior Build&Go)
    leave the app on the Browser tab, which used to fail the whole job -
    select the tab explicitly; clicking an already-selected tab is harmless."""
    try:
        tab = win.child_window(
            title="Postflop Tree Building and Calculations", control_type="TabItem"
        )
        if tab.exists(timeout=1.0):
            tab.click_input()
            time.sleep(0.4)
            log("  -> Ensured 'Postflop Tree Building and Calculations' tab")
    except Exception as e:
        log(f"  -> Could not select tree-building tab (continuing): {e}")


def focus_window_center(win):
    try:
        r = win.rectangle()
        cx, cy = (r.left + r.right) // 2, (r.top + r.bottom) // 2
        click(coords=(cx, cy))
        log(f"  -> Focused window center at ({cx}, {cy})")
    except Exception as e:
        log(f"  -> focus_window_center failed: {e}")


def _invoke_or_click(btn_spec, label: str = "(unknown)") -> bool:
    from time import perf_counter

    t0 = perf_counter()
    log(f"    [ioc] Trying '{label}'...")

    try:
        if hasattr(btn_spec, "exists"):
            try:
                if not btn_spec.exists(timeout=0.5):
                    log("    [ioc] btn_spec.exists(timeout=0.5) -> False")
                    return False
                else:
                    log("    [ioc] btn_spec.exists(timeout=0.5) -> True")
            except Exception as e:
                log(f"    [ioc] exists() check raised: {e}")

        ctrl = btn_spec.wrapper_object()  # type: ignore[assignment]
        try:
            txt = ctrl.window_text()
        except Exception:
            txt = "<no-text>"
        try:
            cname = ctrl.friendly_class_name()
        except Exception:
            cname = type(ctrl).__name__

        log(f"    [ioc] wrapper_object: class='{cname}', text='{txt}'")

        label_l = (label or "").lower()
        txt_l = (txt or "").lower()
        is_save_params = "save current parameters" in label_l or "save current parameters" in txt_l

        # For Save current parameters, only click_input to avoid blocking invoke()
        if is_save_params:
            log("    [ioc] Special-casing 'Save current parameters' -> click_input only")
            if hasattr(ctrl, "click_input"):
                try:
                    ctrl.click_input(button="left", double=False)  # type: ignore[attr-defined]
                    dt = perf_counter() - t0
                    log(f"    [ioc] click_input() for 'Save current parameters' in {dt:.3f}s")
                    return True
                except Exception as e:
                    log(f"    [ioc] click_input() for 'Save current parameters' raised: {e}")
                    return False
            else:
                log("    [ioc] ctrl has no click_input for 'Save current parameters'")
                return False

        if hasattr(ctrl, "invoke"):
            try:
                ctrl.invoke()  # type: ignore[attr-defined]
                dt = perf_counter() - t0
                log(f"    [ioc] invoke() for '{label}' succeeded in {dt:.3f}s")
                return True
            except Exception as e:
                log(f"    [ioc] invoke() for '{label}' raised: {e}")

        if hasattr(ctrl, "click_input"):
            try:
                ctrl.click_input(button="left", double=False)  # type: ignore[attr-defined]
                dt = perf_counter() - t0
                log(f"    [ioc] click_input() for '{label}' succeeded in {dt:.3f}s")
                return True
            except Exception as e:
                log(f"    [ioc] click_input() for '{label}' raised: {e}")

    except Exception as e:
        dt = perf_counter() - t0
        log(f"    [ioc] _invoke_or_click('{label}') failed in {dt:.3f}s: {e!r}")
        return False

    dt = perf_counter() - t0
    log(f"    [ioc] _invoke_or_click('{label}') finished with no action in {dt:.3f}s")
    return False


def click_paste_button(win) -> bool:
    patterns = [r"(?i)^Paste$"]
    for pat in patterns:
        try:
            btn_spec = win.child_window(title_re=pat, control_type="Button")
            if _invoke_or_click(btn_spec, label="Paste"):
                log("  -> Clicked 'Paste' button")
                return True
        except Exception as e:
            log(f"  -> Error locating Paste button with pattern '{pat}': {e}")
            continue
    log("  -> Paste button not found / not clicked")
    return False


# =========================
# Board parsing + Save parameters
# =========================
def get_board_name(text: str, fallback_name: str) -> str:
    """Parse '#Board#4h Jh 5s' -> '4hJh5s'; else use filename stem."""
    m = re.search(r"#Board#([2-9TJQKA][shdc]\s+[2-9TJQKA][shdc]\s+[2-9TJQKA][shdc])", text)
    if m:
        board = m.group(1).replace(" ", "")
        log(f"  -> Parsed board '{board}' from text")
        return board
    stem = fallback_name.rsplit(".", 1)[0]
    log(f"  -> No board found in text, using fallback filename stem '{stem}'")
    return stem


def get_config_pot(text: str) -> Optional[int]:
    """Parse '#Pot#1500' -> 1500. Solves no longer share one chip scale, so
    the pot is what the accuracy target is measured against."""
    m = re.search(r"#Pot#(\d+)", text)
    return int(m.group(1)) if m else None


def save_current_parameters_simple(main_win, script_basename: str) -> bool:
    """
    Click 'Save current parameters', then type script_basename in the Save dialog and press Enter.
    This controls the name of the TreeBuilding .txt file (e.g. temp.txt).
    """
    try:
        btn_spec = main_win.child_window(
            title_re=r"(?i)save current parameters",
            control_type="Button",
        )
        clicked = _invoke_or_click(btn_spec, label="Save current parameters")
        log(f"  [save] _invoke_or_click('Save current parameters') returned {clicked}")
        if not clicked:
            log("  [save] Failed to click 'Save current parameters'")
            return False
        log("  -> Clicked 'Save current parameters'")
    except Exception as e:
        log(f"  [save] Error locating/clicking 'Save current parameters' button: {e}")
        return False

    time.sleep(0.5)

    try:
        seq1 = "^a{BACKSPACE}"
        seq2 = script_basename
        seq3 = "{ENTER}"
        log(f"  [save] keyboard.send_keys({seq1!r}), then {seq2!r}, then {seq3!r}")
        keyboard.send_keys(seq1, pause=0.02)
        keyboard.send_keys(seq2, pause=0.02, with_spaces=False)
        keyboard.send_keys(seq3, pause=0.02)
        log(f"  [save] Typed '{script_basename}' and pressed Enter in Save dialog")
        time.sleep(0.4)
        return True
    except Exception as e:
        log(f"  [save] Error sending keys to Save dialog: {e}")
        return False


# =========================
# Pio console (UPI) client
# =========================
class PioClient:
    """
    Simple wrapper around a PioSOLVER console process using UPI.
    Now used as a context manager so each instance is short-lived.
    """

    def __init__(self, exe_path: str):
        pio_dir = os.path.dirname(exe_path) or "."
        self.pio_dir = os.path.abspath(pio_dir)

        log(f"Starting PioSOLVER process: {exe_path} (cwd={self.pio_dir})")

        self.proc = subprocess.Popen(
            [exe_path],
            cwd=self.pio_dir,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
            universal_newlines=True,
        )

        stdin = self.proc.stdin
        stdout = self.proc.stdout
        if stdin is None or stdout is None:
            raise RuntimeError("Failed to get stdin/stdout for PioSOLVER process")

        self._stdin: IO[str] = stdin
        self._stdout: IO[str] = stdout

        # All stdout is consumed by a reader thread that splits it into
        # END-framed chunks. Pio prints unsolicited periodic status reports
        # during 'go' (each also END-terminated), so callers can NOT assume
        # "one command = next chunk" while the solver is running.
        self._chunks: "queue.Queue[Optional[str]]" = queue.Queue()
        self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
        self._reader_thread.start()

        # set end marker
        _ = self.send_cmd(f"set_end_string {END_MARK}", log_cmd=False)
        log("PioSOLVER started and END marker set")

    def _read_loop(self) -> None:
        lines: list[str] = []
        try:
            for raw in self._stdout:
                line = raw.rstrip("\r\n")
                if line == END_MARK:
                    self._chunks.put("\n".join(lines))
                    lines = []
                else:
                    lines.append(line)
        except Exception:
            pass
        if lines:
            self._chunks.put("\n".join(lines))
        self._chunks.put(None)  # EOF sentinel

    def read_chunk(self, timeout: Optional[float]) -> Optional[str]:
        """Next END-framed chunk, or None on timeout / process EOF."""
        try:
            return self._chunks.get(timeout=timeout)
        except queue.Empty:
            return None

    def _drain_chunks(self) -> None:
        """Discard any unread chunks (stale solver snapshots) so the next
        command's response lines up with the next chunk."""
        while True:
            try:
                stale = self._chunks.get_nowait()
            except queue.Empty:
                return
            if stale:
                log(f"  [UPI] (drained stale output: {stale.splitlines()[-1]})")

    def __enter__(self) -> "PioClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def _write_cmd(self, cmd: str) -> None:
        try:
            self._stdin.write(cmd + "\n")
            self._stdin.flush()
        except OSError as e:
            raise RuntimeError(f"Failed to send command '{cmd}' to PioSOLVER: {e}") from e

    def send_cmd(self, cmd: str, log_cmd: bool = True, timeout: float = 300.0) -> str:
        """Send one UPI command while the solver is idle and return its response.
        Drains stale chunks first so framing self-heals after a solve."""
        if not self.is_alive():
            raise RuntimeError("PioSOLVER process is not running")

        if log_cmd:
            log(f"  [UPI] >> {cmd}")

        self._drain_chunks()
        self._write_cmd(cmd)

        resp = self.read_chunk(timeout=timeout)
        if resp is None:
            if not self.is_alive():
                raise RuntimeError(f"PioSOLVER died while running '{cmd}'")
            raise RuntimeError(f"Timed out ({timeout:.0f}s) waiting for response to '{cmd}'")
        last = resp.splitlines()[-1] if resp else ""
        if last:
            log(f"  [UPI] << {last}")
        return resp

    def send_cmd_await(
        self, cmd: str, marker: str, timeout: float, log_cmd: bool = True
    ) -> str:
        """Send a command whose real response arrives only after the solver
        finishes (wait_for_solver, dump_tree). Reads chunks until one contains
        `marker` or an ERROR, treating interleaved solver snapshots as progress.
        Returns all text read (snapshots + final response), '' on timeout."""
        if not self.is_alive():
            raise RuntimeError("PioSOLVER process is not running")

        if log_cmd:
            log(f"  [UPI] >> {cmd}")

        self._drain_chunks()
        self._write_cmd(cmd)

        deadline = time.time() + timeout
        collected: list[str] = []
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                log(f"  [UPI] WARNING: no '{marker}' within {timeout:.0f}s for '{cmd}'")
                break
            chunk = self.read_chunk(timeout=min(remaining, 30.0))
            if chunk is None:
                if not self.is_alive():
                    raise RuntimeError(f"PioSOLVER died while awaiting '{cmd}'")
                continue  # quiet interval; keep waiting until deadline
            collected.append(chunk)
            last = chunk.splitlines()[-1] if chunk else ""
            if last:
                log(f"  [UPI] << {last}")
            if marker in chunk:
                break
            if "ERROR" in chunk:
                log(f"  [UPI] ERROR response for '{cmd}':\n{chunk}")
                break
        return "\n".join(collected)

    def is_alive(self) -> bool:
        return self.proc.poll() is None

    def close(self):
        """
        Try very hard to shut down the PioSOLVER process so we don't leave
        licensed processes hanging around.
        """
        if not self.is_alive():
            return

        log("Shutting down PioSOLVER process...")
        try:
            # polite exit via UPI (write only - no response expected after exit)
            try:
                self._write_cmd("exit")
            except Exception as e:
                log(f"  [close] error sending 'exit': {e}")

            # then wait a bit
            try:
                self.proc.wait(timeout=10.0)
                log("  [close] PioSOLVER exited cleanly.")
                return
            except subprocess.TimeoutExpired:
                log("  [close] PioSOLVER did not exit in time; terminating...")
        except Exception as e:
            log(f"  [close] unexpected error during exit: {e}")

        # fallback: terminate/kill
        try:
            self.proc.terminate()
        except Exception as e:
            log(f"  [close] terminate() failed: {e}")

        try:
            self.proc.wait(timeout=5.0)
            log("  [close] PioSOLVER terminated.")
        except subprocess.TimeoutExpired:
            log("  [close] terminate timed out; killing...")
            try:
                self.proc.kill()
                log("  [close] PioSOLVER killed.")
            except Exception as e:
                log(f"  [close] kill() failed: {e}")


# =========================
# Helper: parse wait_for_solver output
# =========================
def parse_wait_stats(wait_output: str) -> Dict[str, Optional[float]]:
    """
    Extract EV OOP / EV IP / Exploitable from wait_for_solver text.
    Returns a dict with keys: ev_oop, ev_ip, exploitable (floats or None).
    """
    ev_oop = ev_ip = exploitable = None

    # The text may contain several solver snapshots; the LAST values are the
    # final (most converged) ones.
    m_oop = re.findall(r"EV OOP:\s*([-\d\.]+)", wait_output)
    m_ip = re.findall(r"EV IP:\s*([-\d\.]+)", wait_output)
    m_expl = re.findall(r"Exploitable for:\s*([-\d\.]+)", wait_output)

    if m_oop:
        try:
            ev_oop = float(m_oop[-1])
        except ValueError:
            pass
    if m_ip:
        try:
            ev_ip = float(m_ip[-1])
        except ValueError:
            pass
    if m_expl:
        try:
            exploitable = float(m_expl[-1])
        except ValueError:
            pass

    return {
        "ev_oop": ev_oop,
        "ev_ip": ev_ip,
        "exploitable": exploitable,
    }


def get_noderequest_queues() -> Tuple[QueueClient, QueueClient]:
    """Main + poison noderequest queues, created once at startup so
    per-message handling never pays a create round trip."""
    main = QueueClient.from_connection_string(CONN_STR, NODEREQ_QUEUE_NAME)
    poison = QueueClient.from_connection_string(CONN_STR, NODEREQ_POISON_QUEUE_NAME)
    for client in (main, poison):
        try:
            client.create_queue()
        except ResourceExistsError:
            pass
    return main, poison


def archive_request_blob(blob_service, full_path: str) -> None:
    """Move a handled request blob to the processed sibling prefix so the
    reconcile listing stays one page. The account is flat-namespace (no rename
    primitive), and sync copy-from-URL rejects same-account sources without a
    SAS (CannotVerifyCopySource), so for these few-hundred-byte JSONs the move
    is download + upload + delete. Not atomic: if the delete fails the blob
    survives in both places, and the next reconcile pass re-handles the source
    as an already-extracted no-op and retries the move."""
    dest_path = NODEREQ_PROCESSED_PREFIX + full_path[len(NODEREQ_PREFIX):]
    src = blob_service.get_blob_client(CONTAINER, full_path)
    try:
        content = src.download_blob().readall()
        dst = blob_service.get_blob_client(CONTAINER, dest_path)
        dst.upload_blob(content, overwrite=True)
        src.delete_blob()
    except Exception as e:
        log(f"  [nodereq] archive failed for {full_path}: {e}")


def parse_queue_message(content: str) -> Optional[Dict[str, str]]:
    """Validate a push message: blob path under noderequests/ plus the same
    payload _parse_node_request accepts from the blob itself."""
    try:
        obj = json.loads(content)
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    req = {k: obj.get(k) for k in ("path", "stacks", "node_name", "board", "node_id")}
    if not all(isinstance(v, str) and v for v in req.values()):
        return None
    if not req["path"].startswith(f"{NODEREQ_PREFIX}/"):
        return None
    segs = req["node_id"].split(":")
    if len(segs) < 3 or segs[0] != "r" or not CARD_SEG_RE.match(segs[-1]):
        return None
    return req


# =========================
# Solve + dump_tree + wait for CFR
# =========================
def solve_tree_to_cfr(
    pio: PioClient,
    tree_script_path: str,
    board: str,
    cfr_full: Optional[str] = None,
    pot_chips: Optional[int] = None,
) -> Tuple[str, str, Dict[str, Optional[float]]]:
    """
    Given a TreeBuilding .txt (from Save current parameters),
    build & solve headless and dump_tree to a .cfr file.
    cfr_full overrides the output path (registry-unique name); defaults to
    Solved/{board}.cfr.
    Returns:
      (cfr_full_path, wait_output_text, stats_dict)
    """
    tree_script_path = os.path.abspath(tree_script_path)
    if not os.path.isfile(tree_script_path):
        raise FileNotFoundError(tree_script_path)

    log(f"Solving tree for board {board} using script: {tree_script_path}")

    # sanity check
    resp_present = pio.send_cmd("is_tree_present", log_cmd=False)
    log(f"  [UPI] is_tree_present before load_script_silent: {resp_present}")

    # Accuracy, in chips of exploitability. It has to track the pot: solves no
    # longer all run at the same scale (a recorded hand is solved in its own
    # money), so a fixed chip value would be loose at one stake and unreachable
    # at another. The mode word is always sent - Pio otherwise keeps whatever
    # mode the process was last put in, which nothing here sets.
    accuracy = ACCURACY
    if ACCURACY_POT_FRACTION > 0 and pot_chips and pot_chips > 0:
        accuracy = max(pot_chips * ACCURACY_POT_FRACTION, 1e-4)
        log(
            f"  [UPI] accuracy {accuracy:.4g} chips "
            f"({ACCURACY_POT_FRACTION:.4%} of a {pot_chips}-chip pot)"
        )
    acc_resp = pio.send_cmd(f"set_accuracy {accuracy} chips")
    # Logged because it is the only evidence Pio accepted the command; an
    # unsupported argument shows up here rather than as a bad solve.
    log(f"  [UPI] set_accuracy -> {acc_resp.strip() if acc_resp else '(no reply)'}")

    # load script
    pio.send_cmd(f'load_script_silent "{tree_script_path}"')

    # `load_script_silent` answers "ok!" for the script, which says nothing
    # about whether the tree it ends with actually got built. Going straight to
    # `go` on an absent tree wasted the whole job: `go` and then `dump_tree`
    # both failed with "missing/incorrect tree", and the only clue was two
    # error lines several steps after the real problem. Confirm the tree exists
    # and say so plainly if it does not.
    build_timeout = float(os.getenv("PIO_TREE_BUILD_WAIT_SECS", "180"))
    build_started = time.time()
    while True:
        present = (pio.send_cmd("is_tree_present", log_cmd=False) or "").strip().lower()
        if present.startswith("true"):
            log(f"  [UPI] tree present after {time.time() - build_started:.1f}s")
            break
        if time.time() - build_started > build_timeout:
            info = pio.send_cmd("show_tree_info", log_cmd=False)
            raise RuntimeError(
                f"PioSOLVER built no tree for board {board} "
                f"(is_tree_present={present!r} after {build_timeout:.0f}s). The tree "
                f"script is at {tree_script_path}; paste the same config into "
                "PioViewer and build it by hand to see what it rejects. "
                f"show_tree_info: {info.strip()[:400]!r}"
            )
        time.sleep(1.0)

    # solve. 'go' returns immediately; the real completion signal is
    # wait_for_solver's "wait_for_solver ok!" response, which arrives only
    # after "SOLVER: stopped". Periodic solver snapshots interleave before it.
    pio.send_cmd("go")
    solve_timeout = float(os.getenv("PIO_SOLVE_WAIT_SECS", "900"))
    wait_resp = pio.send_cmd_await(
        "wait_for_solver", marker="wait_for_solver ok!", timeout=solve_timeout
    )

    # send_cmd_await gives up quietly on timeout, which used to mean a
    # half-solved tree got dumped, uploaded and served as if it were finished.
    # An unconverged solve is worse than no solve: nothing downstream marks it.
    if "wait_for_solver ok!" not in (wait_resp or ""):
        raise RuntimeError(
            f"solver did not converge within {solve_timeout:.0f}s for board {board} "
            "- refusing to dump a partially solved tree"
        )

    stats = parse_wait_stats(wait_resp)
    log(f"  [UPI] final stats: {stats}")

    # construct CFR path (unless the caller provided a registry-unique one)
    if cfr_full is None:
        cfr_dir_full = os.path.join(pio.pio_dir, CFR_SUBDIR)
        os.makedirs(cfr_dir_full, exist_ok=True)
        cfr_full = os.path.abspath(os.path.join(cfr_dir_full, f"{board}.cfr"))
    else:
        os.makedirs(os.path.dirname(cfr_full), exist_ok=True)
        cfr_full = os.path.abspath(cfr_full)
    log(f"  [UPI] Target CFR path: {cfr_full}")

    # request dump_tree; on big trees the ok! can lag well behind the write start
    dump_cmd = f'dump_tree "{cfr_full}" full'
    dump_timeout = float(os.getenv("PIO_CFR_WAIT_SECS", "600"))
    dump_resp = pio.send_cmd_await(dump_cmd, marker="dump_tree ok!", timeout=dump_timeout)
    log(f"  [UPI] dump_tree full response:\n{dump_resp if dump_resp else '(no output)'}")

    # actively wait for CFR file to appear on disk
    max_wait = float(os.getenv("PIO_CFR_WAIT_SECS", "600"))  # default: 10 minutes
    poll = 2.0  # seconds
    deadline = time.time() + max_wait
    told_waiting = False
    last_size = -1

    while time.time() < deadline:
        if os.path.exists(cfr_full):
            size = os.path.getsize(cfr_full)
            if last_size < 0:
                log(f"  -> CFR file detected: {cfr_full} (size={size} bytes)")
            elif size != last_size:
                log(f"  -> CFR file size updated: {size} bytes")
            last_size = size
            if size > 0:
                log(f"  -> dump_tree appears complete: {cfr_full}")
                break
        else:
            if not told_waiting:
                log(
                    f"  -> CFR file not present yet; waiting up to {max_wait:.0f}s "
                    f"for Pio to finish writing..."
                )
                told_waiting = True

        time.sleep(poll)
    else:
        log(
            f"  -> WARNING: CFR file still not found after waiting "
            f"{max_wait:.0f}s: {cfr_full}"
        )

    return cfr_full, wait_resp, stats


# =========================
# Per-file processing helper
# =========================
def process_gametree_json(
    fs,
    full_path: str,
    name: str,
    lm: str,
    pio: PioClient,
    registry: CfrRegistry,
    on_stage: Optional[Any] = None,
) -> Dict[str, Any]:
    """Solve one gametree blob end to end and publish its bundles.

    `on_stage` (queue mode) is called with "Extracting" once the solve has
    dumped its .cfr and with "Uploading" before the final publish, so job
    status can track the pipeline. Raises on any failure - the caller decides
    whether that means a Failed job report or just a log line.

    Returns {stacks, node_name, board} of the published solution.
    """
    log(f"[NEW] {full_path}  (last_modified={lm})")

    def stage(s: str) -> None:
        if on_stage is not None:
            try:
                on_stage(s)
            except Exception as e:
                log(f"  -> on_stage({s}) failed: {e}")

    raw = download_text(fs, full_path)
    if raw is None:
        raise RuntimeError(f"could not download gametree blob {full_path}")

    # Accept raw or JSON { "Text": "...", "AlivePositions": [...], ... }
    alive_positions: Optional[list[str]] = None
    acting_pos: Optional[str] = None
    preflop_line: Optional[list[str]] = None
    is_icm: Optional[bool] = None
    seat_meta: Optional[list] = None
    hand_bb: Optional[float] = None
    chip_scale: Optional[float] = None

    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            text = obj.get("Text") or raw
            alive_positions = obj.get("AlivePositions")
            acting_pos = obj.get("ActingPos")
            preflop_line = obj.get("Line")
            is_icm = obj.get("IsICM")
            seat_meta = obj.get("Seats")
            hand_bb = obj.get("BigBlind")
            chip_scale = obj.get("ChipScale")
        else:
            text = raw
        if not isinstance(text, str) or not text.strip():
            text = raw
    except Exception:
        text = raw
        alive_positions = None
        acting_pos = None

    pyperclip.copy(text)
    log(f"  -> Copied {len(text.encode('utf-8', 'ignore'))} bytes to clipboard")

    app = attach_pioviewer(PIO_TITLE_RE)
    if not app:
        raise RuntimeError("PioViewer window not found")

    win = app.top_window()
    log(f"  -> Pio top window title before paste: '{win.window_text()}'")
    ensure_treebuilding_tab(win)
    focus_window_center(win)

    from time import perf_counter
    t0 = perf_counter()
    pasted = click_paste_button(win)
    if not pasted:
        keyboard.send_keys("^v", pause=TINY)
        log("  -> Sent Ctrl+V (fallback)")
    t1 = perf_counter()

    # Parse board name from text (still used for CFR + JSON)
    board_name = get_board_name(text, name)

    # Save current parameters, but now ALWAYS using fixed "temp" script name
    log(
        f"  -> Calling save_current_parameters_simple with script_basename="
        f"'{TREE_SCRIPT_BASENAME}' (board='{board_name}')"
    )
    if not save_current_parameters_simple(win, TREE_SCRIPT_BASENAME):
        raise RuntimeError("SaveCurrentParameters failed; cannot run headless solve")

    # TreeBuilding script path (fixed temp)
    tree_script_path = os.path.join(
        TREEBUILD_DIR, f"{TREE_SCRIPT_BASENAME}.txt"
    )
    if not os.path.isfile(tree_script_path):
        raise RuntimeError(f"expected TreeBuilding script not found: {tree_script_path}")

    # Registry-unique CFR path: same board on different sims/lines must not collide
    stacks_pre, node_name_pre, _date = parse_gametree_path(full_path, BASE_PREFIX)
    cfr_target = registry.path_for(stacks_pre or "nostacks", node_name_pre or "nonode", board_name)

    # Headless solve via Pio console (this uses the passed-in `pio`)
    cfr_path, wait_output, stats = solve_tree_to_cfr(
        pio,
        tree_script_path,
        board_name,
        cfr_full=cfr_target,
        pot_chips=get_config_pot(text),
    )

    log(
        f"  -> Stats: EV_OOP={stats.get('ev_oop')}, "
        f"EV_IP={stats.get('ev_ip')}, exploitable={stats.get('exploitable')}"
    )
    stage("Extracting")

    # Publish is called twice per solve: once by extract_board's on_flop_ready
    # hook with just the flop (so the board becomes openable while the turn
    # sweep is still walking), and once afterwards with the full result. The
    # manifest merge makes the second call purely additive, and
    # `published_suffixes` keeps already-uploaded bundles from re-uploading.
    published_suffixes: set[str] = set()
    publish_info: Dict[str, Any] = {}

    def publish_streets(extract_like: Dict[str, Any]) -> None:
        # calc_results (read off the loaded .cfr) is authoritative over the
        # values scraped from the solve log, and is the only source for MES.
        merged_stats = {
            **stats,
            **{k: v for k, v in (extract_like.get("results") or {}).items() if v is not None},
        }

        ctx = build_board_context(
            board=board_name,
            cfr_file=os.path.basename(cfr_path),
            src_gametree_path=full_path,
            base_prefix=BASE_PREFIX,
            stats=merged_stats,
            tree_info=extract_like["tree_info"],
            alive_positions=alive_positions,
            acting_pos=acting_pos,
            preflop_line=preflop_line,
            is_icm=is_icm,
            seat_meta=seat_meta,
            hand_bb=hand_bb,
            chip_scale=chip_scale,
        )
        stacks = ctx["stacks"] or "nostacks"
        node_name = ctx["node_name"] or "nonode"
        base = board_base_path(stacks, node_name, board_name)
        ctx["effective_stack_chips"] = extract_like.get("effective_stack")

        root_view = (extract_like["streets"].get("r:0") or {}).get("views", {}).get("r:0")
        if root_view and root_view.get("pot"):
            ctx["pot_chips"] = root_view["pot"][-1]

        to_upload: list[tuple[str, Dict[str, Any], Dict[str, Any]]] = []
        for seed_id, walk in extract_like["streets"].items():
            suffix = node_id_to_suffix(seed_id)
            if suffix in published_suffixes:
                continue
            bundle = build_street_bundle(
                seed_id, walk["views"], walk["nodes_meta"], ctx, extract_like["hand_order"]
            )
            to_upload.append((suffix, walk, bundle))

        streets_map: dict[str, Any] = {}
        if to_upload:
            with ThreadPoolExecutor(max_workers=UPLOAD_WORKERS) as pool:
                futures = {
                    pool.submit(upload_street_bundle, fs, base, bundle, TEMP_JSON_DIR): (
                        suffix,
                        walk,
                        bundle,
                    )
                    for suffix, walk, bundle in to_upload
                }
                for fut in as_completed(futures):
                    suffix, walk, bundle = futures[fut]
                    if fut.result():
                        streets_map[suffix] = street_entry(
                            suffix, bundle["street"], len(walk["views"])
                        )
                        published_suffixes.add(suffix)

        cfr_size = os.path.getsize(cfr_path) if os.path.exists(cfr_path) else None
        # Merge into any existing manifest so a re-solve keeps street entries
        # (e.g. rivers) extracted before the local .cfr was evicted, and the
        # full-sweep publish keeps the flop entry from the early publish.
        existing_manifest = download_manifest(fs, stacks, node_name, board_name)
        manifest = build_manifest(
            ctx, streets_map, cfr_size_bytes=cfr_size, existing=existing_manifest
        )
        upload_manifest(fs, base, manifest)

        # Count off the merged manifest, not this call's uploads, so the entry
        # is correct no matter which publish pass this is.
        turn_streets = sum(
            1
            for e in manifest["streets"].values()
            if e.get("street") == "turn" and e.get("extracted")
        )
        flop_views = (extract_like["streets"].get("r:0") or {}).get("views") or {}
        upsert_library_index(
            fs,
            {
                "stacks": stacks,
                "node_name": node_name,
                "board": board_name,
                "preflop_line": preflop_line,
                "alive_positions": ctx["alive_positions"],
                "icm": ctx["is_icm"],
                "created_utc": ctx["created_utc"],
                "flop_nodes": len(flop_views),
                "turn_streets": turn_streets,
                "cfr_available": True,
            },
        )
        publish_info.update({"stacks": stacks, "node_name": node_name})

    # Street-bundle extraction (flop + all turns) -> gzipped bundles -> ADLS.
    # The flop is published mid-extraction via on_flop_ready.
    log(f"  -> Extracting streets (turn_precompute={PIO_TURN_PRECOMPUTE})...")
    extract = extract_board(
        cfr_path,
        PIO_DIR_FOR_PYOSOLVER,
        turn_precompute=PIO_TURN_PRECOMPUTE,
        on_flop_ready=publish_streets,
    )
    if extract is None or not extract["streets"].get("r:0", {}).get("views"):
        raise RuntimeError("extraction produced no flop decision nodes; nothing uploaded")

    stage("Uploading")
    publish_streets(extract)

    stacks = publish_info["stacks"]
    node_name = publish_info["node_name"]

    # Local disk housekeeping
    registry.touch(stacks, node_name, board_name)
    for evicted in registry.enforce_budget():
        mark_cfr_unavailable(fs, evicted["stacks"], evicted["node_name"], evicted["board"])
    prune_temp_json(TEMP_JSON_DIR)

    return {"stacks": stacks, "node_name": node_name, "board": board_name}


# =========================
# On-demand street requests (noderequests/ queue)
# =========================
def _parse_node_request(raw: str) -> Optional[Dict[str, str]]:
    """Validate a noderequests blob. node_id must be a colon path whose last
    segment is a dealt card (a street seed)."""
    try:
        obj = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    req = {
        "stacks": obj.get("stacks"),
        "node_name": obj.get("node_name"),
        "board": obj.get("board"),
        "node_id": obj.get("node_id"),
    }
    if not all(isinstance(v, str) and v for v in req.values()):
        return None
    segs = req["node_id"].split(":")
    if len(segs) < 3 or segs[0] != "r" or not CARD_SEG_RE.match(segs[-1]):
        return None
    return req


def _process_node_group(
    fs, stacks: str, node_name: str, board: str, seeds: List[str], registry: CfrRegistry
) -> None:
    base = board_base_path(stacks, node_name, board)
    manifest = download_manifest(fs, stacks, node_name, board)
    if manifest is None:
        log(f"  [nodereq] No manifest for {board}; skipping {len(seeds)} request(s)")
        return

    streets = manifest.setdefault("streets", {})
    pending = [
        s for s in seeds if not streets.get(node_id_to_suffix(s), {}).get("extracted")
    ]
    if not pending:
        log(f"  [nodereq] {board}: all {len(seeds)} requested street(s) already extracted")
        return

    cfr_path = registry.lookup(stacks, node_name, board)
    if cfr_path is None:
        # Local .cfr was evicted: flag the streets as resolving and re-solve
        # from the original gametree config, which re-extracts flop+turns and
        # restores cfr availability; then fall through to street extraction.
        log(f"  [nodereq] {board}: cfr evicted; re-solving from original gametree")
        now = datetime.now(timezone.utc).isoformat()
        for seed_id in pending:
            streets[node_id_to_suffix(seed_id)] = {
                "street": "river",
                "file": f"streets/{node_id_to_suffix(seed_id)}.json.gz",
                "extracted": False,
                "status": "resolving",
                "requested_utc": now,
            }
        upload_manifest(fs, base, manifest)

        gametree_path = (manifest.get("preflop") or {}).get("gametree_path")
        if not gametree_path:
            log(f"  [nodereq] {board}: no gametree_path in manifest; cannot re-solve")
            return
        with PioClient(PIO_EXE) as pio:
            process_gametree_json(
                fs, gametree_path, gametree_path.rsplit("/", 1)[-1], "re-solve", pio, registry
            )
        cfr_path = registry.lookup(stacks, node_name, board)
        if cfr_path is None:
            log(f"  [nodereq] {board}: re-solve did not produce a cfr; giving up")
            return
        manifest = download_manifest(fs, stacks, node_name, board) or manifest
        streets = manifest.setdefault("streets", {})

    log(f"  [nodereq] {board}: extracting {len(pending)} street(s) from {os.path.basename(cfr_path)}")
    extract = extract_board(cfr_path, PIO_DIR_FOR_PYOSOLVER, seeds=pending)
    if extract is None:
        log(f"  [nodereq] {board}: extraction failed")
        return

    ctx = context_from_manifest(
        manifest, os.path.basename(cfr_path), extract["tree_info"], base_prefix=BASE_PREFIX
    )
    for seed_id in pending:
        walk = extract["streets"].get(seed_id)
        if not walk or not walk["views"]:
            log(f"  [nodereq] {board}: street {seed_id} produced no decision nodes; skipping")
            streets.pop(node_id_to_suffix(seed_id), None)
            continue
        bundle = build_street_bundle(
            seed_id, walk["views"], walk["nodes_meta"], ctx, extract["hand_order"]
        )
        if upload_street_bundle(fs, base, bundle, TEMP_JSON_DIR):
            streets[bundle["seed_suffix"]] = street_entry(
                bundle["seed_suffix"], bundle["street"], len(walk["views"])
            )

    manifest["updated_utc"] = datetime.now(timezone.utc).isoformat()
    upload_manifest(fs, base, manifest)
    registry.touch(stacks, node_name, board)


def process_node_requests(
    fs, blob_service, items: List[Tuple[str, str, str]], registry: CfrRegistry
) -> None:
    """Drain a batch of reconcile-discovered noderequests, grouped per board so
    one cfr load serves every street requested for that board. Handled (and
    permanently invalid) blobs are archived out of the watched prefix; blobs in
    a failed group stay put so a later pass retries them."""
    groups: Dict[Tuple[str, str, str], List[str]] = {}
    paths_by_key: Dict[Tuple[str, str, str], List[str]] = {}
    for full_path, _name, _lm in items:
        raw = download_text(fs, full_path)
        req = _parse_node_request(raw) if raw else None
        if req is None:
            log(f"  [nodereq] Invalid request blob (archiving): {full_path}")
            archive_request_blob(blob_service, full_path)
            continue
        key = (req["stacks"], req["node_name"], req["board"])
        groups.setdefault(key, [])
        paths_by_key.setdefault(key, []).append(full_path)
        if req["node_id"] not in groups[key]:
            groups[key].append(req["node_id"])

    for (stacks, node_name, board), seeds in groups.items():
        try:
            _process_node_group(fs, stacks, node_name, board, seeds, registry)
        except Exception as e:
            log(f"  [nodereq] ERROR for {board}: {e}")
            continue
        for full_path in paths_by_key[(stacks, node_name, board)]:
            archive_request_blob(blob_service, full_path)


def _park_poison_message(queue: QueueClient, poison: QueueClient, msg) -> None:
    """Copy a message to the poison queue, then delete the original. If the
    copy fails the original is kept for redelivery - better retried than
    silently lost."""
    try:
        poison.send_message(msg.content)
    except Exception as e:
        log(f"  [nodereq] failed to park poison message: {e}")
        return
    try:
        queue.delete_message(msg)
    except Exception as e:
        log(f"  [nodereq] failed to delete parked message: {e}")


def drain_noderequest_queue(
    fs,
    blob_service,
    queue: QueueClient,
    poison: QueueClient,
    seen_reqs: Set[str],
    registry: CfrRegistry,
) -> None:
    """Receive push messages one at a time and handle each fully before
    deleting it. One at a time on purpose: a batch receive under the long
    visibility timeout would let later messages expire toward the poison
    threshold while an earlier ~10-minute re-solve runs, dead-lettering good
    work. At dozens of messages a day batching buys nothing."""
    while True:
        try:
            msg = queue.receive_message(visibility_timeout=QUEUE_VISIBILITY_SECS)
        except Exception as e:
            log(f"  [nodereq] queue receive failed: {e}")
            return
        if msg is None:
            return

        if (msg.dequeue_count or 0) >= QUEUE_MAX_DEQUEUE:
            log(
                f"  [nodereq] poison message after {msg.dequeue_count} dequeues; "
                f"parking: {(msg.content or '')[:200]}"
            )
            _park_poison_message(queue, poison, msg)
            continue

        req = parse_queue_message(msg.content or "")
        if req is None:
            log(f"  [nodereq] unparseable queue message; parking: {(msg.content or '')[:200]}")
            _park_poison_message(queue, poison, msg)
            continue

        path = req["path"]
        if path in seen_reqs:
            log(f"  [nodereq] push: already handled this session, deleting message: {path}")
            queue.delete_message(msg)
            continue
        # A missing source blob means an earlier session handled and archived
        # this request; the message is a leftover duplicate.
        if not fs.get_file_client(path).exists():
            log(f"  [nodereq] push: blob already archived, deleting message: {path}")
            seen_reqs.add(path)
            queue.delete_message(msg)
            continue

        log(f"  [nodereq] push: {path} ({req['board']} {req['node_id']})")
        try:
            _process_node_group(
                fs, req["stacks"], req["node_name"], req["board"], [req["node_id"]], registry
            )
        except Exception as e:
            # Leave the message: it redelivers after the visibility timeout
            # and counts toward the poison threshold; the blob also stays in
            # place for the reconcile net.
            log(f"  [nodereq] push: ERROR for {req['board']}: {e} (message will redeliver)")
            continue
        seen_reqs.add(path)
        archive_request_blob(blob_service, path)
        queue.delete_message(msg)


def process_claimed_job(fs, job: Dict[str, Any], registry: CfrRegistry) -> None:
    """Run one claimed queue job through the solve pipeline, reporting status
    transitions (Solving -> Extracting -> Uploading -> Done/Failed) and
    heartbeating for the duration. Never raises: every failure becomes a
    Failed report plus a log line."""
    job_id = str(job["id"])
    blob_path = job["blobPath"]
    name = blob_path.rsplit("/", 1)[-1]
    log(f"[JOB {job_id}] attempt {job.get('attemptCount')}: {blob_path}")

    api_client.report(job_id, status="Solving")
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    with api_client.Heartbeat(job_id):
        # Fresh Pio process per job – guarantees shutdown after CFR
        with PioClient(PIO_EXE) as pio:
            try:
                result = process_gametree_json(
                    fs,
                    blob_path,
                    name,
                    "queued-job",
                    pio,
                    registry,
                    on_stage=lambda s: api_client.report(job_id, status=s),
                )
            except Exception as e:
                error = str(e)
                log(f"  -> ERROR processing {blob_path}: {e}")

    if result is not None:
        api_client.report(job_id, status="Done", result=result)
    else:
        api_client.report(job_id, status="Failed", error=error or "no output produced")


# =========================
# Main loop
# =========================
def main():
    if not CONN_STR:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING env var not set")

    fs = get_fs_client()
    log("Connected to ADLS filesystem OK.")

    # Gametree discovery: SolveJobs queue API when configured (or forced),
    # ADLS blob listing otherwise. See WATCHER_USE_QUEUE_ENV.
    if WATCHER_USE_QUEUE_ENV is None:
        queue_mode = api_client.enabled()
    else:
        queue_mode = WATCHER_USE_QUEUE_ENV != "0"
    if queue_mode and not api_client.enabled():
        raise RuntimeError(
            "WATCHER_USE_QUEUE=1 but HOLDEMTOOLS_API_BASE / WATCHER_API_KEY are not set"
        )
    log(
        f"Gametree discovery: {'queue API (' + api_client.watcher_id() + ')' if queue_mode else 'ADLS blob listing'}"
    )

    sub_today = today_subpath_utc()
    watch_label = f"{BASE_PREFIX}/{sub_today}" if WATCH_TODAY_ONLY else f"{BASE_PREFIX}/"
    log(f"Watching: {watch_label}/ (UTC)")
    log(f"PioViewer title regex: /{PIO_TITLE_RE}/")
    log(f"Pio console exe: {PIO_EXE}")
    log(f"TreeBuilding dir: {TREEBUILD_DIR}")
    log(f"CFR subdir: {CFR_SUBDIR}")
    log(f"Tree script basename (Save current parameters): {TREE_SCRIPT_BASENAME}")

    # Noderequest push path: poll the storage queue instead of listing ADLS.
    # Init failure (or WATCHER_NODEREQ_QUEUE=0) falls back to pure listing.
    nodereq_queue = nodereq_poison = None
    if NODEREQ_QUEUE_ENV != "0":
        try:
            nodereq_queue, nodereq_poison = get_noderequest_queues()
        except Exception as e:
            log(f"[nodereq] queue init failed ({e}); falling back to listing every iteration")
    push_on = nodereq_queue is not None
    blob_service = BlobServiceClient.from_connection_string(CONN_STR)

    if push_on:
        log(
            f"Noderequest discovery: storage queue '{NODEREQ_QUEUE_NAME}' every "
            f"{POLL_SECS:.1f}s + reconcile listing every {NODEREQ_RECONCILE_SECS:.0f}s"
        )
    else:
        log("Noderequest discovery: ADLS listing every iteration (queue push off)")
    log(
        f"Gametree {'claim poll' if queue_mode else 'listing'}: every "
        f"{CLAIM_POLL_SECS:.0f}s; loop poll {POLL_SECS:.1f}s\n"
    )

    # In queue mode gametree discovery is DB-driven, so no blob-listing seed
    # (and none of its restart/UTC-midnight fragility) is needed for it.
    # Noderequests are never seeded as seen: handled blobs are archived out of
    # the prefix, so anything still listed is unhandled work - including
    # requests that arrived while the watcher was down.
    seen = set() if queue_mode else list_existing_json(fs, BASE_PREFIX, WATCH_TODAY_ONLY)
    seen_reqs: Set[str] = set()
    log(
        f"Seeded with {len(seen)} gametree(s). "
        f"Turn precompute: {'on' if PIO_TURN_PRECOMPUTE else 'off'}"
    )

    solved_dir = os.path.join(os.path.dirname(PIO_EXE) or ".", CFR_SUBDIR)
    registry = CfrRegistry(solved_dir, max_gb=float(os.getenv("PIO_CFR_MAX_GB", "150")))
    log(f"CFR registry: {solved_dir} (budget {registry.max_bytes / 1024**3:.0f} GB)")

    last_reconcile = 0.0  # monotonic; 0 forces an immediate first pass
    last_claim = 0.0
    try:
        while True:
            # On-demand street requests first: they are seconds-scale and a
            # browsing user is actively waiting on them.
            if push_on:
                drain_noderequest_queue(
                    fs, blob_service, nodereq_queue, nodereq_poison, seen_reqs, registry
                )

            # Reconcile listing: the safety net behind the push path (its only
            # job when push is on is catching requests whose enqueue failed or
            # whose message was lost). With push off it IS the discovery path
            # and runs every iteration.
            if not push_on or time.monotonic() - last_reconcile >= NODEREQ_RECONCILE_SECS:
                last_reconcile = time.monotonic()
                new_reqs = list_new_json(fs, seen_reqs, NODEREQ_PREFIX, WATCH_TODAY_ONLY)
                if new_reqs:
                    log(f"  [nodereq] reconcile: {len(new_reqs)} request(s) discovered via listing")
                    for full_path, _name, _lm in new_reqs:
                        seen_reqs.add(full_path)
                    try:
                        process_node_requests(fs, blob_service, new_reqs, registry)
                    except Exception as e:
                        log(f"  -> ERROR processing node requests: {e}")

            # One gametree per pass, on its own slow timer (App Service CPU /
            # list ops are the scarce resource, and solves take ~10 min
            # anyway). After a processed job, loop straight back around -
            # node requests get re-checked between solves, and the unmoved
            # timer drains any queued burst without waiting.
            if time.monotonic() - last_claim >= CLAIM_POLL_SECS:
                if queue_mode:
                    job = api_client.claim_next()
                    if job is not None:
                        process_claimed_job(fs, job, registry)
                        continue
                else:
                    new_items = list_new_json(fs, seen, BASE_PREFIX, WATCH_TODAY_ONLY)
                    if new_items:
                        full_path, name, lm = new_items[0]
                        seen.add(full_path)

                        # Fresh Pio process per file – guarantees shutdown after CFR
                        with PioClient(PIO_EXE) as pio:
                            try:
                                process_gametree_json(fs, full_path, name, lm, pio, registry)
                            except Exception as e:
                                log(f"  -> ERROR processing {full_path}: {e}")
                        continue
                last_claim = time.monotonic()

            time.sleep(POLL_SECS)
    except KeyboardInterrupt:
        log("Exiting on Ctrl+C")
    finally:
        sys.exit(0)


if __name__ == "__main__":
    main()
