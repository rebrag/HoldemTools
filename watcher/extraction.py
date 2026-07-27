"""Tree-walking extraction of PioSolver .cfr data into per-node JSON docs.

Walks one street of the postflop game tree (BFS from a seed node, stopping at
chance/terminal nodes), extracts strategy + EVs per decision node, aggregates
1326 combos -> 169 hand classes, and builds the v2 solution docs and per-board
manifest consumed by the HoldemTools frontend.
"""

import math
import os
import re
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# =========================
# Node addressing / streets
# =========================
CARD_SEG_RE = re.compile(r"^[2-9TJQKA][hdcs]$")
DECISION_TYPES = ("OOP_DEC", "IP_DEC")
CHANCE_TYPE = "SPLIT_NODE"

# Postflop acting order: earliest alive seat is OOP.
POSTFLOP_ORDER = ["SB", "BB", "UTG", "UTG1", "LJ", "HJ", "CO", "BTN"]


def node_id_to_suffix(node_id: Optional[str], fallback: str = "root") -> str:
    """'r:0:b175' -> 'r.0.b175' (filename/URL-safe)."""
    if not node_id:
        return fallback
    return node_id.replace(":", ".")


def street_of_board(board: Any) -> str:
    n = len(board) if board else 0
    if n >= 5:
        return "river"
    if n == 4:
        return "turn"
    return "flop"


def oop_ip_seats(alive_positions: Optional[List[str]]) -> Tuple[Optional[str], Optional[str]]:
    """Given two alive seats, return (oop, ip) by postflop acting order."""
    if not alive_positions or len(alive_positions) != 2:
        return None, None
    a, b = alive_positions

    def order(seat: str) -> int:
        try:
            return POSTFLOP_ORDER.index(seat)
        except ValueError:
            return len(POSTFLOP_ORDER)

    return (a, b) if order(a) <= order(b) else (b, a)


# =========================
# 1326 -> 169 aggregation
# =========================
RANKS = "AKQJT98765432"
RANK_INDEX = {r: i for i, r in enumerate(RANKS)}  # A highest, 2 lowest


def combo_to_hand_class(hand: str) -> str:
    """'AhKd' -> 'AKo', 'AsAd' -> 'AA', 'AhKh' -> 'AKs'."""
    r1, s1, r2, s2 = hand[0], hand[1], hand[2], hand[3]
    if r1 == r2:
        return r1 + r2
    if RANK_INDEX[r1] < RANK_INDEX[r2]:
        hi, lo = r1, r2
    else:
        hi, lo = r2, r1
    return f"{hi}{lo}{'s' if s1 == s2 else 'o'}"


def hand_class_sort_key(cls: str) -> tuple:
    """Pairs first, then suited, then offsuit, high-card-first."""
    if len(cls) == 2:
        return (0, RANK_INDEX[cls[0]])
    hi, lo, suited_char = cls[0], cls[1], cls[2]
    return (1, RANK_INDEX[hi], RANK_INDEX[lo], 0 if suited_char == "s" else 1)


def sanitize_float(x: Optional[float]) -> Optional[float]:
    """NaN / +/-inf -> None so the JSON stays valid."""
    if x is None:
        return None
    if isinstance(x, (int, float)) and math.isfinite(x):
        return float(x)
    return None


def aggregate_1326_to_169(
    hand_order: List[str], values_1326: List[float]
) -> Dict[str, float]:
    """Aggregate a 1326-length vector into 169 classes by simple average."""
    buckets: Dict[str, List[float]] = defaultdict(list)
    for hand, v in zip(hand_order, values_1326):
        buckets[combo_to_hand_class(hand)].append(v)
    return {cls: sum(vals) / len(vals) for cls, vals in buckets.items() if vals}


