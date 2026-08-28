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
| `engine_compare.py` | htsolver vs Pio validation harness (see below). |
| `engine_compare_watcher.py` | Queue-driven runner for `/compare` jobs (see below). |
| `bench_boards.py` | Sweeps a fixed set of turn and river boards through both solvers and prints the time/memory table. How the chance-node cost was measured. |

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

Solves a spot with the C++ engine (`engine/`) and, when asked, with PioSolver too.
Pio is opt-in: it runs only with `--solve-pio` or `--cfr`, and an engine-only run spawns no Pio process and makes no UPI call at all.
That is the fast loop - dump, extract, pack - and it is what the compare watcher does by default, because the mid-term plan is to drop Pio entirely and keep it only as an occasional accuracy check.

**Each solver writes its own payload** (`htc_format.py`), never a merged one:

| Flag | What it writes |
|---|---|
| `--ht-out a.ht.htc` | htsolver's per-hand rows. Needs no Pio: node ids, action labels and hand rows all come out of the engine dump. |
| `--pio-out a.pio.htc` | PioSolver's payload - its summary (root EV, exploitability, solve time, peak memory) always, per-hand rows only with `--pio-detail`. |
| `--pio-detail` | Extract Pio's per-hand rows. The expensive half: 4 + actions UPI round trips per node. |
| `--cross-check` | The cross-exploitability gate. **Off by default**; without it a run reports "no verdict" rather than a cheap PASS. |

Anything comparing the two joins them **by hand string**, never by index: each file carries its own solver's hand universe and its own reach, and Pio legitimately drops hands it has no matchups for.
Both sides spell combos the engine's way (`engine_combo_str`), which is what makes that join land.

The gate is cross-exploitability: the engine's strategy is loaded into Pio via `set_strategy` - never `lock_node`, which silently zeroes the MES search - and Pio's evaluator reports how exploitable that profile is.
It remains the only real correctness statement, since two correct solvers may pick different equilibria; per-hand agreement is now judged by eye on the two grids rather than by a reach-weighted L1 the harness used to compute.
Multistreet trees build via `add_line` with one token per action = the actor's hand-cumulative total (checks repeat the current total - a mid-line 0 after chips are in can crash Pio).
Trees past `--full-limit` decision nodes use deterministic sampled runouts, and the gate falls back to root-EV agreement instead of the (then-meaningless) partial cross-check.

A turn tree's htsolver payload runs ~24MB raw and ~4MB gzipped for all ~1160 nodes, at roughly 16 bytes per hand row.
The engine dump is always trimmed (`--fields detail` when `--ht-out` is asked for, else `gate`) and written to a file rather than piped: the harness reads only the actor seat's hands and the root's reaches, so a full dump would move ~680MB of pretty-printed JSON to use a fraction of it.

Both solvers' wall clock AND peak memory are reported (they land in each payload's `summary.timing` and `summary.memory`) so the two are directly comparable: same tree, same accuracy target.
Memory is the peak working set of each solver PROCESS, read with the same OS call the engine uses for its own `peak_rss_bytes`, so it is one measurement of one thing rather than two solvers' opinions of their own footprint.
Pio's figure includes the tens of MB the process carries at idle - real RAM the machine has to have - and `pio_baseline_bytes` records what that was before any tree work, so the tree's own cost can be read off if wanted.
Tree building is timed apart from solving on both sides - the engine's own `setup_time_s` covers its tree and showdown tables, Pio's covers `set_range` + `add_line` + `build_tree` - because lumping them together flatters whichever solver builds faster.
The engine's `threads` count travels with its time, since a solve time without it is not a comparable number.
A run against a pre-solved `--cfr` reports no Pio time: that tree was solved elsewhere.

## Compare watcher (`engine_compare_watcher.py`)

The queue-driven sibling of the harness: claims `EngineCompareJob`s from `POST /api/enginecompare/claim` (same `X-Watcher-Key` + heartbeat protocol as the solve queue) and executes them on this machine.
`compare` jobs solve with htsolver and upload its payload to ADLS `enginecompare/{id}.ht.htc.gz`, plus `{id}.pio.htc.gz` when the job asked for Pio; `publish` jobs solve with htsolver only and POST the artifact to the API, which publishes schema-4 bundles into the solutions library.
Three per-job options ride the claim payload and decide how much runs: `disablePio` (no Pio process at all - the default), `disableCompare` (Pio solves, but its per-hand rows are not extracted), and `disableCrossCheck` (no gate).
The API normalizes them, so "no Pio" always implies the other two.
The frontend fetches the htsolver half first and merges Pio's when it lands, and `/api/enginecompare/{id}/result/{ht|pio}` serves either without waiting for the job to reach `Done` - so a Pio failure cannot cost you the engine result.
Run it with `python engine_compare_watcher.py` (same `.env`; set `ENGINE_EXE` if the engine binary is not at `../engine/build/engine.exe`).
Only one instance - it spawns Pio processes.

**This is the only watcher `/compare` needs.**
It claims from its own queue, runs `engine.exe` itself, and `engine_compare.py` spawns its own PioSOLVER process over UPI; the result upload to ADLS is its own too.
`watch_adls_and_run_pio_headless.py` serves a different queue entirely (the gametree/SolveJobs pipeline behind `/solutions`, driving PioViewer through pywinauto), and nothing on the compare path goes through it.
Run both only when you also want the Pio solutions library fed; they share the `.env` and do not interfere.
The one place they meet is `publish` mode, and even there they stay out of each other's way by writing separate index blobs (`enginesolutions-index.json` vs `piosolutions-index.json`), merged at read time.
It reuses the vendored `pyosolver.py` UPI client to query a live Pio process (`show_hand_order` / `show_strategy` / `calc_ev` / `calc_results`), and refuses only the cross-exploitability GATE on a QRE artifact - `--cross-check` would have Pio rate how far from Nash a deliberately non-Nash strategy is, which measures the feature rather than a defect. Pio may still solve the identical tree for Nash alongside a QRE run so the two grids can be compared by eye, and engine-only extraction is unaffected.
Usage and workflow: see "Validation ladder" in `engine/README.md`.
