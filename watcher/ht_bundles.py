"""The ONE adapter from htsolver's engine to schema 4.

`engine dump-streets` (contract: engine/ and the htsolver solve-jobs plan)
writes one JSON document per street of an artifact. This module turns each
of those into exactly the `views` / `nodes_meta` dicts that
`extraction.walk_street` produces from a live Pio process, so the schema-4
street bundle, node doc and manifest are built by extraction.py's own
builders for both solvers. Schema 4 therefore has one definition, in the
file the repo already names as its source of truth, and nothing here knows
what a bundle looks like.

The engine stores each seat's rows over a compact hand universe (the combos
the board leaves possible). extraction.build_node_doc aggregates only over a
dense 1326 `hand_order`, so every vector is expanded against ONE fixed
canonical order, the engine's own (`CANONICAL_HANDS`). A hand a seat does not
hold gets weight 0 and is then dropped by build_seat_combo_block; its strategy
row is 0.0 so the reach-weighted 169 aggregation is unaffected, and its EV /
equity are None so class averages skip it.

CLI (local dev viewing through the API's Engine:LocalSolutionsDir):
    python ht_bundles.py export <artifact.hta> --gametree <blob.json> --out <dir>
                                [--through flop|turn] [--engine-exe <path>]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

WATCHER_DIR = os.path.dirname(os.path.abspath(__file__))
if WATCHER_DIR not in sys.path:
    sys.path.insert(0, WATCHER_DIR)

from extraction import CHANCE_TYPE, node_id_to_suffix  # noqa: E402

# =========================
# Canonical 1326 hand order
# =========================
RANK_CHARS = "23456789TJQKA"
SUIT_CHARS = "cdhs"


def card_code(card: str) -> int:
    """'As' -> 51, '2c' -> 0 (rank * 4 + suit, ranks 2..A, suits c,d,h,s)."""
    return RANK_CHARS.index(card[0]) * 4 + SUIT_CHARS.index(card[1])


def card_str(code: int) -> str:
    return RANK_CHARS[code // 4] + SUIT_CHARS[code % 4]


def _canonical_hands() -> List[str]:
    """The engine's 1326 order: pairs (hi, lo), hi descending then lo
    descending, the higher card printed first. Index 0 is 'AsAh', the last is
    '2d2c'."""
    out: List[str] = []
    for hi in range(51, 0, -1):
        for lo in range(hi - 1, -1, -1):
            out.append(card_str(hi) + card_str(lo))
    return out


CANONICAL_HANDS: List[str] = _canonical_hands()


def _combo_key(hand: str) -> Tuple[int, int]:
    a, b = card_code(hand[0:2]), card_code(hand[2:4])
    return (a, b) if a > b else (b, a)


CANONICAL_INDEX: Dict[Tuple[int, int], int] = {
    _combo_key(h): i for i, h in enumerate(CANONICAL_HANDS)
}


def canonical_positions(hands: Sequence[str]) -> List[int]:
    """Map the artifact's hand dictionary onto CANONICAL_HANDS positions.
    Either card order is accepted, so a dictionary that prints the lower card
    first still lands on the right combo."""
    return [CANONICAL_INDEX[_combo_key(h)] for h in hands]


# =========================
# Engine process
# =========================
def run_dump_streets(
    engine_exe: str,
    artifact: str,
    out_dir: str,
    *,
    through: Optional[str] = None,
    seeds: Optional[Iterable[str]] = None,
    equity: bool = True,
    timeout: float = 1800.0,
) -> Dict[str, Any]:
    """Shell `engine dump-streets` and return the parsed streets.json.

    Exactly one of `through` ("flop" or "turn") or `seeds` (colon ids). The
    per-street documents stay on disk under `out_dir`; read them with
    `load_street`.
    """
    seeds = list(seeds or [])
    if (through is None) == (not seeds):
        raise ValueError("pass exactly one of through= or seeds=")
    os.makedirs(out_dir, exist_ok=True)
    # Absolute: CreateProcess does not resolve a relative path that uses
    # forward slashes ("engine/build/engine.exe" is "file not found").
    cmd = [os.path.abspath(engine_exe), "dump-streets", artifact, "--out-dir", out_dir]
    if through is not None:
        cmd += ["--through", through]
    for seed in seeds:
        cmd += ["--seed", seed]
    if equity:
        cmd.append("--equity")
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        text = (proc.stderr + "\n" + proc.stdout).strip()
        raise RuntimeError(f"engine dump-streets failed (exit {proc.returncode}): {text[-1500:]}")
    with open(os.path.join(out_dir, "streets.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def load_street(out_dir: str, entry: Dict[str, Any]) -> Dict[str, Any]:
    """Read one per-street document named by a streets.json entry."""
    name = entry.get("file") or (entry["seed"].replace(":", ".") + ".json")
    with open(os.path.join(out_dir, name), "r", encoding="utf-8") as f:
        return json.load(f)


# =========================
# Reach helpers
# =========================
def _dense(positions: List[int], idx: List[int], values: Optional[List[float]], fill: Any) -> List[Any]:
    out: List[Any] = [fill] * 1326
    if values is None:
        return out
    for k, i in enumerate(idx):
        if k < len(values):
            out[positions[i]] = values[k]
    return out


def pair_weight(
    seat_a: Dict[str, Any], seat_b: Dict[str, Any], hands: Sequence[str]
) -> float:
    """Card-disjoint pair mass of two seats' reach (inclusion-exclusion over
    shared cards), the Python twin of EngineSolutionExporter.GlobalFreq:

        z = sum_i a_i * (total_b - b[hi_i] - b[lo_i] + b_i)

    where b[c] is b's reach on hands holding card c and b_i is b's reach on
    the identical combo (subtracted twice above)."""
    a_idx, a_reach = seat_a.get("idx") or [], seat_a.get("reach") or []
    b_idx, b_reach = seat_b.get("idx") or [], seat_b.get("reach") or []
    if not a_idx or not b_idx:
        return 0.0
    per_card = [0.0] * 52
    by_hand: Dict[int, float] = {}
    total_b = 0.0
    for i, r in zip(b_idx, b_reach):
        hi, lo = _combo_key(hands[i])
        total_b += r
        per_card[hi] += r
        per_card[lo] += r
        by_hand[i] = by_hand.get(i, 0.0) + r
    z = 0.0
    for i, r in zip(a_idx, a_reach):
        hi, lo = _combo_key(hands[i])
        z += r * (total_b - per_card[hi] - per_card[lo] + by_hand.get(i, 0.0))
    return z


def root_pair_weight(street_doc: Dict[str, Any], hands: Sequence[str]) -> Optional[float]:
    """The pair mass at the tree root, when this street document holds it."""
    for node in street_doc.get("nodes") or []:
        if node.get("id") == "r:0" and node.get("kind") == "decision":
            seats = node.get("seats") or []
            if len(seats) == 2:
                return pair_weight(seats[0], seats[1], hands)
    return None


def _finite(x: Any) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)


# =========================
# Street document -> walk_street output
# =========================
def _seat_block(
    seat: Dict[str, Any], positions: List[int]
) -> Dict[str, Any]:
    idx = list(seat.get("idx") or [])
    reach = seat.get("reach") or []
    eq = seat.get("eq")
    rng = _dense(positions, idx, reach, 0.0)
    num = den = 0.0
    if eq:
        for r, e in zip(reach, eq):
            if _finite(r) and r > 0 and _finite(e):
                num += r * e
                den += r
    return {
        "range": rng,
        "equity": _dense(positions, idx, eq, None) if eq is not None else None,
        "matchups": _dense(positions, idx, seat.get("mu"), None) if seat.get("mu") is not None else None,
        "equity_total": (num / den) if den > 0 else None,
        "ev": _dense(positions, idx, seat.get("ev"), None) if seat.get("ev") is not None else None,
    }


def street_to_walk(
    street_doc: Dict[str, Any],
    hands: Sequence[str],
    *,
    root_pot: Optional[float] = None,
    root_weight: Optional[float] = None,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """One dump-streets document -> (views keyed by colon id, nodes_meta keyed
    by dotted suffix), the exact shapes extraction.walk_street returns.

    `pot` is Pio's `[commit0, commit1, ROOT pot]`: the commits are the node's
    hand-cumulative postflop chips and the third element is the pot at the
    root of the tree (`root_pot`, normally the artifact's metadata.pot), which
    is what Pio's show_node reports and what manifest.pot_chips is read from.
    Without `root_pot` the node's own `pot` is used.

    `global_freq` is the card-disjoint pair mass of both seats' reach at the
    node over the same mass at the ROOT (`root_weight`, see
    root_pair_weight). It is reach under the average profile only - deal
    probabilities below a chance node are not included - and None when the
    root mass is not at hand (an on-demand river request dumps only its own
    street). The viewer does not read the field.
    """
    positions = canonical_positions(hands)
    street = street_doc.get("street")
    board = list(street_doc.get("board") or [])
    views: Dict[str, Dict[str, Any]] = {}
    nodes_meta: Dict[str, Dict[str, Any]] = {}

    for node in street_doc.get("nodes") or []:
        nid = node["id"]
        suffix = node_id_to_suffix(nid)
        kind = node.get("kind")
        if kind == "chance":
            # A deal with nothing to decide below it is an all-in runout: the
            # viewer must show "Hand ends here - all-in and call" there, never
            # open a card picker for a street that has no decisions.
            if node.get("has_decisions", True):
                nodes_meta[suffix] = {"type": CHANCE_TYPE, "street": street, "extracted": False}
            else:
                nodes_meta[suffix] = {"type": "terminal"}
            continue
        if kind != "decision":
            nodes_meta[suffix] = {"type": "terminal"}
            continue

        actor = int(node.get("actor", 0))
        position = "OOP" if actor == 0 else "IP"
        node_type = "OOP_DEC" if actor == 0 else "IP_DEC"
        labels = list(node.get("actions") or [])
        children = list(node.get("children") or [])
        seats_raw = list(node.get("seats") or [])
        while len(seats_raw) < 2:
            seats_raw.append({"idx": [], "reach": []})
        seat_blocks = [_seat_block(seats_raw[0], positions), _seat_block(seats_raw[1], positions)]

        actor_idx = list(seats_raw[actor].get("idx") or [])
        strategy_rows = node.get("strategy") or []
        strategy = [_dense(positions, actor_idx, row, 0.0) for row in strategy_rows]
        while len(strategy) < len(labels):
            strategy.append([0.0] * 1326)
        action_ev_rows = node.get("action_ev") or []
        action_evs = {
            lbl: (_dense(positions, actor_idx, action_ev_rows[a], None) if a < len(action_ev_rows) else None)
            for a, lbl in enumerate(labels)
        }

        commit = list(node.get("commit") or [0, 0])
        third = root_pot if root_pot is not None else node.get("pot")
        gf: Optional[float] = None
        if root_weight:
            try:
                gf = pair_weight(seats_raw[0], seats_raw[1], hands) / root_weight
            except Exception:  # noqa: BLE001 - never fail a publish on this
                gf = None

        views[nid] = {
            "node_id": nid,
            "position": position,
            "node_type": node_type,
            "board": board,
            "pot": [commit[0] if commit else 0, commit[1] if len(commit) > 1 else 0, third],
            "flags": [],
            "street": street,
            "actions": labels,
            "children": {lbl: cid for lbl, cid in zip(labels, children)},
            "strategy": strategy,
            "evs": {"oop": seat_blocks[0]["ev"], "ip": seat_blocks[1]["ev"]},
            "seats": {"oop": seat_blocks[0], "ip": seat_blocks[1]},
            "global_freq": gf,
            "action_evs": action_evs,
        }
        nodes_meta[suffix] = {
            "type": node_type,
            "street": street,
            "actions": labels,
            "extracted": True,
        }
    return views, nodes_meta


# =========================
# Whole dump -> extract-like
# =========================
def solve_results(metadata: Dict[str, Any]) -> Dict[str, Optional[float]]:
    """Manifest summary stats from artifact metadata: EVs in chips, and Pio's
    "exploitable for" (the per-player average gain), which is NashConv / 2."""
    ev = metadata.get("ev_chips") or [None, None]
    nashconv = metadata.get("final_nashconv")
    return {
        "ev_oop": ev[0] if len(ev) > 0 else None,
        "ev_ip": ev[1] if len(ev) > 1 else None,
        "exploitable": (nashconv / 2.0) if _finite(nashconv) else None,
        "mes_oop": None,
        "mes_ip": None,
    }


def extract_from_dump(
    dump: Dict[str, Any],
    out_dir: str,
    *,
    root_weight: Optional[float] = None,
) -> Dict[str, Any]:
    """A dump-streets run -> the dict shape extraction.extract_board returns
    ({hand_order, tree_info, effective_stack, results, streets}), which is
    what publish.BoardPublisher consumes for both solvers.

    `root_weight` is carried in for a dump that does not contain the root
    (on-demand rivers); otherwise it is read off the flop street."""
    metadata = dump.get("metadata") or {}
    hands = dump.get("hands") or []
    root_pot = metadata.get("pot")
    docs = [(entry, load_street(out_dir, entry)) for entry in dump.get("streets") or []]
    if root_weight is None:
        for _entry, doc in docs:
            root_weight = root_pair_weight(doc, hands)
            if root_weight:
                break
    streets: Dict[str, Dict[str, Any]] = {}
    for entry, doc in docs:
        views, nodes_meta = street_to_walk(doc, hands, root_pot=root_pot, root_weight=root_weight)
        streets[doc.get("seed") or entry["seed"]] = {"views": views, "nodes_meta": nodes_meta}
    return {
        "hand_order": CANONICAL_HANDS,
        "tree_info": {},
        "effective_stack": metadata.get("effective_stack"),
        "results": solve_results(metadata),
        "streets": streets,
        "metadata": metadata,
        "root_weight": root_weight,
    }


def engine_block(metadata: Dict[str, Any], *, watcher_id: Optional[str]) -> Dict[str, Any]:
    """manifest.engine for an htsolver board (contract section 3)."""
    return {
        "solver": "htsolver",
        "version": metadata.get("solver_version"),
        "build": metadata.get("engine_build"),
        "config_hash": metadata.get("config_hash"),
        "iterations": metadata.get("iterations"),
        "exploitable": solve_results(metadata)["exploitable"],
        "watcher_id": watcher_id,
    }


# =========================
# Gametree blob
# =========================
def parse_gametree_blob(raw: str) -> Dict[str, Any]:
    """The fields of an uploaded gametree blob both watchers read, plus the
    htsolver-only `EngineTree` and `Solver`. A non-JSON blob (the oldest
    uploads were raw config text) has no engine tree."""
    try:
        obj = json.loads(raw)
    except ValueError:
        obj = None
    if not isinstance(obj, dict):
        obj = {}
    return {
        "engine_tree": obj.get("EngineTree"),
        "solver": obj.get("Solver"),
        "seat_meta": obj.get("Seats"),
        "hand_bb": obj.get("BigBlind"),
        "chip_scale": obj.get("ChipScale"),
        "preflop_line": obj.get("Line"),
        "acting_pos": obj.get("ActingPos"),
        "alive_positions": obj.get("AlivePositions"),
        "is_icm": obj.get("IsICM"),
    }


def board_from_tree(engine_tree: Dict[str, Any]) -> str:
    """'Qh Jh Th' -> 'QhJhTh' (the board coordinate the library keys on)."""
    return "".join(str(engine_tree.get("board") or "").split())


# =========================
# Local export (dev)
# =========================
class LocalFs:
    """The few ADLS file-system calls adls_store makes, against a directory."""

    def __init__(self, root: str) -> None:
        self.root = root

    def get_file_client(self, rel_path: str) -> "_LocalFile":
        return _LocalFile(os.path.join(self.root, *rel_path.split("/")))


class _LocalFile:
    def __init__(self, path: str) -> None:
        self.path = path

    def upload_data(self, data: Any, overwrite: bool = True) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        mode = "wb" if isinstance(data, (bytes, bytearray)) else "w"
        with open(self.path, mode, **({} if mode == "wb" else {"encoding": "utf-8"})) as f:
            f.write(data)

    def download_file(self) -> "_LocalFile":
        if not os.path.exists(self.path):
            raise FileNotFoundError(self.path)
        return self

    def readall(self) -> bytes:
        with open(self.path, "rb") as f:
            return f.read()

    def exists(self) -> bool:
        return os.path.exists(self.path)


def export_local(
    engine_exe: str,
    artifact: str,
    gametree_blob: str,
    out: str,
    *,
    through: str = "turn",
    gametree_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Dump an artifact and write manifest + street bundles to `out` in the
    piosolutions/ layout. Returns the library index entry."""
    from extraction import build_board_context, parse_gametree_path
    from publish import BoardPublisher

    with open(gametree_blob, "r", encoding="utf-8") as f:
        raw = f.read()
    blob = parse_gametree_blob(raw)
    if not isinstance(blob["engine_tree"], dict):
        raise SystemExit("the gametree blob has no EngineTree")
    board = board_from_tree(blob["engine_tree"])
    # Coordinates come from the blob path exactly as the worker derives them;
    # a local file name stands in for the ADLS path when none is given.
    src_path = gametree_path or (
        "gametrees/0000/00/00/local/folder=local/" + os.path.basename(gametree_blob)
    )
    stacks, node_name, _ = parse_gametree_path(src_path, "gametrees")

    with tempfile.TemporaryDirectory(prefix="ht_export_") as tmp:
        dump = run_dump_streets(engine_exe, artifact, tmp, through=through, equity=True)
        extract = extract_from_dump(dump, tmp)

    def build_ctx(ex: Dict[str, Any]) -> Dict[str, Any]:
        return build_board_context(
            board=board,
            cfr_file="",
            src_gametree_path=src_path,
            base_prefix="gametrees",
            stats=ex["results"],
            tree_info=ex["tree_info"],
            alive_positions=blob["alive_positions"],
            acting_pos=blob["acting_pos"],
            preflop_line=blob["preflop_line"],
            is_icm=blob["is_icm"],
            seat_meta=blob["seat_meta"],
            hand_bb=blob["hand_bb"],
            chip_scale=blob["chip_scale"],
        )

    publisher = BoardPublisher(
        LocalFs(out),
        board=board,
        build_ctx=build_ctx,
        engine=engine_block(extract["metadata"], watcher_id="local-export"),
        cfr_available=False,
    )
    entry = publisher.publish(extract)
    print(f"wrote {out}/piosolutions/{stacks}/{node_name}/{board} "
          f"({len(extract['streets'])} street(s))")
    return entry


def _main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    ex = sub.add_parser("export", help="write manifest + bundles for one artifact")
    ex.add_argument("artifact")
    ex.add_argument("--gametree", required=True, help="the uploaded gametree blob (JSON)")
    ex.add_argument("--out", required=True)
    ex.add_argument("--through", choices=["flop", "turn"], default="turn")
    ex.add_argument("--gametree-path", default=None,
                    help="the blob's ADLS path, to derive stacks / node_name from")
    ex.add_argument("--engine-exe", default=os.getenv("ENGINE_EXE") or os.path.join(
        WATCHER_DIR, "..", "engine", "build", "engine.exe"))
    args = parser.parse_args(argv)
    entry = export_local(args.engine_exe, args.artifact, args.gametree, args.out,
                         through=args.through, gametree_path=args.gametree_path)
    print(json.dumps(entry, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(_main())
