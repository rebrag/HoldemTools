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


# Manifest / street-bundle / node-doc schema. 4 adds the per-combo (1326)
# blocks, per-seat range weights + equities, and node reach frequency; 3 docs
# stay readable, they just have no `combos` block for the hand breakdown.
SCHEMA_VERSION = 4

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


def weighted_1326_to_169(
    hand_order: List[str],
    values_1326: List[float],
    weights_1326: Optional[List[float]],
) -> Dict[str, float]:
    """Range-weighted class average.

    The plain mean above treats a combo the solver never holds as equal to one
    it always holds, which skews any class containing a blocked or partially
    weighted combo. Falls back to the plain mean when no weights are available
    or a class has no weight at all.
    """
    if not weights_1326 or len(weights_1326) != len(hand_order):
        return aggregate_1326_to_169(hand_order, values_1326)

    num: Dict[str, float] = defaultdict(float)
    den: Dict[str, float] = defaultdict(float)
    plain: Dict[str, List[float]] = defaultdict(list)
    for hand, v, w in zip(hand_order, values_1326, weights_1326):
        if v is None or not math.isfinite(v):
            continue
        cls = combo_to_hand_class(hand)
        plain[cls].append(v)
        if w and w > 0:
            num[cls] += v * w
            den[cls] += w

    out: Dict[str, float] = {}
    for cls, vals in plain.items():
        out[cls] = num[cls] / den[cls] if den.get(cls) else sum(vals) / len(vals)
    return out


# =========================
# Per-combo (1326) payloads
# =========================
# Fixed-point scales for the per-combo arrays. Strategy/weight/equity are
# fractions stored per mille; EV and matchups are chips stored per cent. JSON
# ints at this precision are both smaller and more gzip-friendly than floats,
# and the precision is far finer than anything the UI renders.
COMBO_SCALE = {"w": 1000, "eq": 1000, "ev": 100, "mu": 100, "s": 1000}


def quantize(value: Optional[float], scale: int) -> Optional[int]:
    """Fixed-point encode one value; non-finite (Pio emits nan) -> None."""
    if value is None or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return int(round(value * scale))


def _pick(vec: Optional[List[float]], idx: List[int], scale: int) -> Optional[List[Optional[int]]]:
    if not vec:
        return None
    return [quantize(vec[i] if i < len(vec) else None, scale) for i in idx]


