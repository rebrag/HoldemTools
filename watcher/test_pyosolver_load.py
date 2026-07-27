# test_pyosolver_load.py

import os
from typing import Any, Dict, List, Optional

from pyosolver import PYOSolver  # type: ignore[import]

# Adjust these if needed
PIO_DIR = r"C:\PioSOLVER"
CFR_PATH = r"C:\PioSOLVER\Solved\JdQc4h.cfr"  # your solved CFR


def safe_show_tree_info(solver: PYOSolver) -> Dict[str, Any]:
    """
    Safer version of show_tree_info that bypasses the buggy implementation
    in pyosolver and parses the raw output from `show_tree_info` ourselves.
    """
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
            # Not in the expected "x#Key#Value" format; skip
            continue
        _, key, value = parts[0], parts[1], "#".join(parts[2:])
        info[key.strip()] = value.strip()

    return info


def extract_root_and_check_summary(cfr_path: str) -> Dict[str, Any]:
    """
    Use PYOSolver to extract:
      - tree_info (EV OOP, EV IP, Exploitable, etc. as strings)
      - hand_order (1326 combo order)
      - root node ("r:0") ranges + strategy
      - node after root -> check (if any) ranges + strategy
    Returns a JSON-serializable dict.
    """
    solver = PYOSolver(PIO_DIR, "PioSOLVER2-edge.exe", debug=False)

    # Load the CFR
    solver.load_tree(cfr_path)

    # Robust tree info
    tree_info = safe_show_tree_info(solver)       # dict[str, str]
    hand_order = solver.show_hand_order()         # list[str]

    # Root node
    root_id = "r:0"
    root_node = solver.show_node(root_id)
    root_pos = root_node.get_position() if root_node is not None else None

    def safe_range(position: str, node_id: str) -> Optional[List[float]]:
        """Wrap show_range so we always return JSON-safe values."""
        r = solver.show_range(position, node_id)
        if r is None:
            return None
        return list(r)

    def safe_strategy(node_id: str) -> Optional[List[List[float]]]:
        """Wrap show_strategy; if it errors, return None."""
        try:
            s = solver.show_strategy(node_id)
            return [list(row) for row in s]
        except Exception:
            return None

    root_view: Dict[str, Any] = {
        "node_id": root_id,
        "position": root_pos,  # "OOP", "IP", or None
        "board": list(root_node.board) if root_node is not None else None,
        "pot": list(root_node.pot) if root_node is not None else None,
        "flags": list(root_node.flags) if root_node is not None else None,
        "ranges": {
            "oop": safe_range("OOP", root_id),
            "ip": safe_range("IP", root_id),
        },
        "strategy": safe_strategy(root_id),
    }

    # Children from root
    children = solver.show_children(root_id) or []
    actions = solver.show_children_actions(root_id) or []

    # Find a "check" child (x / check / c)
    check_idx: Optional[int] = None
    for i, act in enumerate(actions):
        a = (act or "").lower().strip()
        if a in ("x", "check", "c"):
            check_idx = i
            break

    check_view: Optional[Dict[str, Any]] = None
    if check_idx is not None and 0 <= check_idx < len(children):
        child = children[check_idx]
        cid = child.node_id
        check_view = {
            "node_id": cid,
            "position": child.get_position(),
            "board": list(child.board),
            "pot": list(child.pot),
            "flags": list(child.flags),
            "action_label": actions[check_idx],
            "ranges": {
                "oop": safe_range("OOP", cid),
                "ip": safe_range("IP", cid),
            },
            "strategy": safe_strategy(cid),
        }

    summary: Dict[str, Any] = {
        "tree_info": tree_info,
        "hand_order": hand_order,
        "root": root_view,
        "root_check": check_view,
    }
    return summary


def main() -> None:
    if not os.path.exists(CFR_PATH):
        print("CFR file not found:", CFR_PATH)
        return

    print("Using CFR:", CFR_PATH)
    res = extract_root_and_check_summary(CFR_PATH)

    # High-level info
    print("\n=== Tree Info (from show_tree_info) ===")
    ti = res["tree_info"]
    if not ti:
        print("(empty or not parsed)")
    else:
        for k, v in ti.items():
            print(f"{k}: {v}")

    # Hand ordering
    hand_order = res["hand_order"]
    print(f"\n=== Hand Order ===")
    print(f"Total combos: {len(hand_order)}")
    print("All combos (in solver order):")
    print(hand_order)

    root = res["root"]
    print("\n=== Root Node (r:0) ===")
    print("Position:", root["position"])
    print("Board:", root["board"])
    print("Pot:", root["pot"])
    print("Flags:", root["flags"])

    root_ranges = root["ranges"]
    print("\nRoot OOP range length:", len(root_ranges["oop"]) if root_ranges["oop"] else None)
    print("Root IP range length:", len(root_ranges["ip"]) if root_ranges["ip"] else None)

    root_strategy = root["strategy"]
    if root_strategy is not None and len(root_strategy) > 0:
        print(
            "Root strategy shape: actions =",
            len(root_strategy),
            ", combos per action =",
            len(root_strategy[0]),
        )
        print("Root first action – full combo strategy vector:")
        print(root_strategy[0])  # all 1326 entries
    else:
        print("Root strategy: None or empty")

    rc = res["root_check"]
    print("\n=== Node after root -> check (if exists) ===")
    if rc is None:
        print("No 'check' child from root.")
    else:
        print("Node id:", rc["node_id"])
        print("Action label:", rc["action_label"])
        print("Position:", rc["position"])
        print("Board:", rc["board"])
        print("Pot:", rc["pot"])
        print("Flags:", rc["flags"])

        rcr = rc["ranges"]
        print("Check-node OOP range length:", len(rcr["oop"]) if rcr["oop"] else None)
        print("Check-node IP range length:", len(rcr["ip"]) if rcr["ip"] else None)

        rc_strategy = rc["strategy"]
        if rc_strategy is not None and len(rc_strategy) > 0:
            print(
                "Check-node strategy shape: actions =",
                len(rc_strategy),
                ", combos per action =",
                len(rc_strategy[0]),
            )
            print("Check-node first action - full combo strategy vector:")
            print(rc_strategy[0])  # all 1326 entries
        else:
            print("Check-node strategy: None or empty")


if __name__ == "__main__":
    main()
