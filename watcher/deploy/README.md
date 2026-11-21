# htsolver worker - remote runbook

How to put the headless htsolver worker (`watcher/ht_solve_watcher.py`) on a Windows Server box, keep it running, and update it.
The worker claims `htsolver` jobs from the SolveJobs queue, solves them with `engine.exe`, uploads the flop and turn bundles, and serves river streets on demand from the artifacts it keeps on local disk.
It needs no PioSOLVER, no GUI, no logged-on user and no unlocked desktop.

Everything here runs in an elevated PowerShell on the box.
Nothing in this folder contains a secret, and no step asks you to paste one anywhere except into `watcher\.env` on the box itself.

## What the box needs

| Need | Why | How |
|---|---|---|
| Windows Server 2019 or newer, x64, a CPU with AVX2 | The engine is built with `ENGINE_SIMD=AVX2` | Any Xeon from Haswell (2013) on |
| Git | To clone and to update | `winget install Git.Git`, or the installer from git-scm.com |
| Python 3.11 or newer, installed for all users | The worker | python.org installer, tick "Install for all users" and "Add to PATH" |
| Build Tools for Visual Studio 2022 with "Desktop development with C++" | `engine/build.ps1` builds `engine.exe` here | visualstudio.microsoft.com/downloads, "Tools for Visual Studio" |
| Outbound HTTPS to the API, to `*.blob.core.windows.net`, `*.dfs.core.windows.net`, `*.queue.core.windows.net`, and (install time only) to pypi.org and github.com | Claims, uploads, the river queue | No inbound port is needed |
| A disk with room for the artifact cache | Each solved board keeps a 3 to 6 GB `.hta` so rivers can be served without re-solving | 200 GB holds roughly 40 boards; the cache is LRU and re-solves on a miss |

Building on the box is the recommended way to get `engine.exe`: it is the same `build.ps1` every other machine uses, and `update.ps1` can then rebuild it.
If installing the Build Tools is not acceptable, copy a prebuilt `engine.exe` over instead and install the Microsoft Visual C++ 2015-2022 x64 runtime (`vc_redist.x64.exe`); pass it with `-EnginePath`, and replace that file by hand whenever `engine/` changes.

## First install

Clone outside any user profile, because the worker runs as `LOCAL SERVICE`, which cannot read another user's profile.

```powershell
git clone https://github.com/rebrag/HoldemTools.git C:\HoldemTools
```

```powershell
C:\HoldemTools\watcher\deploy\install.ps1
```

`install.ps1` is idempotent and does five things: creates a virtual environment from `watcher\requirements-ht.txt`, builds the engine, creates the data directories under `C:\ProgramData\HoldemTools\htsolver` (override with `-DataDir D:\htsolver` to use a bigger disk), writes a `watcher\.env` with the secrets left empty, and registers the scheduled task.

Then fill in the three `REQUIRED` values in `C:\HoldemTools\watcher\.env`:

| Key | Value |
|---|---|
| `HOLDEMTOOLS_API_BASE` | The deployed API's base URL |
| `WATCHER_API_KEY` | The App Service setting `Watcher__ApiKey` |
| `AZURE_STORAGE_CONNECTION_STRING` | The storage account's connection string (Portal, Access keys) |

Copy them from the same places the existing watcher's `.env` got them.
The file is readable only by Administrators and the worker account, and is gitignored.

## Measure the box before trusting a solve time

```powershell
C:\HoldemTools\watcher\deploy\bench.ps1
```