def build_seat_combo_block(seat_data: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Per-combo weight / equity / EV / matchups for one seat at one node.

    Only combos the seat actually holds are emitted, which drops roughly half
    the 1326 rows on a typical range and keeps the index list the single source
    of truth for every parallel array. The filter runs on the *quantized*
    weight, so a combo is emitted only if the encoding can represent it as
    non-zero - otherwise a combo weighted 0.0001 would ship as weight 0 and
    read downstream as out of range.
    """
    if not seat_data:
        return None
    weights = seat_data.get("range")
    if not weights:
        return None

    idx = [
        i
        for i, w in enumerate(weights)
        if w and w > 0 and (quantize(w, COMBO_SCALE["w"]) or 0) >= 1
    ]
    if not idx:
        return None

    return {
        "idx": idx,
        "w": _pick(weights, idx, COMBO_SCALE["w"]),
        "eq": _pick(seat_data.get("equity"), idx, COMBO_SCALE["eq"]),
        "ev": _pick(seat_data.get("ev"), idx, COMBO_SCALE["ev"]),
        "mu": _pick(seat_data.get("matchups"), idx, COMBO_SCALE["mu"]),
    }


def seat_summary(seat_data: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Range-wide EV / equity / combo count for one seat at one node.

    `combos` is the weighted sum of the range, so a partially-weighted preflop
    range reports a fractional count (e.g. 333.5) rather than a raw combo tally.
    """
    if not seat_data:
        return None
    weights = seat_data.get("range")
    if not weights:
        return None

    total_w = sum(w for w in weights if w and w > 0)
    if total_w <= 0:
        return None

    def wmean(vec: Optional[List[float]]) -> Optional[float]:
        if not vec:
            return None
        num = den = 0.0
        for w, v in zip(weights, vec):
            if w and w > 0 and v is not None and math.isfinite(v):
                num += w * v
                den += w
        return num / den if den > 0 else None

    return {
        "combos": sanitize_float(total_w),
        "equity": sanitize_float(seat_data.get("equity_total") or wmean(seat_data.get("equity"))),
        "ev": sanitize_float(wmean(seat_data.get("ev"))),
    }


def aggregate_strategy_1326_to_169(
    hand_order: List[str],
    strategy: List[List[float]],
    weights_1326: Optional[List[float]] = None,
) -> Tuple[List[str], List[List[float]]]:
    """[actions][1326] -> (sorted 169 classes, [actions][169]).

    Weighted by the actor's reach range when available. Pio reports a strategy
    for every one of the 1326 combos, including ones the actor cannot hold at
    this node (board blockers, or simply not in the preflop range); those rows
    are arbitrary, so averaging them in drags the class value away from the mix
    the player actually plays. Falls back to a plain mean without weights.
    """
    if not strategy or not hand_order:
        return [], []

    n_actions = len(strategy)
    n_combos = len(hand_order)
    for row in strategy:
        if len(row) != n_combos:
            log("  [agg] Warning: strategy row length != hand_order length")
            return [], []

    use_weights = bool(weights_1326) and len(weights_1326) == n_combos

    sum_by_class: Dict[str, List[float]] = {}
    weight_by_class: Dict[str, float] = defaultdict(float)
    # Plain (unweighted) totals, used for classes with no reach weight at all.
    plain_by_class: Dict[str, List[float]] = {}
    count_by_class: Dict[str, int] = defaultdict(int)

    for idx, hand in enumerate(hand_order):
        cls = combo_to_hand_class(hand)
        if cls not in sum_by_class:
            sum_by_class[cls] = [0.0] * n_actions
            plain_by_class[cls] = [0.0] * n_actions
        w = float(weights_1326[idx]) if use_weights else 1.0
        for a in range(n_actions):
            plain_by_class[cls][a] += strategy[a][idx]
            if w > 0:
                sum_by_class[cls][a] += strategy[a][idx] * w
        if w > 0:
            weight_by_class[cls] += w
        count_by_class[cls] += 1

    hand_classes = sorted(sum_by_class.keys(), key=hand_class_sort_key)

    def cell(cls: str, a: int) -> float:
        wsum = weight_by_class.get(cls, 0.0)
        if wsum > 0:
            return sum_by_class[cls][a] / wsum
        n = count_by_class[cls]
        return (plain_by_class[cls][a] / n) if n else 0.0

    matrix_169 = [[cell(cls, a) for cls in hand_classes] for a in range(n_actions)]
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
    range_cache: Dict[Tuple[str, str], Optional[List[float]]] = {}
    eq_cache: Dict[Tuple[str, str], Tuple[Optional[List[float]], Optional[List[float]], Optional[float]]] = {}

    def get_ev(position: str, node_id: str) -> Optional[List[float]]:
        key = (position, node_id)
        if key not in ev_cache:
            try:
                evs, _matchups = solver.calc_ev(position, node_id)
                ev_cache[key] = list(evs) if evs is not None else None
            except Exception:
                ev_cache[key] = None
        return ev_cache[key]

    def get_range(position: str, node_id: str) -> Optional[List[float]]:
        """Reach weights (1326) for `position` at this node."""
        key = (position, node_id)
        if key not in range_cache:
            try:
                rng = solver.show_range(position, node_id)
                range_cache[key] = list(rng) if rng else None
            except Exception:
                range_cache[key] = None
        return range_cache[key]

    def get_equity(
        position: str, node_id: str
    ) -> Tuple[Optional[List[float]], Optional[List[float]], Optional[float]]:
        """calc_eq_node -> (equity[1326], matchups[1326], range-wide equity).

        Pio prints these as three lines; hands outside the range come back as
        `nan` and are dropped downstream by the weight filter.
        """
        key = (position, node_id)
        if key not in eq_cache:
            try:
                raw = solver._run("calc_eq_node", position, node_id)  # type: ignore[attr-defined]
                lines = [ln for ln in (raw or "").split("\n") if ln.strip()]
                if len(lines) < 2 or "ERROR" in (raw or ""):
                    eq_cache[key] = (None, None, None)
                else:
                    to_floats = lambda ln: [  # noqa: E731
                        float(tok) if tok.lower() != "nan" else float("nan")
                        for tok in ln.split()
                    ]
                    equity = to_floats(lines[0])
                    matchups = to_floats(lines[1])
                    total = float(lines[2].strip()) if len(lines) > 2 else None
                    eq_cache[key] = (equity, matchups, sanitize_float(total))
            except Exception:
                eq_cache[key] = (None, None, None)
        return eq_cache[key]

    def seat_block(position: str, node_id: str) -> Dict[str, Any]:
        equity, matchups, equity_total = get_equity(position, node_id)
        return {
            "range": get_range(position, node_id),
            "equity": equity,
            "matchups": matchups,
            "equity_total": equity_total,
            "ev": get_ev(position, node_id),
        }

    def node_freq(node_id: str) -> Optional[float]:
        """How often this node is reached across the whole tree."""
        try:
            return sanitize_float(float(solver._run("calc_global_freq", node_id).strip()))  # type: ignore[attr-defined]
        except Exception:
            return None

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
                # Per-seat reach weights, equities and matchups: what makes the
                # per-combo breakdown and the two-seat stats panel possible.
                "seats": {
                    "oop": seat_block("OOP", nid),
                    "ip": seat_block("IP", nid),
                },
                "global_freq": node_freq(nid),
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


RESULTS_KEYS = {
    "EV OOP": "ev_oop",
    "EV IP": "ev_ip",
    "OOP's MES": "mes_oop",
    "IP's MES": "mes_ip",
    "Exploitable for": "exploitable",
}


def read_solve_results(solver) -> Dict[str, Optional[float]]:
    """Parse `calc_results` into solve-quality stats.

    Gives the same EVs the solve log reports plus each side's maximally
    exploitative value, so how far the pair sits above the solved EVs is a
    direct read on convergence. Available from the .cfr alone, so re-extraction
    recovers it for boards solved before this existed.
    """
    out: Dict[str, Optional[float]] = {v: None for v in RESULTS_KEYS.values()}
    try:
        raw = solver._run("calc_results")  # type: ignore[attr-defined]
    except Exception:
        return out
    if not raw or "ERROR" in raw:
        return out
    for line in raw.splitlines():
        if ":" not in line:
            continue
        label, _, value = line.partition(":")
        key = RESULTS_KEYS.get(label.strip())
        if key:
            try:
                out[key] = sanitize_float(float(value.strip()))
            except ValueError:
                pass
    return out


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
    extra_seeds: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """Load a .cfr ONCE and walk one or more streets.

    Default: walk the flop street, then (if turn_precompute) every turn street
    reachable from each flop chance node. Pass `seeds` (colon node ids) to walk
    only specific streets instead (on-demand river extraction).

    `extra_seeds` are walked in addition to the default set. Re-extraction uses
    it for river streets: those only exist because someone asked for them, so
    they are not reachable from the default flop+turn sweep and would otherwise
    keep whatever schema they were first written with. Loading the .cfr is the
    expensive part, so folding them into this one pass is much cheaper than a
    second call.

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
            if seed_id in streets:
                return
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

        for seed_id in extra_seeds or []:
            walk(seed_id)

        log(
            f"  [board] extracted {len(streets)} street(s), "
            f"{sum(len(s['views']) for s in streets.values())} node(s) total "
            f"in {time.perf_counter() - board_t0:.1f}s"
        )
        return {
            "hand_order": hand_order,
            "tree_info": tree_info,
            "effective_stack": effective_stack,
            "results": read_solve_results(solver),
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


def _normalize_seat_meta(seats: Any) -> Optional[List[Dict[str, Any]]]:
    """Accept the upload's Seats list (PascalCase from the C# API, snake_case
    from a manifest round-trip) and normalize to the manifest shape.
    stack_chips is measured at the flop, in Pio chips (bb * 100)."""
    if not isinstance(seats, list):
        return None
    out: List[Dict[str, Any]] = []
    for s in seats:
        if not isinstance(s, dict):
            continue
        pos = s.get("pos") or s.get("Pos")
        if not pos:
            continue
        cards = s.get("cards", s.get("Cards"))
        out.append(
            {
                "pos": str(pos),
                "name": str(s.get("name") or s.get("Name") or ""),
                "stack_chips": s.get("stack_chips", s.get("StackChips")),
                "folded": bool(s.get("folded", s.get("Folded", False))),
                "hero": bool(s.get("hero", s.get("Hero", False))),
                "cards": [str(c) for c in cards] if isinstance(cards, list) else None,
            }
        )
    return out or None


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
    seat_meta: Optional[List[Dict[str, Any]]] = None,
    hand_bb: Optional[float] = None,
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
        "seat_meta": _normalize_seat_meta(seat_meta),
        # The hand's big blind in real chips (hand-history uploads only).
        "hand_bb": hand_bb if isinstance(hand_bb, (int, float)) else None,
        "summary": {
            "ev_oop": sanitize_float(stats.get("ev_oop")),
            "ev_ip": sanitize_float(stats.get("ev_ip")),
            "exploitable": sanitize_float(stats.get("exploitable")),
            # Each side's maximally exploitative value: the gap to the solved
            # EV above is what "exploitable for" is measuring.
            "mes_oop": sanitize_float(stats.get("mes_oop")),
            "mes_ip": sanitize_float(stats.get("mes_ip")),
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
            "mes_oop": summary.get("mes_oop"),
            "mes_ip": summary.get("mes_ip"),
        },
        tree_info=tree_info,
        alive_positions=pre.get("alive_positions"),
        acting_pos=pre.get("acting_pos"),
        preflop_line=pre.get("line"),
        is_icm=pre.get("icm"),
        seat_meta=manifest.get("seat_meta"),
        hand_bb=manifest.get("hand_bb"),
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
    seats: Dict[str, Any] = view.get("seats") or {}
    node_position = view.get("position") or ""
    actor_key = "ip" if node_position == "IP" else "oop"
    actor_weights = (seats.get(actor_key) or {}).get("range")

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
            hand_order, strategy, actor_weights
        )

        def agg169(
            vec: Optional[List[float]], weights: Optional[List[float]] = None
        ) -> Optional[List[Optional[float]]]:
            if not isinstance(vec, list) or len(vec) != 1326:
                return None
            m = weighted_1326_to_169(hand_order, vec, weights or actor_weights)
            return [sanitize_float(m.get(cls)) for cls in hand_classes_169]

        oop_weights = (seats.get("oop") or {}).get("range")
        ip_weights = (seats.get("ip") or {}).get("range")
        ev_oop_169 = agg169(evs.get("oop"), oop_weights)
        ev_ip_169 = agg169(evs.get("ip"), ip_weights)
        for lbl in node_actions:
            action_ev_169[lbl] = agg169(action_evs_1326.get(lbl))
    else:
        log(f"  [doc] {node_id}: no 1326 aggregation available; doc will be sparse")

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

    # Per-combo detail. The 169 blocks above are class averages, which is all
    # the matrix needs; the hand breakdown needs the actual per-combo strategy,
    # so it lives here indexed against the bundle's shared hand_order.
    combos_block: Optional[Dict[str, Any]] = None
    oop_combos = build_seat_combo_block(seats.get("oop"))
    ip_combos = build_seat_combo_block(seats.get("ip"))
    actor_combos = ip_combos if actor_key == "ip" else oop_combos
    if actor_combos:
        actor_idx = actor_combos["idx"]
        strat_rows: List[Optional[List[Optional[int]]]] = []
        action_ev_rows: List[Optional[List[Optional[int]]]] = []
        for a_idx, lbl in enumerate(node_actions):
            row = strategy[a_idx] if strategy and a_idx < len(strategy) else None
            strat_rows.append(_pick(row, actor_idx, COMBO_SCALE["s"]))
            action_ev_rows.append(
                _pick(action_evs_1326.get(lbl), actor_idx, COMBO_SCALE["ev"])
            )
        combos_block = {
            "actor": actor_key,
            "actions": node_actions,
            "scale": COMBO_SCALE,
            "oop": oop_combos,
            "ip": ip_combos,
            # [action][position within the actor's idx list]
            "strategy": strat_rows,
            "action_ev": action_ev_rows,
        }

    # Range-wide EV / equity / combo count per seat, for the node header panel.
    seat_stats = {
        "oop": seat_summary(seats.get("oop")),
        "ip": seat_summary(seats.get("ip")),
    }

    # Slim doc: board-level context (tree_info/source/summary/...) lives once
    # in the manifest, not in every node.
    return {
        "schema": SCHEMA_VERSION,
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
        "combos": combos_block,
        "seat_stats": seat_stats,
        "global_freq": sanitize_float(view.get("global_freq")),
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
        "schema": SCHEMA_VERSION,
        "kind": "street_bundle",
        # Pio's 1326 combo order, stored once per bundle: every node's per-combo
        # arrays are indexed against it rather than repeating combo names.
        "hand_order": list(hand_order) if hand_order else [],
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
        "schema": SCHEMA_VERSION,
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
        # Optional (hand-history uploads): real player names/stacks/cards and
        # the hand's big blind for the viewer's chip display. Preserved from
        # the existing manifest on re-extracts.
        "seat_meta": ctx.get("seat_meta") or (existing or {}).get("seat_meta"),
        "hand_bb": ctx.get("hand_bb") or (existing or {}).get("hand_bb"),
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
