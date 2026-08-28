# HoldemTools engine artifact format (`.hta`), version 1

This document is the contract for the engine's solve artifact.
It is versioned: **any** layout change bumps the format version and updates, in one commit: this spec, the C++ writer (`src/io/artifact_writer.cpp`), the C++ reader (`src/io/artifact_reader.cpp`), the C# reader (`backend/Services/EngineArtifacts/EngineArtifactReader.cs`), and the committed fixture pair (`backend/Tests/Fixtures/engine/tiny_river.hta` + `.golden.json`, regeneration commands in `engine/configs/fixtures/tiny_river.json`).

## Global rules

- All integers are **little-endian**. The writer asserts a little-endian host at compile time; there is no big-endian variant.
- Sections are 8-byte aligned; node blobs are 64-byte aligned. Padding bytes are zero.
- All floats are IEEE 754 (`f32` = binary32, `f16` = binary16).
- Chip amounts are signed 64-bit integers unless stated otherwise.
- The file is designed for range reads: a reader bootstraps with three reads (header, metadata, index) plus two small sections (node table, hand dictionaries), and then any node's data is **one** contiguous range read. This maps 1:1 onto ADLS Gen2 HTTP Range requests.

## Layout overview

```
[header 64B] [node table] [hand dictionaries] [node blobs ...] [metadata JSON] [index]
```

Section positions are discovered through the header (metadata, index) and the metadata's `sections` directory (node table, hand dictionaries); nothing but the header is at a fixed offset.

## Header (64 bytes, offset 0)

| offset | size | type | field |
|---|---|---|---|
| 0 | 8 | bytes | magic `"HTENGART"` |
| 8 | 4 | u32 | format version = 1 |
| 12 | 4 | u32 | header size = 64 |
| 16 | 4 | u32 | flags |
| 20 | 4 | u32 | reserved (0) |
| 24 | 8 | u64 | metadata offset |
| 32 | 8 | u64 | metadata length |
| 40 | 8 | u64 | index offset |
| 48 | 8 | u64 | index length |
| 56 | 8 | u64 | reserved (0) |

Flags: bit 0 = strategy stored as `u8` (else `f32`); bit 1 = EVs stored as `f16` (else `f32`, the default - f16 is an opt-in size optimization); bit 2 = node blobs carry a trailing 169-class rollup block.

The index is written last and the header is patched by seeking back to offset 0 (which is why `ArtifactStore` has `seek`).

## Metadata (UTF-8 JSON)

One JSON object. Fields (all present unless marked optional):

