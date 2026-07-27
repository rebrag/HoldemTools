# pio_headless_from_block.py (drop-in)
import os, re, subprocess, time
from typing import Dict, List, Tuple, Optional, Set, NamedTuple
from pathlib import Path

PIO_EXE         = os.getenv("PIO_EXE", r"C:\PioSOLVER\PioSOLVER2-edge.exe")
OUT_DIR         = os.getenv("PIO_OUT_DIR", r"C:\PioSaves")
THREADS         = int(os.getenv("PIO_THREADS", "6"))
ACCURACY_CHIPS  = float(os.getenv("PIO_ACCURACY_CHIPS", "0.25"))
INFOFREQ        = int(os.getenv("PIO_INFOFREQ", "50"))
EXPORT_TXT      = os.getenv("PIO_EXPORT_TXT", "0") == "1"

TREE_LOG_PATH   = str(Path(OUT_DIR) / "tree_build_attempt.txt")

# ---------------- basic I/O helpers ----------------

def _send(proc: subprocess.Popen, cmd: str):
    if proc.poll() is not None:
        raise RuntimeError(f"Pio exited early (rc={proc.returncode}) before: {cmd!r}")
    assert proc.stdin is not None
    proc.stdin.write((cmd + "\n").encode("utf-8"))
    proc.stdin.flush()

def _read_until_end(proc: subprocess.Popen):
    assert proc.stdout is not None
    while True:
        if proc.poll() is not None:
            try:
                while True:
                    raw = proc.stdout.readline()
                    if not raw:
                        return
                    s = raw.decode(errors="replace").rstrip()
                    if s: print("[PIO]", s)
            except Exception:
                return
        raw = proc.stdout.readline()
        if not raw:
            return
        s = raw.decode(errors="replace").rstrip()
        if s:
            print("[PIO]", s)
        if s == "END":
            break

# ---------------- parsing helpers ----------------

def parse_block(txt: str) -> dict:
    kv: Dict[str, str] = {}
    for line in txt.splitlines():
        if not line.startswith("#"):
            continue
        if "#" in line[1:]:
            k, v = line[1:].split("#", 1)
            kv[k.strip()] = v.strip()
    return kv

def detect_upi_commands(txt: str) -> List[str]:
    cmds: List[str] = []
    for ln in txt.splitlines():
        s = ln.strip()
        if not s or s.startswith("#"):
            continue
        cmds.append(s)
    return cmds

# ----- hand order / range mapping (v2-compatible) -----

_ORDER = "23456789TJQKA"
_VAL   = {r:i for i, r in enumerate(_ORDER, 2)}

def _combo_to_cat(c: str) -> str:
    # "AsKd" -> "AKo", "AhKh" -> "AKs", "7c7d" -> "77"
    if len(c) != 4: return ""
    r1,s1,r2,s2 = c[0],c[1],c[2],c[3]
    if r1 == r2: return f"{r1}{r2}"
    hi, lo = (r1, r2) if _VAL[r1] > _VAL[r2] else (r2, r1)
    return f"{hi}{lo}{'s' if s1 == s2 else 'o'}"

def _parse_169(spec: str) -> Dict[str, float]:
    d: Dict[str, float] = {}
    for part in spec.split(","):
        p = part.strip()
        if not p: continue
        if ":" in p:
            h, w = p.split(":", 1)
            d[h.strip().upper()] = float(w)
        else:
            d[p.strip().upper()] = 1.0
    return d

# ---------------- tree construction ----------------

class Node(NamedTuple):
    # cumulative commitments
    oop: int
    ip: int
    # street: 1=flop, 2=turn, 3=river
    street: int
    # actor to act: "OOP" | "IP"
    actor: str
    # previous street aggressor: "OOP" | "IP" | None
    last_agg_prev: Optional[str]
    # number of checks so far this street (resets after first bet)
    checks_this_street: int
    # is there a live bet to face on this street?
    #  - "none" -> no bet yet
    #  - "bet_oop" | "bet_ip" -> open bet placed by OOP/IP
    #  - "raise_k" -> we have k raises already (k>=1), last bettor is actor!=facing
    live: str
    # how many raises so far on this street (0 after open bet; increments on raises)
    raises_done: int
    # last bettor ("OOP"/"IP") on current street if live != "none"
    last_bettor: Optional[str]