def aggregate_strategy_1326_to_169(
    hand_order: List[str], strategy: List[List[float]]
) -> Tuple[List[str], List[List[float]]]:
    """[actions][1326] -> (sorted 169 classes, [actions][169])."""
    if not strategy or not hand_order:
        return [], []

    n_actions = len(strategy)
    n_combos = len(hand_order)
    for row in strategy:
        if len(row) != n_combos:
            log("  [agg] Warning: strategy row length != hand_order length")
            return [], []

    sum_by_class: Dict[str, List[float]] = {}
    count_by_class: Dict[str, int] = defaultdict(int)
    for idx, hand in enumerate(hand_order):
        cls = combo_to_hand_class(hand)
        if cls not in sum_by_class:
            sum_by_class[cls] = [0.0] * n_actions
        for a in range(n_actions):
            sum_by_class[cls][a] += strategy[a][idx]
        count_by_class[cls] += 1

    hand_classes = sorted(sum_by_class.keys(), key=hand_class_sort_key)
    matrix_169 = [
        [
            (sum_by_class[cls][a] / count_by_class[cls]) if count_by_class[cls] else 0.0
            for cls in hand_classes
        ]
        for a in range(n_actions)
    ]
    return hand_classes, matrix_169


# =========================
# Misc parsing helpers
# =========================
def parse_stacks_and_hero_bb(
    stacks_str: Optional[str], node_name: Optional[str]
) -> Tuple[Dict[str, int], Optional[int], Optional[str]]:
    """'25LJ_25HJ_13BB' -> ({'LJ':25,'HJ':25,'BB':13}, hero_bb, hero_pos from _pos=)."""
    stacks_map: Dict[str, int] = {}
    hero_bb: Optional[int] = None
    hero_pos: Optional[str] = None

    if stacks_str:
        for token in stacks_str.split("_"):
            m = re.match(r"(\d+)([A-Za-z0-9]+)", token)
            if m:
                stacks_map[m.group(2)] = int(m.group(1))

    if node_name:
        m2 = re.search(r"_pos=([^_]+)", node_name)
        if m2:
            hero_pos = m2.group(1)

    if hero_pos and stacks_map:
        hero_bb = stacks_map.get(hero_pos)

    return stacks_map, hero_bb, hero_pos


def safe_show_tree_info(solver) -> Dict[str, Any]:
    """Parse raw show_tree_info output ourselves (pyosolver's parser is buggy)."""
    raw = solver._run("show_tree_info")  # type: ignore[attr-defined]
    info: Dict[str, Any] = {}
    if not raw:
        return info
    for line in raw.splitlines():
        line = line.strip()
        if not line or "#" not in line:
            continue
        parts = line.split("#")
        if len(parts) < 3:
            continue
        info[parts[1].strip()] = "#".join(parts[2:]).strip()
    return info