This needs only `engine.exe`: no `.env`, no network.
It solves the small spot (a real recorded hand's ranges) at a handful of thread counts up to every thread, the medium spot on every thread, then the small spot twice at once with one solve pinned to each processor socket, and saves a Markdown table to `%TEMP%\htsolver-bench\bench-<hostname>.md`.
Expect 30 to 60 minutes on a 2016 Xeon; it took 15 on the development PC.
Paste that file back.
`-Full` sweeps all three spots at every count from one thread up and takes hours; `-Threads 10,20,40` picks the counts yourself.

How to read it:

- **Solve seconds down the thread column** is the number a user waits on. If it stops improving well before the box's thread count, more threads are not helping and `HT_THREADS` should be set to where it flattens.
- **Iterations must be the same in every row of a config.** The engine is bitwise deterministic at any thread count; a different count means something is wrong with the build.
- **The two-at-once section** says whether running two solves side by side (one per NUMA node) beats one solve on every thread. If two pinned solves each finish in about the time one unpinned solve takes, set `HT_SOLVE_SLOTS=2`, `HT_THREADS=<threads per socket>` and `HT_SLOT_AFFINITY=0-19;20-39` (the script prints the exact values for the box) in `.env`: same wait per solve, twice the throughput.

If the box is too slow for the product's promise even at its best setting, that is engine work to do under a profiler, not something to tune here.

For reference, this script's own output on the development PC (one Ryzen 9800X3D, 8 cores / 16 threads, 32 GB, 2026-11-16, 11 minutes):

| config | threads | solve s | export s | process wall s | iterations | exploitable % pot | peak GB | artifact GB |
|---|---|---|---|---|---|---|---|---|
| hh_small | 4 | 78.6 | 12.0 | 92.5 | 275 | 0.174 | 7.9 | 2.99 |
| hh_small | 8 (1.18x of 4) | 66.5 | 11.7 | 79.9 | 275 | 0.174 | 7.9 | 2.99 |
| hh_small | 16 (1.14x of 4) | 69.2 | 11.6 | 82.3 | 275 | 0.174 | 7.8 | 2.99 |
| hh_medium | 16 | 281.6 | 15.6 | 299.2 | 375 | 0.179 | 10.9 | 4.55 |
| hh_small, two at once | 8 on cpus 0-7 | 83.7 | 13.0 | 98.5 | 275 | 0.174 | 7.9 | 2.99 |
| hh_small, two at once | 8 on cpus 8-15 | 83.2 | 12.3 | 98.8 | 275 | 0.174 | 7.9 | 2.99 |

`hh_large` (`-Full`) took 666 s of solve, 23 s of export and 17.5 GB there.

Two things to take from it, because they will very likely hold on a bigger box too.
**Threads past 8 bought nothing**: 16 threads were no faster than 8, and 8 only 18% faster than 4, so one solve is bound by memory, not by cores.
**Two solves side by side cost each other only about 25%** (83 s against 67 s), so two slots nearly doubled throughput on a single-socket desktop.
On a 40-thread, two-socket box the likely best setting is therefore several slots of 8 to 10 threads, not one solve on 40; try `HT_SOLVE_SLOTS=4`, `HT_THREADS=10`, `HT_SLOT_AFFINITY=0-9;10-19;20-29;30-39` after the two-slot result confirms the pattern.
Each slot needs the "peak GB" column in memory at once, since the peak is the artifact export, not the solve: `HT_MEMORY_LIMIT_GB` is per solve (the default 24 fits all three spots), and four slots on a 256 GB box have room to spare.

## Start it, and check it is alive

```powershell
Start-ScheduledTask -TaskName "HoldemTools htsolver worker"
```

```powershell
Get-Content C:\ProgramData\HoldemTools\htsolver\logs\ht_solve_watcher.log -Tail 40 -Wait
```

A healthy start logs the engine path, the worker id and its settings, and then sits quiet until a job arrives (it polls the claim route every few seconds without logging each poll).
While a job is solving, the engine's own lines appear there prefixed `ht|`, one per checkpoint (every `HT_CHECKPOINT_EVERY` iterations, 25 by default):

```
    ht| iter 150  nashconv 2.79  exploitable 1.395 (0.45% of pot)  ev 152.1 157.9  elapsed 96.4 s
```

The bracket is the number to watch: the solve stops when it reaches `HT_ACCURACY_POT_PCT`.
The same measurement goes to the API with the job's keepalives, which is what the site shows under the elapsed time on a pending solve.
The task starts at boot with nobody logged on, restarts itself a minute after any crash, and never runs two copies.
Reboot the box once and confirm the log resumes on its own; that is the property that replaces "PioViewer must be open on an unlocked desktop".

`Get-ScheduledTask -TaskName "HoldemTools htsolver worker" | Get-ScheduledTaskInfo` shows the last run result.

## Send it work

The API decides which solver gets a job, so nothing on the box selects it.

- `Solve__Solver__HandHistory` (App Service application setting): `pio` or `htsolver`. This is the switch for the solve offered after a recorded hand.
- `Solve__Solver__Sim`: the same for solves started from a preflop-sim line. Leave it `pio` until that path has been validated; ICM spots always stay on Pio.

Changing a setting restarts the API and takes effect on the next upload; it is also the rollback.
Jobs already queued for the other solver do not move on their own: `POST /api/solvejobs/reroute` (admin) with `{"from": "htsolver", "to": "pio"}` moves them.

Before flipping the switch for everyone, an admin can send single hands to htsolver from the browser: run `localStorage.setItem("ht.solverOverride", "htsolver")` in the console on the site, record a hand, accept the solve, and remove the key afterwards.

## Update it

The worker is a long-lived process, so new code does nothing until it restarts.

```powershell
C:\HoldemTools\watcher\deploy\update.ps1
```

It pulls, reinstalls Python packages if `requirements-ht.txt` changed, asks the worker to drain (it finishes and publishes the solve it is running, then exits), rebuilds the engine if anything under `engine/` changed, and starts the task again.
A drain that outlasts `-DrainTimeoutMinutes` (default 40) is cut short; the API re-queues that job after its heartbeat goes quiet.

An engine update changes solve results in the last decimals.
The worker records the engine build beside every board, so the first river request on a board solved by an older build re-solves it and republishes its flop and turns together, and a board never mixes two builds.

## Settings worth knowing (`watcher\.env`)

| Key | Default | Meaning |
|---|---|---|
| `WATCHER_ID` | hostname | Names this box's artifact store. Keep the same value if the machine is replaced |
| `HT_ARTIFACT_MAX_GB` | 200 | LRU budget for kept artifacts. A miss costs one re-solve, never a wrong answer |
| `HT_SOLVE_SLOTS` | 1 | Solves in parallel. Raise only with `HT_SLOT_AFFINITY`, after reading the bench |
| `HT_THREADS` | 0 | Threads per solve; 0 is every hardware thread |
| `HT_SLOT_AFFINITY` | unset | One CPU list per slot, `;` separated, for one solve per NUMA node |
| `HT_MEMORY_LIMIT_GB` | 24 | A tree whose estimate exceeds this fails fast with a readable message |
| `HT_ACCURACY_POT_PCT` | 0.2 | Accuracy target, percent of the pot. Same target the Pio watcher uses |
| `HT_SOLVE_TIMEOUT_SECS` | 1800 | Ceiling on one solve. A solve that has not reached the accuracy target by then fails the job with how far it got; it is never published half-solved |

`watcher\.env.example` documents every key.

## When something is wrong

| Symptom | Look at |
|---|---|
| Jobs sit at "Queued" | Is the task running? Does the log show claim polls? A 404 on the claim means the API is older than the worker |
| A job fails with a memory message | The tree is bigger than `HT_MEMORY_LIMIT_GB` allows. Raise it if the box has the RAM |
| River clicks spin | The log's node-request lines. "resolving" means the artifact was evicted and is being re-solved, which takes one solve |
| The task will not stay up | `logs\ht_solve_watcher.log`, then run `.venv-ht\Scripts\python.exe -u ht_solve_watcher.py` from `C:\HoldemTools\watcher` in a console to see the error directly |
| Disk filling | `HT_ARTIFACT_MAX_GB` is the cap for `artifacts\`; `work\` is per-job scratch and is emptied after each job |

Rolling back to Pio is the App Service switch above; nothing has to change on this box.