def _cur_pot(dead: int, n: Node) -> int:
    return dead + n.oop + n.ip

def _amt_pct(dead: int, n: Node, pct: float) -> int:
    return max(1, round(_cur_pot(dead, n) * (pct / 100.0)))

def _cap_to_eff(x: int, eff: int) -> int:
    return x if eff <= 0 else min(x, eff)

def _is_allin(n: Node, eff: int) -> bool:
    return eff > 0 and (n.oop >= eff or n.ip >= eff)

def _spr(dead: int, n: Node, eff: int, facing: str) -> float:
    pot_now = max(1, _cur_pot(dead, n))
    stack_left = max(0, eff - (n.oop if facing == "OOP" else n.ip))
    return stack_left / pot_now

def _spr_allows_shove(dead: int, n: Node, eff: int, spr_limit: Optional[float]) -> bool:
    if eff <= 0: 
        return False
    if spr_limit is None:
        return True
    return _spr(dead, n, eff, n.actor) <= spr_limit

def _append(path: List[Tuple[int,int]], o: int, i: int) -> List[Tuple[int,int]]:
    # Enforce monotone non-decreasing
    po, pi = path[-1]
    return path + [(max(po, o), max(pi, i))]

def _apply_check(n: Node) -> Node:
    next_actor = "IP" if n.actor == "OOP" else "OOP"
    return Node(
        n.oop, n.ip, n.street, next_actor,
        n.last_agg_prev,
        n.checks_this_street + 1,
        "none", 0, None
    )

def _advance_street(n: Node) -> Node:
    # After street closure (check-check or call), reset actor to OOP, last_agg_prev becomes last_bettor of street (if any)
    return Node(
        n.oop, n.ip, n.street + 1, "OOP",
        n.last_bettor if n.last_bettor else n.last_agg_prev,
        0, "none", 0, None
    )

def _bet(dead: int, n: Node, pct: float, eff: int) -> Optional[Node]:
    if _is_allin(n, eff): return None
    b = _amt_pct(dead, n, pct)
    if n.actor == "OOP":
        return Node(_cap_to_eff(n.oop + b, eff), n.ip, n.street, "IP",
                    n.last_agg_prev, 0, "bet_oop", 0, "OOP")
    else:
        return Node(n.oop, _cap_to_eff(n.ip + b, eff), n.street, "OOP",
                    n.last_agg_prev, 0, "bet_ip", 0, "IP")

def _call(n: Node, eff: int) -> Node:
    # Equalize to bettor
    if n.last_bettor == "OOP":
        return Node(n.oop, _cap_to_eff(n.oop, eff), n.street, n.actor, n.last_agg_prev, 0, "none", 0, n.last_bettor)
    else:
        return Node(_cap_to_eff(n.ip, eff), n.ip, n.street, n.actor, n.last_agg_prev, 0, "none", 0, n.last_bettor)

def _raise(dead: int, n: Node, pct: float, eff: int) -> Optional[Node]:
    if _is_allin(n, eff): return None
    r = _amt_pct(dead, n, pct)
    if n.actor == "OOP":
        new_oop = _cap_to_eff(n.oop + r, eff)
        return Node(new_oop, n.ip, n.street, "IP", n.last_agg_prev, 0, "raise_k", n.raises_done + 1, "OOP")
    else:
        new_ip = _cap_to_eff(n.ip + r, eff)
        return Node(n.oop, new_ip, n.street, "OOP", n.last_agg_prev, 0, "raise_k", n.raises_done + 1, "IP")

def _shove(n: Node, eff: int) -> Node:
    # Actor shoves; in Pio add_line we model shove+call terminal (equalized eff,eff).
    return Node(eff, eff, n.street, ("IP" if n.actor == "OOP" else "OOP"), n.last_agg_prev, 0, "none", 0, n.actor)