- `solver_version`, `format_version`, `config_hash` (SHA-256 hex of the canonical config dump), `config` (the full parsed config, embedded), `game`.
- `mode` - `"nash"` or `"qre"`. A QRE solve and a Nash solve must be distinguishable downstream; the validation harness refuses `"qre"`.
- `lambda` - per-seat λ array (in 1/chips) for QRE solves, `null` for Nash.
- `final_qre_gap_chips`, `final_qre_gap_pct_pot` - per-player exploitability measured in the entropy-augmented game, which is what a QRE solve converges on and stops against. `null` on a Nash solve. `final_nashconv` / `final_exploitable_*` stay the PLAIN measurement of the same strategy; on a QRE solve that number plateaus at a λ-dependent floor by design, so both travel and a consumer should show the plateau rather than report it as a failure to converge.
- `iterations`, `final_nashconv` (chips), `ev_chips` (per-seat root EVs; they sum to the root pot).
- `partition` (seat->agent), `payoff_weights` (`null` = identity), `collusion` (`{mode, p}`).
- `multiway_no_nash_guarantee` - `true` whenever the game has 3+ seats. CFR converges to the coarse correlated equilibrium set there, not necessarily Nash; consumers must not over-trust multiway results.
- `wall_time_s` (the iterate + best-response loop only), `setup_time_s` (tree build and showdown tables, before the first iteration), `threads` (workers the solve actually ran on - a wall time is not comparable to another solver's without it), `peak_rss_bytes`.
- `board` (as configured, e.g. `"Qs Jh 2h 8d 6c"`), `chip_scale`, `pot`, `effective_stack` (optional), `seats` (labels, seat 0 = OOP first to act).
- `node_count`, `decision_node_count`, `hand_universe` (`"nlhe_combos_1326"` or `"toy"`).
- `sections`:
  - `node_table`: `{offset, length, record_size, count}`.
  - `hand_dicts`: array of `{seat, offset, length, count}`. Each dictionary is the seat's hand universe - one `u16` canonical combo index per solver hand, in ascending canonical order - so **a dictionary position and a solver hand index are the same number**, and the per-node sparse `idx` arrays are positions into it. The universe holds only combos some seat can actually hold (non-zero range after board removal), so a narrow-range solve has a short dictionary; do not assume it covers every board-legal combo.

## Card and combo encoding

- Card code = `rank * 4 + suit`; rank `0..12` = `2..A`, suit `0..3` = `c,d,h,s`. Card 51 = As, card 0 = 2c.
- **Canonical 1326 combo order**: pairs `(hi, lo)` with `hi > lo`, sorted by `hi` descending, then `lo` descending. Index 0 = AsAh, 1 = AsAd, 2 = AsAc, 3 = AsKs, ..., 1325 = 2d2c. Combo strings print the higher card first (`"AsAh"`).
- **169-class grid order** (rollups): 13x13 row-major with rank order A..2 descending. Row i, column j: `i == j` pair, `i < j` suited, `i > j` offsuit. Index = `i * 13 + j`. Index 0 = AA, 1 = AKs, 13 = AKo, 168 = 22.

## Node table

`count` fixed-width records of `record_size` (= 80) bytes, ordered by node id (node ids are dense `0..count-1`, root = 0, children of a node contiguous):

| offset | size | type | field |
|---|---|---|---|
| 0 | 4 | u32 | node_id |
| 4 | 4 | u32 | parent_id (`0xFFFFFFFF` = root) |
| 8 | 1 | u8 | kind: 0 decision, 1 chance, 2 terminal |
| 9 | 1 | u8 | action_kind (edge from parent): 0 root, 1 fold, 2 check/call, 3 bet, 4 deal |
| 10 | 1 | u8 | street: 0 preflop, 1 flop, 2 turn, 3 river |
| 11 | 1 | u8 | terminal_kind: 0 none, 1 fold, 2 showdown |
| 12 | 2 | u16 | actor seat (`0xFFFF` = none) |
| 14 | 2 | u16 | num_children |
| 16 | 4 | u32 | first_child (`0xFFFFFFFF` = none) |
| 20 | 2 | u16 | fold_winner (`0xFFFF` = n/a) |
| 22 | 2 | i16 | dealt_card (-1 = n/a) |
| 24 | 8 | i64 | action_amount - for bet/call edges, the **actor's cumulative street commitment after the action** in chips. For river-only solves street-cumulative equals postflop-cumulative, which is exactly the frontend's `bNNN` label convention. |
| 32 | 8 | i64 | pot (total chips in the middle, dead money included) |
| 40 | 36 | i32[9] | per-seat post-root commitment (side-pot input; unused seats 0) |
| 76 | 4 | u32 | reserved (0) |

## Hand dictionaries

One per seat, in seat order: `u32 count` followed by `count` x `u16` universe ids in hand order. For hold'em the ids are canonical 1326 combo indices and the dictionary lists every combo not blocked by the board; for toy games the ids are `0..H-1`. Per-node sparse arrays index **into the dictionary** (positions), not into the universe.

## Node blobs (decision nodes only)

Located via the index; 64-byte aligned. Layout:

```
u16 num_seats  u16 num_actions  u16 actor_seat  u16 reserved
u32 count[num_seats]                     // sparse hand counts per seat
per seat s (in seat order):
  u32 idx[count[s]]                      // positions into seat s's dictionary
  f32 reach[count[s]]                    // seat s's reach at this node
  EV  ev[count[s]]                       // conditional per-hand EV (see units)
actor only:
  STRAT strategy[count[actor] x num_actions]   // row-major by hand
  EV    action_ev[count[actor] x num_actions]  // conditional EV of each action
rollup block (only when flag bit 2 set):
  169 x { f32 class_weight; f32 class_ev; u16 freq[num_actions] (scale 10000) }
```

- `EV` cells are `f32`, or `f16` when flag bit 1 is set. `STRAT` cells are `u8` (probability x 255, rounded) when flag bit 0 is set, else `f32`.
- **Sparseness**: a hand appears iff its reach at the node exceeds `1e-6`. Hands with positive range that never reach a node are absent there.
- **Strategy renormalization rule**: readers must renormalize each quantized row to sum 1; an all-zero row decodes as uniform.
- **EV units and reference**: `ev` and `action_ev` are conditional per-hand EVs in chips: the expected share of the final pot minus **all** of the seat's post-root contributions, including chips it committed before this node. `action_ev[h][k]` is the same quantity evaluated at child `k` - Pio's "actor's calc_ev at the child node".

  This is **PioSolver's `calc_ev` convention**, deliberately: the viewer's schema-4 bundles carry Pio's numbers for every board the Pio watcher solved, so the same field must mean the same thing no matter which solver produced a board. At a street root (nothing committed yet) both seats' EVs sum to the node pot; deeper in a street they sum to pot minus the committed chips.

  The alternative convention - treating already-committed chips as sunk and not subtracting them - reads more naturally hand-by-hand but is **wrong for this format**. It agrees at the root, which is exactly why a river-only solve looks fine under it, and then diverges by precisely the actor's commitment at every node past the street root.
- **Rollup aggregation rule** (matches `watcher/extraction.py`): class frequency = reach-weighted mean of the actor's per-hand action frequency; when the class carries zero reach the plain mean over its present combos is used. `class_ev` is the reach-weighted mean per-hand EV, 0 when weightless. Rollups are derived data - readers must be able to recompute them from the arrays above when the flag is absent.

## Index (at EOF)

`decision_node_count` entries of 24 bytes, sorted by node_id ascending:

| offset | size | type | field |
|---|---|---|---|
| 0 | 4 | u32 | node_id |
| 4 | 4 | u32 | reserved (0) |
| 8 | 8 | u64 | blob offset |
| 16 | 8 | u64 | blob length |

Chance and terminal nodes have no blob and no index entry; their data lives entirely in the node table.
