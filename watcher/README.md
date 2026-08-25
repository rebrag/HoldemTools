# Pio watcher - the postflop pipeline's producer side

Runs on Josh's PC (Windows, requires PioSOLVER).
Polls ADLS for game-tree configs uploaded by the HoldemTools API, solves each with PioSOLVER, extracts the solved tree, and uploads the solution blobs the frontend consumes.
Nothing in the monorepo imports this code; it lives here so the whole pipeline - frontend upload, watcher solve/extract, frontend consumption - is visible in one repo.

Snapshot-copied from the (now archived) `rebrag/GTOLite-Helper-Script` repo, which keeps the full history.

## What it does

`watch_adls_and_run_pio_headless.py` discovers game-tree solve requests, solves each with PioSOLVER, then extracts and uploads:

- gzipped **street bundles** to `piosolutions/{stacks}/{node_name}/{board}/streets/{seedSuffix}.json.gz` (flop + all turn streets precomputed at solve time; rivers extracted on demand via the `noderequests/` queue and `POST /api/noderequests`)
- a per-board `manifest.json` (schema 4: streets map, seats, preflop context, effective stack, solve stats)
- an upserted entry in `piosolutions-index.json` at the container root (the frontend's "Solved flops" library)

The **flop bundle and manifest are published as soon as the flop walk finishes**, before the turn sweep, so a user can open the board minutes before the full extraction completes; bundle uploads run in parallel (`PIO_UPLOAD_WORKERS`).

### Gametree discovery: queue mode vs blob mode

With `HOLDEMTOOLS_API_BASE` + `WATCHER_API_KEY` set in `.env`, the watcher claims jobs from the backend's **SolveJobs queue** (`POST /api/solvejobs/claim`, authenticated by the `X-Watcher-Key` shared secret) and reports status transitions (`Solving -> Extracting -> Uploading -> Done/Failed`) plus a heartbeat while a job runs, which is what drives the frontend's live pending card and queue positions.
`POST /api/gametrees` writes both the blob and a Queued job row, so jobs survive watcher restarts and UTC-midnight boundaries, and failures surface to the user instead of timing out silently.
A watcher that stops heartbeating for 5 minutes has its job requeued once, then failed with "watcher timed out".

Without those env vars the watcher falls back to the legacy **blob mode**: polling `gametrees/<today UTC>/` directly (`WATCHER_USE_QUEUE=0` forces this as the rollback switch).
Node requests are blob-driven in both modes, and are checked between every solve so a browsing user's river click never waits behind a queued batch.

## Schema 4: per-combo data

Schema 3 uploaded only the 169 hand-class averages. That is all the range matrix
needs, but it is not enough for the per-combo hand breakdown: combos of one class
routinely play different mixes, because their blockers differ.
On a real solve, `A5s` split 44.4 / 74.9 / 47.1 / 40.4 percent bet across its four
combos - collapsing that to one class average is what made every breakdown tile
identical.

Each decision node now also carries:

| Field | Source | What it is |
|---|---|---|
| `combos.{oop,ip}` | `show_range`, `calc_eq_node`, `calc_ev` | per-combo reach weight, equity, EV and matchups, for combos the seat can actually hold |
| `combos.strategy` | `show_strategy` | per-combo action frequencies for the acting seat |
| `combos.action_ev` | `calc_ev` on each child | per-combo EV of each action, which makes per-combo EV loss derivable |
| `seat_stats` | aggregated from the above | range-wide EV / equity / **weighted** combo count per seat |
| `global_freq` | `calc_global_freq` | how often the node is reached (0 marks a line that never happens) |

The per-combo arrays are fixed-point integers indexed against the bundle's shared
`hand_order`, and only combos with non-zero weight are emitted.
Divide by the matching entry in `combos.scale`.
This costs about 3.4x the bundle size (a flop street went from 58 KB to 198 KB
gzipped) and about 0.1s of extra solver time per street.

`summary` additionally carries `mes_oop` / `mes_ip` from `calc_results`, so the gap
to the solved EVs shows how converged a board is.

Equity realization (EQR) and per-combo EV loss are deliberately **not** uploaded -
both are ratios of values already present, so the frontend derives them
(`frontend/src/lib/solver/comboDetail.ts`).

Boards solved under schema 3 keep working; they simply have no `combos` block and
the breakdown falls back to class averages.
Run `python reextract.py --all` to regenerate them from the local `.cfr` files
without re-solving.

The full `.cfr` save stays local in `C:\PioSOLVER\Solved` under a name unique per (stacks, line, board), tracked by `registry.json` and capped by an LRU disk budget (`PIO_CFR_MAX_GB`, default 150 GB).

**Schema note:** `extraction.py` is the source of truth for the manifest / street-bundle / node-doc shapes consumed by `frontend/src/lib/solver/postflopLibrary.ts` and `frontend/src/lib/solver/postflopClient.ts`.
The tree-config text the watcher receives is built by `frontend/src/lib/solver/treeConfig.ts` `buildTreeConfigText` (`#Range0#` = OOP, `#Range1#` = IP, `#ICM.Stacks#` OOP-first), with the values coming either from a preflop-sim line (`handleActionClick.ts`) or from a recorded hand (`frontend/src/pages/handhistory/create/solveBridge.ts`).
**Money units:** a preflop-sim solve is denominated in big blinds at 100 Pio chips each, the way this pipeline always was.
A hand-history solve is denominated in the recorded hand's **own money**, multiplied by a per-board `ChipScale` (a power of ten) only because Pio needs whole chips - the scale is picked so every amount stays integral and the pot keeps at least ~500 chips, which is what stops percentage bet sizes rounding coarsely.
The watcher echoes it into the manifest as `chip_scale`; **absent means the old bb convention**, so every board solved before this keeps rendering correctly.
Folder tokens follow the same unit, so a hand-history board reads `750SB_2000UTG` rather than the same hand's big-blind count.

Hand-history uploads also carry an optional `Seats` list (pos, name, flop-time stack in `ChipScale` chips, folded, hero, known hole cards) and a `BigBlind` (the hand's big blind in its own money); the watcher echoes them as `seat_meta` / `hand_bb` so the solutions viewer can show the real table (names, stacks, cards) and offer a chips/bb display toggle.

## Files

| File | Role |
|---|---|
| `watch_adls_and_run_pio_headless.py` | The watcher. The only entry point to run for solves. |
| `api_client.py` | SolveJobs queue client (claim, status reports, heartbeat). No pywinauto/Azure imports, so it runs anywhere for testing. |
| `extraction.py` | Tree walk, 1326-to-169 aggregation, doc/manifest/bundle builders. |
| `adls_store.py` | ADLS uploads + library index upserts. |
| `cfr_registry.py` | Local `.cfr` LRU disk budget (`registry.json`). |
| `reextract.py` | Regenerate bundles from local cfrs without re-solving (`--all`). |
| `pio_headless_from_block.py` | Headless tree build via UPI from a config block (used by `run_one.py`). |
| `pyosolver.py` | Vendored from github.com/weston/pyosolver (no PyPI package, no upstream LICENSE). |
| `run_one.py` | Dev harness: solve a single hardcoded config block. |
| `test_flop_walk.py` | Smoke-tests the street walk against a local `.cfr`, no ADLS. |
| `test_pyosolver_load.py` | Smoke-tests UPI startup / cfr load. |

## Prerequisites

- `pip install -r requirements.txt`
- Copy `.env.example` to `.env` and fill in `AZURE_STORAGE_CONNECTION_STRING` (storage account `jrgmonkerdatalake`).
- **PioViewer2.exe must be open** on the tree-building screen.
The watcher pastes each tree config into it and clicks "Save current parameters"; the solve itself then runs headlessly via `PioSOLVER2-edge.exe` (UPI).
Because it drives the GUI, the desktop must be unlocked and the clipboard is taken over per job.

## Behavior notes

- In queue mode, jobs are durable: submitted while the watcher is down, they wait as Queued and solve on startup.
In blob mode only **today's UTC** `gametrees/yyyy/MM/dd/` folder is watched and files that already exist at startup are skipped, so start the watcher **before** requesting solves from the frontend.
- Only **one** watcher instance may run - two fight over the PioViewer GUI.
- Solve accuracy is a **fraction of the pot** (`PIO_ACCURACY_POT_FRACTION`, default 0.002 - about 1 chip on a typical 550-chip sim pot). Hand-history solves are denominated in the hand's own money, so pot magnitude varies per board and an absolute chip target would be loose at one stake and unreachable at another. `PIO_ACCURACY` remains as an absolute chips fallback.
- Solve accuracy and CFR wait time are tunable via `PIO_ACCURACY_POT_FRACTION` / `PIO_ACCURACY` and `PIO_CFR_WAIT_SECS` in `.env`. A solve that does not converge inside `PIO_SOLVE_WAIT_SECS` now raises instead of uploading a partially solved tree.
- A deprecated "withsave" watcher variant existed in the old repo; it was intentionally NOT copied here (its companion uploaded a stub JSON to a path the API never reads).

## Run

```bash
python watch_adls_and_run_pio_headless.py
```

## Engine validation harness (`engine_compare.py`)

Manual developer tool - never part of the watcher loop and never CI (Pio only runs on this machine).
It compares a solve from the new C++ engine (`engine/`) against a PioSolver solve of the same spot.
The primary pass/fail gate is cross-exploitability (the engine's strategy is loaded into Pio via `set_strategy` + `lock_node` and Pio's evaluator reports its exploitability); per-hand L1 on action frequencies and per-hand EV differences are diagnostics, since two correct solvers may pick different equilibria.
`--json-out compare.json` additionally writes the full per-hand comparison for the frontend's hidden `/compare` page (side-by-side grids + per-combo table).

## Compare watcher (`engine_compare_watcher.py`)

The queue-driven sibling of the harness: claims `EngineCompareJob`s from `POST /api/enginecompare/claim` (same `X-Watcher-Key` + heartbeat protocol as the solve queue) and executes them on this machine.
`compare` jobs solve with htsolver AND Pio (`engine_compare.py --solve-pio`) and upload the comparison JSON to ADLS `enginecompare/{id}.json.gz`; `publish` jobs solve with htsolver only and POST the artifact to the API, which publishes schema-4 bundles into the solutions library.
Run it alongside the main watcher (`python engine_compare_watcher.py`, same `.env`; set `ENGINE_EXE` if the engine binary is not at `../engine/build/engine.exe`).
Only one instance - it spawns Pio processes.
It reuses the vendored `pyosolver.py` UPI client to query a live Pio process (`show_hand_order` / `show_strategy` / `calc_ev` / `calc_results`), and refuses QRE artifacts - only Nash-mode solves are comparable to Pio.
Usage and workflow: see "Validation ladder" in `engine/README.md`.