def _flatten(path: List[Tuple[int,int]]) -> List[int]:
    if len(path) <= 1:
        return [0,0]
    out: List[int] = []
    for (o,i) in path[1:]:
        out.append(o); out.append(i)
    return out

def _get_int_triplet(s: str, default=(3,3,3)) -> Tuple[int,int,int]:
    if not s: return default
    # header stores like "3\n3\n3"
    parts = s.split("\\n")
    if len(parts) != 3:
        parts = re.split(r"[\n\r]+", s.strip())
    try:
        a = int(parts[0]); b = int(parts[1]); c = int(parts[2])
        return (a,b,c)
    except:
        return default

def _parse_sizes(kv: dict) -> dict:
    def floats(key: str) -> List[float]:
        s = kv.get(key, "").strip()
        if not s: return []
        return [float(x) for x in s.split()]
    def raises(key: str) -> List[str]:
        s = kv.get(key, "").strip()
        if not s: return []
        return s.split()
    return {
        # bets
        "flop_ip_bets": floats("FlopConfigIP.BetSize"),
        "flop_oop_donks": floats("FlopConfig.DonkBetSize"),
        "turn_ip_bets": floats("TurnConfigIP.BetSize"),
        "turn_oop_donks": floats("TurnConfig.DonkBetSize"),
        "river_ip_bets": floats("RiverConfigIP.BetSize"),
        "river_oop_donks": floats("RiverConfig.DonkBetSize"),
        # raises (strings to allow 'a' and pct numbers)
        "flop_ip_raises": raises("FlopConfigIP.RaiseSize"),
        "flop_oop_raises": raises("FlopConfig.RaiseSize"),
        "turn_ip_raises": raises("TurnConfigIP.RaiseSize"),
        "turn_oop_raises": raises("TurnConfig.RaiseSize"),
        "river_ip_raises": raises("RiverConfigIP.RaiseSize"),
        "river_oop_raises": raises("RiverConfig.RaiseSize"),
        # plus flags
        "flop_add_ai": kv.get("FlopConfig.AddAllin", "").strip().lower() == "true",
        "turn_add_ai": kv.get("TurnConfig.AddAllin", "").strip().lower() == "true",
        "river_add_ai": kv.get("RiverConfig.AddAllin", "").strip().lower() == "true",
    }

def _mirror_if_empty(vals: List[float], fallback: List[float]) -> List[float]:
    return vals if vals else fallback

def _street_caps(kv: dict) -> Tuple[int,int,int]:
    return _get_int_triplet(kv.get("CapPerStreet","3\\n3\\n3"), (3,3,3))

def _can_oop_donk_on(street: int, last_agg_prev: Optional[str]) -> bool:
    # Donk = bet by OOP when previous street aggressor was IP
    return last_agg_prev == "IP"

