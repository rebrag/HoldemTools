# Pio watcher - the postflop pipeline's producer side

Runs on Josh's PC (Windows, requires PioSOLVER).
Polls ADLS for game-tree configs uploaded by the HoldemTools API, solves each with PioSOLVER, extracts the solved tree, and uploads the solution blobs the frontend consumes.
Nothing in the monorepo imports this code; it lives here so the whole pipeline - frontend upload, watcher solve/extract, frontend consumption - is visible in one repo.

Snapshot-copied from the (now archived) `rebrag/GTOLite-Helper-Script` repo, which keeps the full history.

## What it does

`watch_adls_and_run_pio_headless.py` polls the `onlinerangedata` container at `gametrees/<today UTC>/` for game-tree JSONs uploaded by `POST /api/gametrees`, solves each with PioSOLVER, then extracts and uploads:

- gzipped **street bundles** to `piosolutions/{stacks}/{node_name}/{board}/streets/{seedSuffix}.json.gz` (flop + all turn streets precomputed at solve time; rivers extracted on demand via the `noderequests/` queue and `POST /api/noderequests`)
- a per-board `manifest.json` (schema 3: streets map, seats, preflop context, effective stack)
- an upserted entry in `piosolutions-index.json` at the container root (the frontend's "Solved flops" library)

The full `.cfr` save stays local in `C:\PioSOLVER\Solved` under a name unique per (stacks, line, board), tracked by `registry.json` and capped by an LRU disk budget (`PIO_CFR_MAX_GB`, default 150 GB).

**Schema note:** `extraction.py` is the source of truth for the manifest / street-bundle / node-doc shapes consumed by `frontend/src/lib/solver/postflopLibrary.ts` and `frontend/src/lib/solver/postflopClient.ts`.
The tree-config text the watcher receives is built in `frontend/src/lib/solver/handleActionClick.ts` (`#Range0#` = OOP, `#Range1#` = IP, `#ICM.Stacks#` OOP-first).

## Files

| File | Role |
|---|---|
| `watch_adls_and_run_pio_headless.py` | The watcher. The only entry point to run for solves. |
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

- Only **today's UTC** `gametrees/yyyy/MM/dd/` folder is watched, and files that already exist at startup are skipped.
Start the watcher **before** requesting solves from the frontend.
- Only **one** watcher instance may run - two fight over the PioViewer GUI.
- `PIO_ACCURACY` is in **chips** (1 chip is roughly a 9s solve; small bb-scale values blow the frontend's ~160s poll window).
- Solve accuracy and CFR wait time are tunable via `PIO_ACCURACY` and `PIO_CFR_WAIT_SECS` in `.env`.
- A deprecated "withsave" watcher variant existed in the old repo; it was intentionally NOT copied here (its companion uploaded a stub JSON to a path the API never reads).

## Run

```bash
python watch_adls_and_run_pio_headless.py
```