# =========================
# Street walk
# =========================
def walk_street(
    solver,
    seed_id: str = "r:0",
    max_nodes: int = 500,
    ev_cache: Optional[Dict[Tuple[str, str], Optional[List[float]]]] = None,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """BFS one street of the tree from seed_id.

    Decision nodes (OOP_DEC/IP_DEC) are fully extracted (strategy, both EVs,
    per-action child EVs). Chance nodes (SPLIT_NODE) and terminals are recorded
    in the manifest metadata but not entered.

    Returns (views keyed by node_id, nodes_meta keyed by dotted suffix).
    View: {node_id, position, board, pot, flags, actions, children{label: id},
           strategy [a][1326], evs{oop,ip}, action_evs{label: [1326]|None}}
    """
    if ev_cache is None:
        ev_cache = {}

    def get_ev(position: str, node_id: str) -> Optional[List[float]]:
        key = (position, node_id)
        if key not in ev_cache:
            try:
                evs, _matchups = solver.calc_ev(position, node_id)
                ev_cache[key] = list(evs) if evs is not None else None
            except Exception:
                ev_cache[key] = None
        return ev_cache[key]

    views: Dict[str, Dict[str, Any]] = {}
    nodes_meta: Dict[str, Dict[str, Any]] = {}
    queue: deque = deque([seed_id])
    visited: set = set()

    while queue:
        if len(views) >= max_nodes:
            log(f"  [walk] Max node cap ({max_nodes}) hit; stopping walk early")
            break
        nid = queue.popleft()
        if nid in visited:
            continue
        visited.add(nid)
        suffix = node_id_to_suffix(nid)

        try:
            node = solver.show_node(nid)
        except Exception:
            node = None
        if node is None:
            nodes_meta[suffix] = {"type": "terminal"}
            continue

        ntype = node.node_type
        street = street_of_board(node.board)

        if ntype in DECISION_TYPES:
            try:
                children = solver.show_children(nid) or []
            except Exception:
                children = []
            labels = [c.last_action for c in children]
            try:
                strategy = [list(row) for row in solver.show_strategy(nid)]
            except Exception:
                strategy = None

            view: Dict[str, Any] = {
                "node_id": nid,
                "position": "OOP" if ntype == "OOP_DEC" else "IP",
                "node_type": ntype,
                "board": list(node.board),
                "pot": list(node.pot),
                "flags": list(node.flags),
                "street": street,
                "actions": labels,
                "children": {lbl: c.node_id for lbl, c in zip(labels, children)},
                "strategy": strategy,
                "evs": {"oop": get_ev("OOP", nid), "ip": get_ev("IP", nid)},
            }
            # EV of taking each action = actor's EV at that child node.
            actor = view["position"]
            view["action_evs"] = {
                lbl: get_ev(actor, c.node_id) for lbl, c in zip(labels, children)
            }
            views[nid] = view
            nodes_meta[suffix] = {
                "type": ntype,
                "street": street,
                "actions": labels,
                "extracted": True,
            }
            queue.extend(c.node_id for c in children)
        elif ntype == CHANCE_TYPE:
            nodes_meta[suffix] = {
                "type": CHANCE_TYPE,
                "street": street,
                "extracted": False,
            }
        else:
            nodes_meta[suffix] = {"type": "terminal"}

    log(
        f"  [walk] Extracted {len(views)} decision node(s), "
        f"{sum(1 for m in nodes_meta.values() if m.get('type') == CHANCE_TYPE)} chance, "
        f"{sum(1 for m in nodes_meta.values() if m.get('type') == 'terminal')} terminal"
    )
    return views, nodes_meta


def open_solver(pio_dir: str, exe_name: str = "PioSOLVER2-edge.exe"):
    """Spawn a PYOSolver console process (caller owns its lifecycle)."""
    from pyosolver import PYOSolver  # type: ignore[import]

    return PYOSolver(pio_dir, exe_name, debug=False)


def close_solver(solver) -> None:
    """Graceful shutdown: UPI 'exit', short wait, then kill. The vendored
    pyosolver only has a __del__ kill, which is GC-timing dependent."""
    if solver is None:
        return
    proc = getattr(solver, "process", None)
    if proc is None:
        return
    try:
        if proc.poll() is None:
            try:
                proc.stdin.write("exit\n")
                proc.stdin.flush()
            except Exception:
                pass
            try:
                proc.wait(timeout=5.0)
            except Exception:
                proc.kill()
    except Exception:
        pass


def extract_board(
    cfr_path: str,
    pio_dir: str,
    exe_name: str = "PioSOLVER2-edge.exe",
    turn_precompute: bool = True,
    max_nodes_per_street: int = 500,
    seeds: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """Load a .cfr ONCE and walk one or more streets.

    Default: walk the flop street, then (if turn_precompute) every turn street
    reachable from each flop chance node. Pass `seeds` (colon node ids) to walk
    only specific streets instead (on-demand river extraction).

    Returns {hand_order, tree_info, streets: {seed_id: {views, nodes_meta}}}
    or None on failure.
    """
    if not os.path.exists(cfr_path):
        log(f"  [PYOSolver] CFR not found: {cfr_path}")
        return None

    try:
        solver = open_solver(pio_dir, exe_name)
    except Exception as e:
        log(f"  [PYOSolver] Not available: {e}")
        return None

    board_t0 = time.perf_counter()
    try:
        t0 = time.perf_counter()
        solver.load_tree(cfr_path)
        log(f"  [board] load_tree in {time.perf_counter() - t0:.1f}s")
        tree_info = safe_show_tree_info(solver)
        hand_order = solver.show_hand_order()

        # Chips behind each player at flop start; the frontend uses this to
        # label bets that put a player all-in with the ALLIN color.
        try:
            effective_stack = int(float(solver._run("show_effective_stack").strip()))
        except Exception:
            effective_stack = None

        ev_cache: Dict[Tuple[str, str], Optional[List[float]]] = {}
        streets: Dict[str, Dict[str, Any]] = {}

        def walk(seed_id: str) -> None:
            t = time.perf_counter()
            views, nodes_meta = walk_street(
                solver, seed_id=seed_id, max_nodes=max_nodes_per_street, ev_cache=ev_cache
            )
            streets[seed_id] = {"views": views, "nodes_meta": nodes_meta}
            log(
                f"  [board] street {seed_id}: {len(views)} decision node(s) "
                f"in {time.perf_counter() - t:.1f}s"
            )

        if seeds is not None:
            for seed_id in seeds:
                walk(seed_id)
        else:
            walk("r:0")
            flop_meta = streets["r:0"]["nodes_meta"]
            chance_suffixes = [
                s for s, m in flop_meta.items() if m.get("type") == CHANCE_TYPE
            ]
            if turn_precompute:
                for chance_suffix in chance_suffixes:
                    chance_id = chance_suffix.replace(".", ":")
                    try:
                        children = solver.show_children(chance_id) or []
                    except Exception:
                        children = []
                    for child in children:
                        walk(child.node_id)

        log(
            f"  [board] extracted {len(streets)} street(s), "
            f"{sum(len(s['views']) for s in streets.values())} node(s) total "
            f"in {time.perf_counter() - board_t0:.1f}s"
        )
        return {
            "hand_order": hand_order,
            "tree_info": tree_info,
            "effective_stack": effective_stack,
            "streets": streets,
        }
    finally:
        close_solver(solver)


# =========================
# Board context + doc/manifest builders
# =========================
def parse_gametree_path(
    src_gametree_path: str, base_prefix: str
) -> Tuple[Optional[str], Optional[str], Tuple[Optional[str], Optional[str], Optional[str]]]:
    """gametrees/yyyy/mm/dd/uid/folder=STACKS/NAME.json -> (stacks, node_name, (y,m,d))."""
    rel = src_gametree_path
    if rel.startswith(base_prefix + "/"):
        rel = rel[len(base_prefix) + 1 :]
    parts = rel.split("/")
    yyyy, mm, dd = (parts[0], parts[1], parts[2]) if len(parts) >= 3 else (None, None, None)

    stacks = None
    for p in parts:
        if p.startswith("folder="):
            stacks = p[len("folder=") :]
            break

    node_file = parts[-1] if parts else ""
    node_name = node_file[:-5] if node_file.endswith(".json") else node_file
    return stacks, node_name, (yyyy, mm, dd)


def build_board_context(
    board: str,
    cfr_file: str,
    src_gametree_path: str,
    base_prefix: str,
    stats: Dict[str, Optional[float]],
    tree_info: Dict[str, Any],
    alive_positions: Optional[List[str]],
    acting_pos: Optional[str],
    preflop_line: Optional[List[str]] = None,
    is_icm: Optional[bool] = None,
) -> Dict[str, Any]:
    """Shared per-board fields used by every node doc and the manifest."""
    stacks, node_name, (yyyy, mm, dd) = parse_gametree_path(src_gametree_path, base_prefix)

    stacks_map, hero_bb, hero_pos = parse_stacks_and_hero_bb(stacks, node_name)
    if acting_pos:
        hero_pos = acting_pos

    alive_clean = [str(p) for p in alive_positions if p] if alive_positions else None
    villain_pos = None
    if alive_clean and len(alive_clean) == 2:
        if hero_pos and hero_pos in alive_clean:
            a, b = alive_clean
            villain_pos = b if a == hero_pos else a
        elif not hero_pos:
            hero_pos, villain_pos = alive_clean[0], alive_clean[1]
    oop_seat, ip_seat = oop_ip_seats(alive_clean)

    if is_icm is None and node_name:
        is_icm = "_icm=1" in node_name

    return {
        "board": board,
        "cfr_file": cfr_file,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "stacks": stacks,
        "node_name": node_name,
        "stacks_map": stacks_map,
        "hero_bb": hero_bb,
        "hero_pos": hero_pos,
        "villain_pos": villain_pos,
        "alive_positions": alive_clean,
        "oop_seat": oop_seat,
        "ip_seat": ip_seat,
        "gametree_path": src_gametree_path,
        "date": {"year": yyyy, "month": mm, "day": dd},
        "preflop_line": preflop_line,
        "is_icm": bool(is_icm),
        "summary": {
            "ev_oop": sanitize_float(stats.get("ev_oop")),
            "ev_ip": sanitize_float(stats.get("ev_ip")),
            "exploitable": sanitize_float(stats.get("exploitable")),
        },
        "tree_info": tree_info,
    }


def context_from_manifest(
    manifest: Dict[str, Any],
    cfr_file: str,
    tree_info: Dict[str, Any],
    base_prefix: str = "gametrees",
) -> Dict[str, Any]:
    """Rebuild a board context from a downloaded manifest (used by on-demand
    extraction and reextract, where the original solve stats are gone)."""
    pre = manifest.get("preflop") or {}
    summary = manifest.get("summary") or {}
    ctx = build_board_context(
        board=manifest["board"],
        cfr_file=cfr_file,
        src_gametree_path=pre.get("gametree_path") or "",
        base_prefix=base_prefix,
        stats={
            "ev_oop": summary.get("ev_oop"),
            "ev_ip": summary.get("ev_ip"),
            "exploitable": summary.get("exploitable"),
        },
        tree_info=tree_info,
        alive_positions=pre.get("alive_positions"),
        acting_pos=pre.get("acting_pos"),
        preflop_line=pre.get("line"),
        is_icm=pre.get("icm"),
    )
    ctx["stacks"] = manifest.get("stacks") or ctx["stacks"]
    ctx["node_name"] = manifest.get("node_name") or ctx["node_name"]
    ctx["pot_chips"] = manifest.get("pot_chips")
    return ctx


def build_node_doc(
    view: Dict[str, Any],
    ctx: Dict[str, Any],
    hand_order: List[str],
) -> Dict[str, Any]:
    """Build one v2 per-node solution doc (superset of the legacy shape)."""
    node_id = view["node_id"]
    node_suffix = node_id_to_suffix(node_id)
    parent_id = ":".join(node_id.split(":")[:-1]) if ":" in node_id and node_id != "r:0" else None

    node_actions: List[str] = view.get("actions") or []
    strategy = view.get("strategy")
    evs = view.get("evs") or {}
    action_evs_1326: Dict[str, Optional[List[float]]] = view.get("action_evs") or {}

    hand_classes_169: List[str] = []
    strat_matrix_169: List[List[float]] = []
    ev_oop_169: Optional[List[Optional[float]]] = None
    ev_ip_169: Optional[List[Optional[float]]] = None
    action_ev_169: Dict[str, Optional[List[Optional[float]]]] = {}

    can_aggregate = (
        isinstance(hand_order, list)
        and len(hand_order) == 1326
        and isinstance(strategy, list)
        and strategy
    )
    if can_aggregate:
        hand_classes_169, strat_matrix_169 = aggregate_strategy_1326_to_169(
            hand_order, strategy
        )

        def agg169(vec: Optional[List[float]]) -> Optional[List[Optional[float]]]:
            if not isinstance(vec, list) or len(vec) != 1326:
                return None
            m = aggregate_1326_to_169(hand_order, vec)
            return [sanitize_float(m.get(cls)) for cls in hand_classes_169]

        ev_oop_169 = agg169(evs.get("oop"))
        ev_ip_169 = agg169(evs.get("ip"))
        for lbl in node_actions:
            action_ev_169[lbl] = agg169(action_evs_1326.get(lbl))
    else:
        log(f"  [doc] {node_id}: no 1326 aggregation available; doc will be sparse")

    node_position = view.get("position") or ""
    hero_node_ev = ev_ip_169 if node_position == "IP" else ev_oop_169

    # actions payload: [freq, EV of taking this action]; falls back to the
    # node-level hero EV when the child EV is unavailable (e.g. fold terminal).
    actions_payload: Dict[str, Dict[str, List[Optional[float]]]] = {}
    if hand_classes_169 and strat_matrix_169:
        for a_idx, lbl in enumerate(node_actions):
            row = strat_matrix_169[a_idx] if a_idx < len(strat_matrix_169) else []
            per_action = action_ev_169.get(lbl)
            hand_map: Dict[str, List[Optional[float]]] = {}
            for idx, cls in enumerate(hand_classes_169):
                freq = row[idx] if idx < len(row) else 0.0
                ev = None
                if per_action and idx < len(per_action):
                    ev = per_action[idx]
                if ev is None and hero_node_ev and idx < len(hero_node_ev):
                    ev = hero_node_ev[idx]
                hand_map[cls] = [float(freq), sanitize_float(ev)]
            actions_payload[lbl] = hand_map

    # Slim schema-3 doc: board-level context (tree_info/source/summary/...)
    # lives once in the manifest, not in every node.
    return {
        "schema": 3,
        "board": ctx["board"],
        "position": node_position,
        "hero_pos": ctx["hero_pos"],
        "villain_pos": ctx["villain_pos"],
        "alive_positions": ctx["alive_positions"],
        "bb": ctx["hero_bb"],
        "street": view.get("street"),
        "pio_node_type": view.get("node_type"),
        "pot": view.get("pot"),
        "node_id": node_id,
        "node_suffix": node_suffix,
        "parent_id": parent_id,
        "children": view.get("children") or {},
        "actions": actions_payload,
        "root_169": {
            "hand_classes": hand_classes_169,
            "strategy": {"actions": node_actions, "matrix": strat_matrix_169},
            "ev": {"oop": ev_oop_169, "ip": ev_ip_169},
        },
    }


def build_street_bundle(
    seed_id: str,
    views: Dict[str, Dict[str, Any]],
    nodes_meta: Dict[str, Dict[str, Any]],
    ctx: Dict[str, Any],
    hand_order: List[str],
) -> Dict[str, Any]:
    """One gzippable blob per street: all its decision-node docs + the walk
    metadata (decision/chance/terminal) the frontend needs for navigation."""
    seed_suffix = node_id_to_suffix(seed_id)
    seed_view = views.get(seed_id) or {}
    board_cards = seed_view.get("board") or []
    street = seed_view.get("street") or street_of_board(board_cards)

    nodes = {
        node_id_to_suffix(nid): build_node_doc(view, ctx, hand_order)
        for nid, view in views.items()
    }

    return {
        "schema": 3,
        "kind": "street_bundle",
        "seed": seed_id,
        "seed_suffix": seed_suffix,
        "street": street,
        "board": "".join(board_cards) if board_cards else ctx["board"],
        "stacks": ctx["stacks"],
        "node_name": ctx["node_name"],
        "created_utc": ctx["created_utc"],
        "nodes": nodes,
        "meta": nodes_meta,
    }


def street_entry(
    seed_suffix: str, street: str, node_count: int, extracted: bool = True
) -> Dict[str, Any]:
    return {
        "street": street,
        "file": f"streets/{seed_suffix}.json.gz",
        "extracted": extracted,
        "node_count": node_count,
        "updated_utc": datetime.now(timezone.utc).isoformat(),
    }


def build_manifest(
    ctx: Dict[str, Any],
    streets_map: Dict[str, Dict[str, Any]],
    cfr_size_bytes: Optional[int],
    existing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build (or update) the per-board manifest. Later extractions merge their
    street entries into an existing manifest's streets map. Legal dealt cards
    at any chance node are derivable (52 minus board), so no card lists here."""
    streets: Dict[str, Dict[str, Any]] = {}
    if existing and isinstance(existing.get("streets"), dict):
        streets.update(existing["streets"])
    streets.update(streets_map)

    return {
        "schema": 3,
        "board": ctx["board"],
        "stacks": ctx["stacks"],
        "node_name": ctx["node_name"],
        "created_utc": (existing or {}).get("created_utc") or ctx["created_utc"],
        "updated_utc": datetime.now(timezone.utc).isoformat(),
        "preflop": {
            "folder": ctx["stacks"],
            "line": ctx.get("preflop_line"),
            "alive_positions": ctx["alive_positions"],
            "acting_pos": ctx["hero_pos"],
            "icm": ctx["is_icm"],
            "gametree_path": ctx["gametree_path"],
        },
        "seats": {"oop": ctx["oop_seat"], "ip": ctx["ip_seat"]},
        "stacks_map": ctx["stacks_map"],
        "pot_chips": ctx.get("pot_chips"),
        "effective_stack_chips": ctx.get("effective_stack_chips")
        or (existing or {}).get("effective_stack_chips"),
        "summary": ctx["summary"],
        "tree_info": ctx.get("tree_info"),
        "cfr": {
            "file": ctx["cfr_file"],
            "available": True,
            "size_bytes": cfr_size_bytes,
        },
        "streets": streets,
    }