def build_action_tree(kv: dict, dead: int, eff: int) -> List[List[int]]:
    # sizes
    sz = _parse_sizes(kv)
    # mirror OOP turn/river donks if absent
    sz["turn_oop_donks"]  = _mirror_if_empty(sz["turn_oop_donks"],  sz["turn_ip_bets"])
    sz["river_oop_donks"] = _mirror_if_empty(sz["river_oop_donks"], sz["river_ip_bets"])

    # raise caps
    cap_flop, cap_turn, cap_river = _street_caps(kv)

    # all-in gating via SPR
    spr_limit: Optional[float] = None
    spr_raw = kv.get("AddAllinOnlyIfLessThanThisTimesThePot","").strip()
    if spr_raw:
        try: spr_limit = float(spr_raw) / 100.0
        except: spr_limit = None

    # preflop aggressor guides who can donk on flop
    pfa = (kv.get("PreflopAggressor","IP") or "IP").upper()
    if pfa not in ("OOP","IP"): pfa = "IP"

    start = Node(0,0,1,"OOP",pfa,0,"none",0,None)

    # DFS over states
    results: List[List[int]] = []
    seen: Set[Tuple] = set()
    stack: List[Tuple[Node, List[Tuple[int,int]]]] = [(start, [(0,0)])]

    def cap_for(st: int) -> int:
        return cap_flop if st==1 else (cap_turn if st==2 else cap_river)

    def raise_sizes_for(st: int, raiser: str) -> List[str]:
        if st==1:
            return sz["flop_oop_raises"] if raiser=="OOP" else sz["flop_ip_raises"]
        elif st==2:
            return sz["turn_oop_raises"] if raiser=="OOP" else sz["turn_ip_raises"]
        else:
            return sz["river_oop_raises"] if raiser=="OOP" else sz["river_ip_raises"]

    def bet_sizes_for(st: int, bettor: str, last_agg_prev: Optional[str]) -> List[float]:
        if st==1:
            if bettor=="IP":
                return sz["flop_ip_bets"]
            else:
                return sz["flop_oop_donks"] if _can_oop_donk_on(st, last_agg_prev) else []
        elif st==2:
            if bettor=="IP":
                return sz["turn_ip_bets"]
            else:
                return sz["turn_oop_donks"] if _can_oop_donk_on(st, last_agg_prev) else []
        else:
            if bettor=="IP":
                return sz["river_ip_bets"]
            else:
                return sz["river_oop_donks"] if _can_oop_donk_on(st, last_agg_prev) else []

    def add_allin_allowed(st: int) -> bool:
        return (st==1 and sz["flop_add_ai"]) or (st==2 and sz["turn_add_ai"]) or (st==3 and sz["river_add_ai"]) or (spr_limit is not None) or (spr_limit is None)

    while stack:
        n, path = stack.pop()

        state_key = (n.oop, n.ip, n.street, n.actor, n.last_agg_prev, n.checks_this_street, n.live, n.raises_done, n.last_bettor)
        if state_key in seen:
            continue
        seen.add(state_key)

        # Terminal conditions
        if _is_allin(n, eff):
            results.append(_flatten(path))
            continue

        if n.street > 3:
            results.append(_flatten(path))
            continue

        # Two checks -> advance street
        if n.live == "none" and n.checks_this_street >= 2:
            nx = _advance_street(n)
            stack.append((nx, _append(path, nx.oop, nx.ip)))
            continue

        # Offer shove at every decision node (subject to SPR limit)
        if add_allin_allowed(n.street) and _spr_allows_shove(dead, n, eff, spr_limit):
            nx = _shove(n, eff)
            stack.append((nx, _append(path, nx.oop, nx.ip)))
            # no "call" node needed explicitly; shove modeled as (eff,eff) terminal

        if n.live == "none":
            # no bet yet on street → actor can check or open bet (if allowed)
            # check
            nx = _apply_check(n)
            # If this would create >6 zeros overall, guard later by pruning; still enqueue
            stack.append((nx, _append(path, nx.oop, nx.ip)))

            # open bet (IP c-bet after OOP check; OOP donk only if prev aggressor was IP)
            bet_sizes = bet_sizes_for(n.street, n.actor, n.last_agg_prev)
            for pct in bet_sizes:
                nb = _bet(dead, n, pct, eff)
                if not nb: 
                    continue
                # after bet, facing can call (end street) or raise (bounded), or shove already covered
                stack.append((nb, _append(path, nb.oop, nb.ip)))

                # call path => street ends
                call_node = _call(nb, eff)
                after_call = Node(call_node.oop, call_node.ip, call_node.street, call_node.actor, nb.last_bettor, 0, "none", 0, nb.last_bettor)
                adv = _advance_street(after_call)
                stack.append((adv, _append(_append(path, nb.oop, nb.ip), call_node.oop, call_node.ip)))
        else:
            # Facing a live bet/raise
            # 1) call → end street
            call_node = _call(n, eff)
            adv = _advance_street(call_node)
            stack.append((adv, _append(path, call_node.oop, call_node.ip)))

            # 2) raise if cap not reached
            if n.raises_done < cap_for(n.street):
                rsizes = raise_sizes_for(n.street, n.actor)
                for tok in rsizes:
                    if tok.lower() == "a":
                        # shove handled by shove branch (already added), skip here
                        continue
                    try:
                        pct = float(tok)
                    except:
                        continue
                    nr = _raise(dead, n, pct, eff)
                    if not nr:
                        continue
                    stack.append((nr, _append(path, nr.oop, nr.ip)))

    # Dedup & safety prune long zero-chains
    uniq: List[List[int]] = []
    seen_lines: Set[Tuple[int,...]] = set()
    for ln in results:
        t = tuple(ln)
        if t in seen_lines: 
            continue
        # prune >6 zeros (flop/turn/river check-through only)
        zeros = sum(1 for v in ln if v == 0)
        if zeros > 6:
            continue
        # ensure pairs are non-decreasing
        ok = True
        for i in range(2, len(ln), 2):
            if ln[i]   < ln[i-2] or ln[i+1] < ln[i-1]:
                ok = False; break
        if not ok:
            continue
        seen_lines.add(t)
        uniq.append(ln)
    return uniq

