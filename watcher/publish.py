"""Publish orchestration shared by both watchers.

Moved out of the `publish_streets` closure in watch_adls_and_run_pio_headless.py
so the Pio watcher and the htsolver worker publish a board through the same
sequence: build bundles for streets not yet published, upload them in
parallel, merge the new street entries into whatever manifest is already in
ADLS, upload the manifest, and hand back the library index entry.

Who writes the INDEX is the caller's decision, never this module's: the Pio
watcher keeps upserting `piosolutions-index.json` itself, while the htsolver
worker sends the entry to the API (which owns `enginesolutions-index.json`).

A publisher is called more than once per solve (flop first so the board opens
early, then everything); `published_suffixes` keeps a bundle from uploading
twice and the manifest merge keeps earlier entries, so the second call is
purely additive.
"""

from __future__ import annotations

import contextlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, ContextManager, Dict, List, Optional, Set, Tuple

from adls_store import board_base_path, download_manifest, upload_manifest, upload_street_bundle
from extraction import build_manifest, build_street_bundle, node_id_to_suffix, street_entry


class BoardPublisher:
    """Publishes one board's streets, possibly in several passes.

    build_ctx(extract_like) -> board context (extraction.build_board_context
        or context_from_manifest); called on every pass, like the closure did.
    cfr_size() -> the local .cfr size for the manifest's cfr block (Pio only).
    engine -> the htsolver manifest block; None for a Pio board.
    cfr_available -> the index entry's flag (True for Pio, which holds a .cfr).
    manifest_lock -> a context manager held around the manifest
        read-modify-write (the htsolver worker's per-board lock).
    """

    def __init__(
        self,
        fs: Any,
        *,
        board: str,
        build_ctx: Callable[[Dict[str, Any]], Dict[str, Any]],
        upload_workers: int = 8,
        temp_json_dir: Optional[str] = None,
        cfr_size: Optional[Callable[[], Optional[int]]] = None,
        engine: Optional[Dict[str, Any]] = None,
        cfr_available: bool = True,
        manifest_lock: Optional[Callable[[], ContextManager[Any]]] = None,
    ) -> None:
        self.fs = fs
        self.board = board
        self.build_ctx = build_ctx
        self.upload_workers = max(1, int(upload_workers))
        self.temp_json_dir = temp_json_dir
        self.cfr_size = cfr_size or (lambda: None)
        self.engine = engine
        self.cfr_available = cfr_available
        self.manifest_lock = manifest_lock or contextlib.nullcontext
        self.published_suffixes: Set[str] = set()
        self.stacks: Optional[str] = None
        self.node_name: Optional[str] = None
        self.manifest: Optional[Dict[str, Any]] = None

    def publish(self, extract_like: Dict[str, Any]) -> Dict[str, Any]:
        """One pass. Returns the library index entry for the merged manifest."""
        ctx = self.build_ctx(extract_like)
        stacks = ctx["stacks"] or "nostacks"
        node_name = ctx["node_name"] or "nonode"
        base = board_base_path(stacks, node_name, self.board)
        ctx["effective_stack_chips"] = extract_like.get("effective_stack")

        root_view = (extract_like["streets"].get("r:0") or {}).get("views", {}).get("r:0")
        if root_view and root_view.get("pot"):
            ctx["pot_chips"] = root_view["pot"][-1]

        to_upload: List[Tuple[str, Dict[str, Any], Dict[str, Any]]] = []
        for seed_id, walk in extract_like["streets"].items():
            suffix = node_id_to_suffix(seed_id)
            if suffix in self.published_suffixes:
                continue
            bundle = build_street_bundle(
                seed_id, walk["views"], walk["nodes_meta"], ctx, extract_like["hand_order"]
            )
            to_upload.append((suffix, walk, bundle))

        streets_map: Dict[str, Any] = {}
        if to_upload:
            with ThreadPoolExecutor(max_workers=self.upload_workers) as pool:
                futures = {
                    pool.submit(upload_street_bundle, self.fs, base, bundle, self.temp_json_dir): (
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
                        self.published_suffixes.add(suffix)

        cfr_size = self.cfr_size()
        # Merge into any existing manifest so a re-solve keeps street entries
        # (e.g. rivers) extracted before the local artifact was evicted, and
        # the full-sweep publish keeps the flop entry from the early publish.
        with self.manifest_lock():
            existing_manifest = download_manifest(self.fs, stacks, node_name, self.board)
            manifest = build_manifest(
                ctx, streets_map, cfr_size_bytes=cfr_size, existing=existing_manifest,
                engine=self.engine,
            )
            upload_manifest(self.fs, base, manifest)

        self.stacks, self.node_name, self.manifest = stacks, node_name, manifest
        return index_entry(manifest, ctx, extract_like, cfr_available=self.cfr_available,
                           board=self.board, stacks=stacks, node_name=node_name)


def index_entry(
    manifest: Dict[str, Any],
    ctx: Dict[str, Any],
    extract_like: Dict[str, Any],
    *,
    cfr_available: bool,
    board: str,
    stacks: str,
    node_name: str,
) -> Dict[str, Any]:
    """The library index entry for a board, counted off the MERGED manifest so
    it is right whichever publish pass produced it."""
    turn_streets = sum(
        1
        for e in manifest["streets"].values()
        if e.get("street") == "turn" and e.get("extracted")
    )
    flop_views = (extract_like["streets"].get("r:0") or {}).get("views") or {}
    entry: Dict[str, Any] = {
        "stacks": stacks,
        "node_name": node_name,
        "board": board,
        "preflop_line": ctx.get("preflop_line"),
        "alive_positions": ctx["alive_positions"],
        "icm": ctx["is_icm"],
        "created_utc": ctx["created_utc"],
        "flop_nodes": len(flop_views),
        "turn_streets": turn_streets,
        "cfr_available": cfr_available,
    }
    engine = manifest.get("engine")
    if isinstance(engine, dict) and engine.get("solver"):
        entry["solver"] = engine["solver"]
    return entry
