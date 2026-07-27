r"""Regenerate v3 street bundles + manifest for already-solved boards from
their local .cfr files - no re-solve.

Usage:
  python reextract.py --all                     # every board in registry.json
  python reextract.py STACKS NODE_NAME BOARD    # one board

Context (seats, preflop line, summary) is rebuilt from the board's existing
ADLS manifest, so the board must have been solved by the v2+ pipeline.
"""

import os
import sys

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

from azure.storage.filedatalake import DataLakeServiceClient

from adls_store import (
    board_base_path,
    download_manifest,
    upload_manifest,
    upload_street_bundle,
    upsert_library_index,
)
from cfr_registry import CfrRegistry
from extraction import (
    build_manifest,
    build_street_bundle,
    context_from_manifest,
    extract_board,
    street_entry,
)

CONN_STR = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
CONTAINER = os.getenv("AZURE_STORAGE_CONTAINER", "onlinerangedata")
PIO_EXE = os.getenv("PIO_EXE", r"C:\PioSOLVER\PioSOLVER2-edge.exe")
PIO_DIR = os.getenv("PIO_DIR_FOR_PYOSOLVER", r"C:\PioSOLVER")
CFR_SUBDIR = os.getenv("PIO_CFR_SUBDIR", "Solved")
TURN_PRECOMPUTE = os.getenv("PIO_TURN_PRECOMPUTE", "1") != "0"


def log(msg: str) -> None:
    print(msg, flush=True)


def reextract_board(fs, registry: CfrRegistry, stacks: str, node_name: str, board: str) -> bool:
    cfr_path = registry.lookup(stacks, node_name, board)
    if cfr_path is None:
        log(f"SKIP {board}: no local cfr (evicted?) for {stacks}|{node_name}")
        return False

    manifest = download_manifest(fs, stacks, node_name, board)
    if manifest is None:
        log(f"SKIP {board}: no existing manifest to rebuild context from")
        return False

    log(f"Re-extracting {board} ({os.path.basename(cfr_path)}), turns={TURN_PRECOMPUTE}")
    extract = extract_board(cfr_path, PIO_DIR, turn_precompute=TURN_PRECOMPUTE)
    if extract is None or not extract["streets"].get("r:0", {}).get("views"):
        log(f"FAIL {board}: extraction produced nothing")
        return False

    ctx = context_from_manifest(manifest, os.path.basename(cfr_path), extract["tree_info"])
    ctx["effective_stack_chips"] = extract.get("effective_stack")
    root_view = extract["streets"]["r:0"]["views"].get("r:0")
    if root_view and root_view.get("pot"):
        ctx["pot_chips"] = root_view["pot"][-1]

    base = board_base_path(stacks, node_name, board)
    streets_map = {}
    for seed_id, walk in extract["streets"].items():
        bundle = build_street_bundle(
            seed_id, walk["views"], walk["nodes_meta"], ctx, extract["hand_order"]
        )
        if upload_street_bundle(fs, base, bundle):
            streets_map[bundle["seed_suffix"]] = street_entry(
                bundle["seed_suffix"], bundle["street"], len(walk["views"])
            )

    cfr_size = os.path.getsize(cfr_path)
    new_manifest = build_manifest(ctx, streets_map, cfr_size, existing=manifest)
    upload_manifest(fs, base, new_manifest)

    upsert_library_index(
        fs,
        {
            "stacks": stacks,
            "node_name": node_name,
            "board": board,
            "flop_nodes": len(extract["streets"]["r:0"]["views"]),
            "turn_streets": sum(1 for e in streets_map.values() if e["street"] == "turn"),
            "cfr_available": True,
        },
    )
    registry.touch(stacks, node_name, board)
    log(f"OK {board}: {len(streets_map)} street bundle(s)")
    return True


def main() -> int:
    if not CONN_STR:
        print("AZURE_STORAGE_CONNECTION_STRING not set")
        return 1
    fs = DataLakeServiceClient.from_connection_string(CONN_STR).get_file_system_client(CONTAINER)
    registry = CfrRegistry(os.path.join(os.path.dirname(PIO_EXE) or ".", CFR_SUBDIR))

    if len(sys.argv) == 2 and sys.argv[1] == "--all":
        targets = [
            (e["stacks"], e["node_name"], e["board"]) for e in registry._entries.values()
        ]
    elif len(sys.argv) == 4:
        targets = [(sys.argv[1], sys.argv[2], sys.argv[3])]
    else:
        print(__doc__)
        return 1

    ok = 0
    for stacks, node_name, board in targets:
        if reextract_board(fs, registry, stacks, node_name, board):
            ok += 1
    log(f"Done: {ok}/{len(targets)} board(s) re-extracted")
    return 0 if ok == len(targets) else 2


if __name__ == "__main__":
    sys.exit(main())