# ---------------- orchestration ----------------

def run_job_from_block(block: str, out_name_hint: str = "job") -> str:
    upi_cmds = detect_upi_commands(block)
    kv       = parse_block(block)

    out_dir = Path(OUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    with open(TREE_LOG_PATH, "w", encoding="utf-8") as lf:
        lf.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] tree_build_attempt\n")

    board_raw = (kv.get("Board", "") or "").replace(" ", "")
    tag       = board_raw or "flop"
    out_cfr   = str(out_dir / f"{out_name_hint}_{tag}.cfr")
    out_txt   = out_cfr + ".txt"

    exe = Path(PIO_EXE)
    if not exe.exists():
        raise FileNotFoundError(f"PIO_EXE not found: {exe}")

    p = subprocess.Popen(
        [str(exe)],
        cwd=str(exe.parent),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if p.stdin is None or p.stdout is None:
        raise RuntimeError("Failed to get pipes from Pio process.")

    # session knobs
    _send(p, "set_end_string END");                    _read_until_end(p)
    _send(p, f"set_threads {THREADS}");                _read_until_end(p)
    _send(p, f"set_info_freq {INFOFREQ}");             _read_until_end(p)
    _send(p, f"set_accuracy {ACCURACY_CHIPS} chips");  _read_until_end(p)

    # RAW UPI passthrough
    if upi_cmds:
        with open(TREE_LOG_PATH, "a", encoding="utf-8") as lf:
            lf.write("[raw_upi]\n")
            for cmd in upi_cmds:
                if cmd.lower().startswith("add_line"):
                    lf.write(cmd + "\n")
        saw_build = saw_go = saw_wait = saw_dump = False
        did_stdoutredi = False
        for cmd in upi_cmds:
            low = cmd.lower()
            if low.startswith("dump_tree"): saw_dump = True
            elif low == "build_tree":       saw_build = True
            elif low == "go":               saw_go = True
            elif low == "wait_for_solver":  saw_wait = True
            elif low.startswith("stdoutredi"): did_stdoutredi = True
            _send(p, cmd); _read_until_end(p)

        if not saw_build:
            _send(p, "build_tree"); _read_until_end(p)
        if not saw_go:
            _send(p, "go"); _read_until_end(p)
        if not saw_wait:
            _send(p, "wait_for_solver"); _read_until_end(p)
        if not saw_dump:
            _send(p, f"dump_tree {out_cfr}"); _read_until_end(p)

        if EXPORT_TXT and not did_stdoutredi:
            _send(p, f"stdoutredi {out_txt}"); _read_until_end(p)
            _send(p, "print_all_strats");      _read_until_end(p)
            _send(p, "stdoutback");            _read_until_end(p)

        _send(p, "exit")
        try:
            out_bytes, _ = p.communicate(timeout=15)
            if out_bytes:
                for line in out_bytes.decode(errors="replace").splitlines():
                    if line: print("[PIO]", line)
        except subprocess.TimeoutExpired:
            p.kill()
            try:
                out_bytes, _ = p.communicate(timeout=5)
                if out_bytes:
                    for line in out_bytes.decode(errors="replace").splitlines():
                        if line: print("[PIO]", line)
            except Exception:
                pass

        rc = p.returncode
        if rc != 0:
            raise RuntimeError(f"Pio exited with code {rc}")
        if not os.path.exists(out_cfr) or os.path.getsize(out_cfr) < 1024:
            raise RuntimeError(f"dump_tree failed or file too small: {out_cfr}")
        return out_cfr

    # GENERATED MODE
    pot_dead = int(kv.get("Pot", "0") or "0")
    eff      = int(kv.get("EffectiveStacks", "0") or "0")

    if board_raw:
        _send(p, f"set_board {board_raw}"); _read_until_end(p)
    _send(p, f"set_pot 0 0 {pot_dead}");    _read_until_end(p)
    if eff > 0:
        _send(p, f"set_eff_stack {eff}");   _read_until_end(p)

    # Ranges
    spec0 = _parse_169(kv.get("Range0", ""))
    spec1 = _parse_169(kv.get("Range1", ""))

    _send(p, "show_hand_order")
    tokens: List[str] = []
    assert p.stdout is not None
    while True:
        raw = p.stdout.readline()
        if not raw: break
        s = raw.decode(errors="replace").rstrip()
        if s == "END": break
        if s: tokens += s.split()
    combos = [t for t in tokens if len(t) == 4]

    def _weights_from(spec: Dict[str, float]) -> List[float]:
        out: List[float] = []
        for c in combos:
            out.append(spec.get(_combo_to_cat(c).upper(), 0.0))
        return out

    rng0 = _weights_from(spec0)
    rng1 = _weights_from(spec1)

    def _sum_cat(weights: List[float], wanted_cat: str) -> Tuple[float, int]:
        total = 0.0; n = 0
        for w, c in zip(weights, combos):
            if _combo_to_cat(c).upper() == wanted_cat.upper():
                total += w; n += 1
        return total, n

    w0, n0 = _sum_cat(rng0, "A2S")
    w1, n1 = _sum_cat(rng1, "A2S")
    print(f"[DEBUG] Root totals: OOP A2S={w0:.3f} over {n0}, IP A2S={w1:.3f} over {n1}")

    _send(p, "set_range 0 " + " ".join(f"{w:.6f}" for w in rng0)); _read_until_end(p)
    _send(p, "set_range 1 " + " ".join(f"{w:.6f}" for w in rng1)); _read_until_end(p)

    # Build add_lines with poker logic
    add_lines = build_action_tree(kv, dead=pot_dead, eff=eff)

    # Log header + lines
    with open(TREE_LOG_PATH, "a", encoding="utf-8") as lf:
        lf.write("[generated]\n")
        lf.write(f"Board={board_raw or '(none)'} Pot={pot_dead} Eff={eff}\n")
        for ln in add_lines:
            lf.write("add_line " + " ".join(str(x) for x in ln) + "\n")

    # Send to Pio
    for ln in add_lines:
        _send(p, "add_line " + " ".join(str(x) for x in ln)); _read_until_end(p)

    _send(p, "build_tree");      _read_until_end(p)
    _send(p, "go");              _read_until_end(p)
    _send(p, "wait_for_solver"); _read_until_end(p)
    _send(p, f"dump_tree {out_cfr}"); _read_until_end(p)

    if EXPORT_TXT:
        _send(p, f"stdoutredi {out_txt}"); _read_until_end(p)
        _send(p, "print_all_strats");      _read_until_end(p)
        _send(p, "stdoutback");            _read_until_end(p)

    _send(p, "exit")

    try:
        out_bytes, _ = p.communicate(timeout=15)
        if out_bytes:
            for line in out_bytes.decode(errors="replace").splitlines():
                if line: print("[PIO]", line)
    except subprocess.TimeoutExpired:
        p.kill()
        try:
            out_bytes, _ = p.communicate(timeout=5)
            if out_bytes:
                for line in out_bytes.decode(errors="replace").splitlines():
                    if line: print("[PIO]", line)
        except Exception:
            pass

    rc = p.returncode
    if rc != 0:
        raise RuntimeError(f"Pio exited with code {rc}")
    if not os.path.exists(out_cfr) or os.path.getsize(out_cfr) < 1024:
        raise RuntimeError(f"dump_tree failed or file too small: {out_cfr}")

    return out_cfr
