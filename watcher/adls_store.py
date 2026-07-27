"""ADLS upload helpers for the v2 postflop solution layout.

Layout:
  piosolutions/{stacks}/{node_name}/{board}/{node_suffix}.json   per-node docs
  piosolutions/{stacks}/{node_name}/{board}/manifest.json        per-board manifest
  piosolutions-index.json                                        library index (container root)

Single watcher process = single writer, so read-modify-write on the manifest
and index needs no locking.
"""

import gzip
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


INDEX_PATH = "piosolutions-index.json"


def board_base_path(stacks: str, node_name: str, board: str) -> str:
    return f"piosolutions/{stacks}/{node_name}/{board}"


def _upload_json(fs, rel_path: str, obj: Any) -> bool:
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    try:
        fs.get_file_client(rel_path).upload_data(text, overwrite=True)
        log(f"  [upload] {rel_path} ({len(text)} bytes)")
        return True
    except Exception as e:
        log(f"  [upload] ERROR uploading {rel_path}: {e}")
        return False


def _download_json(fs, rel_path: str) -> Optional[Any]:
    try:
        data = fs.get_file_client(rel_path).download_file().readall()
        return json.loads(data)
    except Exception:
        return None


def upload_gzip_json(fs, rel_path: str, obj: Any) -> bool:
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    packed = gzip.compress(raw)
    try:
        fs.get_file_client(rel_path).upload_data(packed, overwrite=True)
        log(f"  [upload] {rel_path} ({len(packed)} bytes gzipped, {len(raw)} raw)")
        return True
    except Exception as e:
        log(f"  [upload] ERROR uploading {rel_path}: {e}")
        return False


def upload_street_bundle(
    fs, base_path: str, bundle: Dict[str, Any], temp_json_dir: Optional[str] = None
) -> bool:
    seed_suffix = bundle["seed_suffix"]
    ok = upload_gzip_json(fs, f"{base_path}/streets/{seed_suffix}.json.gz", bundle)
    if temp_json_dir:
        try:
            local = os.path.join(
                temp_json_dir, f"{bundle.get('board')}-{seed_suffix}.bundle.json"
            )
            with open(local, "w", encoding="utf-8") as f:
                json.dump(bundle, f, separators=(",", ":"), ensure_ascii=False)
        except OSError as e:
            log(f"  [upload] ERROR writing local bundle JSON: {e}")
    return ok


def upload_manifest(fs, base_path: str, manifest: Dict[str, Any]) -> bool:
    return _upload_json(fs, f"{base_path}/manifest.json", manifest)


def download_manifest(fs, stacks: str, node_name: str, board: str) -> Optional[Dict[str, Any]]:
    return _download_json(fs, f"{board_base_path(stacks, node_name, board)}/manifest.json")


def upsert_library_index(fs, entry: Dict[str, Any]) -> None:
    """Add or update one entry keyed by (stacks, node_name, board)."""
    index = _download_json(fs, INDEX_PATH)
    if not isinstance(index, dict) or not isinstance(index.get("entries"), list):
        index = {"schema": 2, "entries": []}

    key = (entry.get("stacks"), entry.get("node_name"), entry.get("board"))
    entries: List[Dict[str, Any]] = index["entries"]
    for i, e in enumerate(entries):
        if (e.get("stacks"), e.get("node_name"), e.get("board")) == key:
            entries[i] = {**e, **entry}
            break
    else:
        entries.append(entry)

    index["updated_utc"] = datetime.now(timezone.utc).isoformat()
    _upload_json(fs, INDEX_PATH, index)


def mark_cfr_unavailable(fs, stacks: str, node_name: str, board: str) -> None:
    """After a local LRU eviction, flip cfr.available in the manifest + index."""
    manifest = download_manifest(fs, stacks, node_name, board)
    if manifest and isinstance(manifest.get("cfr"), dict):
        manifest["cfr"]["available"] = False
        manifest["updated_utc"] = datetime.now(timezone.utc).isoformat()
        upload_manifest(fs, board_base_path(stacks, node_name, board), manifest)
    upsert_library_index(
        fs,
        {"stacks": stacks, "node_name": node_name, "board": board, "cfr_available": False},
    )
