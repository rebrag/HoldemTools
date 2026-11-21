# HoldemTools — monorepo

This is a **single git repository** containing the HoldemTools frontend and backend side by side,
so cross-cutting (frontend + backend) changes can happen in one commit and one Claude Code session.

The repo was created by merging two previously separate repositories, with their **full commit
history preserved** under the `frontend/` and `backend/` subfolders.

## The subprojects

| Folder | Stack | Original repo | Role |
|---|---|---|---|
| `frontend/` | React + TypeScript + Vite + Tailwind | `rebrag/GTOLite` | Frontend web app |
| `backend/` | .NET 8 Web API + EF Core + SQL Server | `rebrag/HoldemToolsAPI` | Backend API (namespace `PokerRangeAPI2`, assembly `GTOLiteAPI`) |
| `watcher/` | Python + pywinauto + PioSOLVER | `rebrag/GTOLite-Helper-Script` (archived; snapshot copy, history stays there) | Postflop solve pipeline: claims uploaded gametrees from the SolveJobs queue, solves them, uploads solution blobs to ADLS. Two workers: the PioSOLVER watcher on Josh's PC, and the headless htsolver worker (`ht_solve_watcher.py`, no Pio, no GUI) for a server |
| `engine/` | C++20 + CMake + Ninja | (new in this monorepo) | Headless CFR/QRE solver CLI: config in, binary `.hta` artifact out. See `engine/CLAUDE.md` |

Each subfolder keeps its own `README.md`, and `frontend/` keeps its own `CLAUDE.md` with
frontend-specific conventions.
Defer to those for subproject-specific rules.

Hosting: frontend on Vercel, API on Azure App Service.
Solver data is served from Azure Data Lake.
The postflop manifest / street-bundle / node-doc schemas the frontend consumes originate in
`watcher/extraction.py` - see `watcher/README.md`.
The watcher is operational tooling only: never deployed, never imported by frontend or backend.

## How they talk

- The frontend calls the API at `import.meta.env.VITE_API_BASE_URL` (set in `frontend/.env`).
- **Auth:** Firebase Auth on the frontend (`user.uid`, `user.getIdToken()`).
  - Most endpoints (bankroll, files) currently trust a client-supplied `userId` query param, with no token check.
  - Newer endpoints verify the **Firebase ID token** server-side (`Authorization: Bearer <token>`):
    the frontend uses `frontend/src/lib/api.ts` `authedFetch`; the API uses JWT bearer auth
    (`Program.cs`, Firebase project id `gto-lite`) scoped per-controller via `[Authorize]`.
- When adding a feature that spans both sides, mirror the **bankroll** vertical slice as the
  reference pattern: `backend` Model + `AppDbContext` DbSet + EF migration + Controller,
  and `frontend/src/pages/<tool>/` + a route in `App.tsx` + a button in `NavBar.tsx`.

## The solver engine (`engine/`)

The engine is a **headless, platform-agnostic C++ CLI** with **zero cloud and zero Firebase dependencies** - it reads a JSON config, writes a local binary artifact (`.hta`, spec in `engine/docs/artifact-format.md`), and exits.
Never add an Azure SDK, Firebase SDK, or GUI dependency to it.

The stack boundary around it:

- The engine writes local artifacts only.
- An **uploader** (a later pass: a small step in the .NET API or an extension of `watcher/`) moves artifact blobs to **ADLS Gen2** (`solves/{solve_id}/solution.bin`) and indexes metadata + the node byte-offset table in **Azure SQL**.
- The .NET API validates the caller's **Firebase ID token**, checks ownership in Azure SQL, and mints a short-lived **user delegation SAS** for the single blob; the browser then Range-GETs ADLS directly.
  Bulk float arrays never stream through the API and never go into SQL.
- **Firebase is auth-only** in this whole feature: no Firestore reads/writes, no Firebase Storage, no Admin SDK.
  All data goes the Azure route.

Current local-only path (the ADLS/SAS pieces above are not wired yet, deliberately):
`engine solve` -> `.hta` -> C# reader (`backend/Services/EngineArtifacts/`) -> `POST /api/engine/import` exports schema-4 JSON under `Engine:LocalSolutionsDir` -> `FilesController` serves it ahead of ADLS (dev-gated; never set that config key on a deployed instance) -> the existing `/solutions` viewer renders it unchanged.
That C# exporter is river-only and is on its way out: `python watcher/ht_bundles.py export` writes the same directory layout for a flop artifact through the path below.

### htsolver on the SolveJobs queue (the path that retires PioSOLVER)

A user-facing flop solve (the one `/hand-history/create` offers after a recorded hand, and the one `/solutions` offers from a preflop line) is a `SolveJobs` row, and **which solver runs it is a server-side switch**, never a client choice.

- `POST /api/gametrees` takes the Pio tree text and, beside it, an `engineTree`: the same spot as htsolver's tree block.
  Both are serialized from one `TreeParams` object (`frontend/src/lib/solver/engineTree.ts` and `treeConfig.ts`), so they cannot describe different spots.
  The API rebuilds the tree from a strict whitelist (`EngineTreeValidator`) and stores it in the gametree blob.
  The client describes WHAT the tree is; the worker owns HOW it is solved (accuracy target, iteration cap, time budget, threads, memory limit), so a public endpoint never hands a budget to a solver.
- `SolveJob.Solver` is `pio` or `htsolver`, chosen at upload from `Solve:Solver:HandHistory` (uploads with seat metadata) and `Solve:Solver:Sim` (the rest), both defaulting to `pio`.
  Flipping the App Service setting is the rollout and the rollback, with no deploy.
  ICM uploads and uploads without an engine tree always go to Pio.
  An admin may override per request (`localStorage["ht.solverOverride"]` in the browser), which is how one hand gets solved by both for comparison, and `POST /api/solvejobs/reroute` moves jobs still queued for the other solver.
- Each solver has its own claim route: `POST /api/solvejobs/claim` hands out only `pio` jobs and `/claim/htsolver` only `htsolver` jobs.
  A watcher can therefore never pop a job it cannot run, and a new worker pointed at an older API gets a 404 rather than Pio's work.
- `watcher/ht_solve_watcher.py` solves with `engine.exe` and converts on the machine that holds the artifact: `engine dump-streets` writes one JSON document per street, and `watcher/ht_bundles.py` adapts those into the dicts `watcher/extraction.py`'s builders already consume.
  **Schema 4 has exactly one definition, `extraction.py`, for both solvers**; do not add a second `.hta`-to-schema-4 implementation.
  A flop artifact is 3 to 6 GB with tens of thousands of river streets, which is why it cannot go through the API and why only the flop and the turns are uploaded.
- **Rivers are on demand.**
  `POST /api/noderequests` reads the board's manifest and routes on `manifest.engine.solver`: htsolver boards go to their own Storage Queue (`noderequests-htsolver`), Pio boards go where they always went.
  The worker keeps each `.hta` under an LRU disk budget and serves a river street in about a tenth of a second.
  A worker that does not hold the artifact (evicted, or solved on another box) re-solves it from `solve.json` beside the manifest, pinned to the iterations the original solve ran; the engine is bitwise deterministic at a fixed iteration count, so the re-solved river is byte-identical to one served from the original (verified end to end).
- **Index writers stay single.**
  The Pio watcher is the only writer of `piosolutions-index.json`.
  The htsolver worker never writes an index: it sends the entry with its status report and the API upserts `enginesolutions-index.json` with an ETag-conditional write (`EngineSolutionsIndex`), the same blob `/compare` publish mode uses, merged at read time.
- **Hand-history privacy rides on the `SolveJobs` row, not on the files.**
  `PostflopLibraryOverlay` shows a hand-history board only to its owner by matching the row's coordinates, so a job's `ResultStacks` / `ResultNodeName` are set when it is inserted, not at Done; a board published before its row had coordinates would list publicly with real names and hole cards.
- The solve-time notice is measured, not promised: `SolveJobTimings` reports the median claim-to-Done time of recent solves of the same solver and kind (`typicalSeconds`), and the frontend prints that.
- **A running solve reports its accuracy, and that is also a measurement.**
  The engine prints one line per checkpoint (`iter N ... (X% of pot) ...`) and flushes it, because under a worker its stdout is a pipe and an unflushed line arrives at exit.
  The worker parses it (`engine_proc.parse_progress_line`) and sends `{iteration, exploitablePct, targetPct}` on a keepalive at most every five seconds; the API keeps the last one on the `SolveJobs` row (cleared when a stale claim is requeued) and `GET /api/solvejobs/{id}` returns it as `progress`, which the pending card on `/solutions` prints under the elapsed time.
  There is deliberately no bar and no time-to-finish: accuracy falls fast and then slowly, so either would be a promise the numbers do not make.
  PioSOLVER jobs report none, and the field is null rather than zero until something has been measured.
- **A solve that runs out of time is published, labelled, not failed.**
  The engine stops cleanly at its time budget and the worker publishes what it has; `manifest.engine` then carries `converged: false` with `exploitable_pct_pot` and `target_exploitable_pct` (`ht_bundles.solve_accuracy`), and the `/solutions` line strip shows "Stopped early" with that accuracy as a percent of the pot and in chips.
  Honesty lives in that label, so three things hold: a solve that never measured its accuracy still fails (there is no number to print), a board rebuilt from a pinned re-solve is judged against the ORIGINAL target from `solve.json` (a pinned solve has none, and would otherwise shed the label), and a manifest without the keys makes no claim, which is every Pio board and every htsolver board from before them.

The engine builds PioViewer's tree for the same panel settings through three opt-in tree options (`add_allin` per seat, `add_allin_max_pot_ratio`, `merge_similar_pct`), pinned line for line against PioViewer's own scripts in `watcher/fixtures/pio_trees/` (`engine/tests/test_pio_parity.cpp`).
Known differences: one-chip rounding on exact half-chip ties (Pio rounds the total half-to-even, the engine rounds the increment half away from zero), and `merge_similar_pct`, whose rule no PioViewer output on disk exercises yet.

Putting the worker on a server (install, the bench to run first, the Scheduled Task, updates) is `watcher/deploy/README.md`.
Still to do after the switch is trusted: delete the C# `EngineSolutionExporter`, `POST /api/engine/import` and the API's `publish-artifact` conversion, and route `/compare` publish mode through `ht_bundles`.

**Building the engine on Windows: always `engine/build.ps1`** (it bootstraps vcvars64 via VsDevCmd, then CMake+Ninja).
Never call cl, cmake, or ninja directly - they are not on the ambient PATH.

Validation: Kuhn + Leduc convergence tests run in CI (`.github/workflows/engine-ci.yml`); the PioSolver comparison harness is `watcher/engine_compare.py` (needs Pio on Josh's box).

The **compare-job pipeline** makes both solvers reachable from the frontend anywhere:
`/compare` -> `POST /api/enginecompare` (EngineCompareJob row, mirror of the SolveJobs queue) -> `watcher/engine_compare_watcher.py` on Josh's PC claims it (X-Watcher-Key), solves with htsolver, and either
(a) `compare` mode: also solves the identical tree in Pio (`--solve-pio`) and uploads the per-hand comparison to ADLS `enginecompare/{id}.json.gz`, which the API proxies back to `/compare`; or
(b) `publish` mode (admin-only): POSTs the artifact to `/api/enginecompare/{id}/publish-artifact`, where the API converts it to schema-4 bundles, uploads them under `piosolutions/`, and upserts `enginesolutions-index.json` - a separate index blob merged into `piosolutionsIndex` at read time so the Pio watcher stays the sole writer of `piosolutions-index.json`.
Publish mode is the transition path to dropping PioSolver: once htsolver is trusted, solve jobs flow through it and the frontend needs no changes.
A `compare` job may also carry a `sampledConfig`: the same tree on htsolver's sampled-deal core (`algorithm.family: "sampled"`, isomorphism off), which the watcher solves AFTER the vectorized run (never beside it, so the timings stay clean, and never from a checkpoint) and uploads as a third blob, `enginecompare/{id}.sampled.htc.gz`, served by `/result/sampled`.
Both artifacts stamp a per-checkpoint `metadata.convergence` trace, and `/compare` draws the two cores' exploitability against solver time with the shared target - the honest answer to "which core converges faster" is time to that target, never iteration counts, which mean different work on the two cores.

A fourth mode, (d) `multiway`, carries **multiway POSTFLOP** (engine M8b): `POST /api/enginecompare` with `mode: "multiway"`, a real 3/4/5-card board and 3 to 9 players.
It writes **the same `.htc` payload a `compare` job writes** (`watcher/engine_compare_watcher.py` `handle_multiway` -> `engine_compare.py --ht-out`, no Pio flags), so `/compare` renders a 3-way solve in its own viewer - one line strip, one grid per loaded solver, one per-hand breakdown - with no multiway-specific view and no seat count anywhere in the render path.
That is the whole reason the payload is shared: a second shape means a second viewer, and a second viewer drifts.
It is htsolver-only because Pio cannot build an N-seat postflop tree at all, which is a different fact from Pio being disabled.
`/compare`'s builder queues one whenever its `Players` control is 3+.
The seat count IS the builder's ranges: `BuilderState.midRanges` holds one starting range per seat between OOP and the button, `TreeBuilding` renders one range card per seat in acting order (OOP / MID / BTN, named by `seatNamesFor` in `frontend/src/components/treeBuildingView.ts`, the same names the engine config and `metadata.seats` carry), and `buildEngineConfig` emits one player per range plus the core the count requires.
The count control itself stays on `/compare` rather than inside `TreeBuilding`, since that panel is shared with the PioSOLVER upload path where there is no such choice; the two heads-up-only callers simply leave `midRanges` out.
Two things the seat count changes, both stated by the payload rather than inferred: `spot.seats` names the seats, so the line strip says OOP/MID/BTN and the root-EV row shows one number per seat plus their sum against the pot (chip conservation is the first thing a MonkerSolver comparison checks); and each node carries its own pooled `pot`, because the colon node id names the betting LEVEL and turning a level into a pot needs to know how many seats matched it, which a fold makes unanswerable past two.
The SEAT COUNT also picks the engine core, and the API checks it at queue time rather than letting the watcher fail twenty minutes later: 2-3 seats have an exact vectorized showdown, 4+ require `algorithm.family: "sampled"`, and past three seats there is no nashconv and no per-hand EV - the artifact says so in `metadata.per_hand_ev`, `dump-json` omits the EV keys, and the payload's EV columns are null rather than the zeros the blobs hold.
Multiway jobs solved before 2026-09-07 hold the old `dump-json --fields rollup` JSON instead; `/compare` sniffs the payload rather than the mode and falls back to the legacy rollup view for those (`frontend/src/pages/multiwayPostflop/MultiwayResultView.tsx`), which nothing produces any more.

A third mode, (c) `pushfold`, carries the **multiway preflop** solver (engine M8a): `/multiway` -> `POST /api/enginecompare` with `mode: "pushfold"` -> the watcher solves an N-seat jam-or-fold tree with htsolver and uploads `engine.exe dump-json` output, which `/result/ht` serves back to the page.
It takes no `config.board` and never involves Pio - not because Pio is disabled but because Pio is heads-up postflop and cannot build a 4-way preflop tree at all - and it does not go through `EngineSolutionExporter`, whose schema-4 bundle contract is `oop`/`ip`-keyed and correctly refuses a 4-seat artifact.
The artifact's own 169-class rollup is the push/fold chart, so `/multiway` renders it with the same `DecisionMatrix` as `/solutions`.
Team solves also carry `metadata.team_joint`, the exact joint strategy over the 93,769 suit orbits of the (own, partner) hand pair; `/multiway` conditions a team seat's chart on the partner's exact cards with it and the session simulator plays it (engine `team_joint_json`, frontend `src/lib/sessionSim/orbits.ts`).

**`/multiway` and `/compare` are the two engines**, and the segmented control at the top of `/multiway` is what makes that legible: multiway preflop (sampled board runouts, no hand bucketing) versus heads-up postflop (exact).
Neither has a NavBar slot; both are URL-only.
`/multiway` also carries the **session simulator** (`frontend/src/lib/sessionSim/`, drawer in `frontend/src/pages/multiway/SessionSimulator.tsx`): it plays a rotation of team solves hand by hand in workers and reports session shape, bb/100, downswing depths and bust odds - see `frontend/src/pages/multiway/CLAUDE.md`.

Out of scope, recorded so it is not built speculatively: GPU code, hand abstraction/bucketing, TMECor (coordination without card visibility), any cloud SDK inside the engine.
QRE, multiway solving, and collusion modes are scheduled follow-ups whose config schema already exists - see `engine/CLAUDE.md`.

## Commands

- Frontend: `cd frontend && npm run dev` (dev) | `npm run build` (build/type-check)
- Backend: `cd backend && dotnet run` | migrations: `dotnet ef migrations add <Name>` then `dotnet ef database update` (requires the .NET SDK, not just the runtime); tests: `dotnet test backend/HoldemToolsAPI.sln` (also run by `.github/workflows/backend-ci.yml`)
- Engine: `cd engine && ./build.ps1 -Test` (Windows; see the build rule above)
- Watcher: `cd watcher && python -m pytest -q` (fakes only, no Pio and no Azure; also run by `.github/workflows/watcher-ci.yml`)

## Frontend environment variables

`frontend/.env` is **generated, not authored**.
The one editable copy lives outside the repo, at `~/.holdemtools/env/frontend.env`
(override the directory with `HOLDEMTOOLS_ENV_DIR`).
`frontend/scripts/ensure-env.mjs` copies it into place and is wired to `predev`,
`prebuild`, and `pretest:e2e`, so `npm run dev` and `npm run build` just work.
Run it on its own with `npm run env:check`.

**Edit the canonical file, never `frontend/.env`** - the latter is overwritten on
every run (a diverging copy is saved to `frontend/.env.bak` once, then clobbered).

For the handful of settings that are genuinely **per-checkout**, write a
`frontend/.env.local`.
Vite loads it at higher precedence than `.env`, `ensure-env.mjs` never touches it,
and `.gitignore` already covers it.
`VITE_DEV_PORT` is the case that matters: every worktree receives the same
generated `.env`, and `strictPort` means two dev servers on 5173 fail rather than
drift, so a second worktree needs `echo "VITE_DEV_PORT=5174" > frontend/.env.local`.
A shell export beats both.
`playwright.config.ts` resolves the port through the same `loadEnv` call as
`vite.config.ts`, so `npm run test:e2e` follows the override instead of attaching
to a neighbouring worktree's server via `reuseExistingServer`.

This exists because `.env` is gitignored and therefore does **not** travel to a
`git worktree`.
A fresh worktree would otherwise start with no config at all, every
`import.meta.env.VITE_*` would read `undefined`, and Firebase would throw on
`initializeApp` or half-initialize silently.
Copying the file into each worktree by hand fixes that once and then rots, since
a key added in one worktree is silently missing from the others.
Deriving the in-repo copy from a single source makes that drift structurally
impossible.

`frontend/.env.example` **is committed** and is the manifest of what the app needs.
Because it is tracked it reaches every worktree for free, which is what lets a
missing key fail loudly at `npm run dev` instead of becoming an `undefined` at
runtime.
An uncommented key there is required; a commented-out key is optional.
**Add every new `VITE_*` var to it**, or `env:check` will warn that it is undocumented.

No values are committed.
Every `VITE_*` is inlined into the client bundle and shipped to browsers, so none
of them are secret in the cryptographic sense, but this repo is public and keeping
them out of it stops bots trawling GitHub from pointing a local app at the real
`gto-lite` project and burning its auth quota.
The controls that actually protect the project are the Firestore rules, HTTP
referrer restrictions on the browser API key, and App Check - not the gitignore.

The script no-ops in two cases, so it never breaks a build that does not need it:
when `USE_FIREBASE_EMULATOR=true` (the emulators supply their own offline config
and ignore `.env` entirely), and when every required variable is already present
in `process.env`, which is how Vercel and CI inject them.
The second check keys off the variables themselves rather than a vendor flag, so
it holds for any host, and a partially-configured CI still fails rather than
silently building with half a config.

## Firebase emulators (Claude Code cloud sessions)

Cloud sessions (claude.ai/code) clone from GitHub only, so the gitignored `frontend/.env` -
and with it every `VITE_FIREBASE_*` value - does not exist there.
Rather than shipping credentials, those sessions run the **Firebase Emulator Suite**.

Everything is gated behind a single flag, `USE_FIREBASE_EMULATOR=true`.
**When the flag is unset, nothing changes**: local dev and Vercel builds talk to the real
`gto-lite` project exactly as before.

| Emulator | Port | Notes |
|---|---|---|
| Auth | 9099 | |
| Firestore | 8080 | Needs a JRE - it is a Java process |
| Emulator UI | 4000 | Browse seeded users and documents |
| Hub | 4400 | Used as the "already running?" check |

Ports are fixed in `firebase.json` so the config is reproducible.
The emulators run under project id **`demo-gto-lite`**: Firebase treats a `demo-` prefix as
strictly offline, so the emulators never ask for credentials and the SDKs can never
silently fall back to the real project.

### Testing it

One command, no lifecycle to manage - it starts the emulators, seeds them, drives the real
client SDK through sign-in / tier resolution / Firestore reads and writes / rules enforcement,
then shuts everything down.
Exits non-zero on any failure.

```bash
cd frontend && npm run test:emulators   # needs firebase-tools on PATH
```

### Running it for development

```bash
firebase emulators:start --project demo-gto-lite --only auth,firestore   # terminal 1
cd frontend && node scripts/seed-emulators.mjs                           # terminal 2, idempotent
USE_FIREBASE_EMULATOR=true npm run dev
```

When driving the dev server by hand, export `VITE_STRIPE_PRICE_ID_PRO=price_pro_emulator`
(and `_PLUS`) first, so the app and the seed agree on the price ids - see the tier note above.
`npm run test:emulators` does not need this: both halves import the ids from the seed module.

In cloud sessions all three steps happen automatically via the `SessionStart` hook
`.claude/hooks/start-firebase-emulators.sh`, which no-ops unless `CLAUDE_CODE_REMOTE=true`.

### Seeded accounts

Password for all three is `emulator-password`.

| Email | Tier |
|---|---|
| `thejoshgarber@gmail.com` | pro, and matches `Admin:Emails` so admin paths are reachable |
| `pro@holdemtools.local` | pro |
| `free@holdemtools.local` | free |

The seed also writes the `products` / `prices` catalog and `courseProgress` docs, so
`useTier` and the Course pages resolve without a live Stripe extension.

Tier resolution is the one place the seed and the app have to agree on a value.
`useTier` compares each subscription's price id against `getPriceIdForTier()`, which reads
`VITE_STRIPE_PRICE_ID_PRO` / `_PLUS` - if those are unset it returns `null` and **every user
resolves to free**, no matter what is seeded.
So emulator sessions must set them to the same fakes the seed falls back to,
`price_pro_emulator` and `price_plus_emulator`.
They are not secrets, just matching identifiers.

### Wiring notes

- The flag has no `VITE_` prefix (the backend and the scripts read it too), so
  `vite.config.ts` bridges it into the bundle through `define`, alongside `VITE_VERCEL_ENV`.
- `src/lib/firebase.ts` swaps in a demo config and calls `connectAuthEmulator`;
  `src/lib/firestore.ts` calls `connectFirestoreEmulator`.
- The seed and verify scripts live in `frontend/scripts/` rather than `firebase/` because
  both import npm packages, and this repo has no root `package.json` for Node to resolve
  them from. `firebase/` holds only `firestore.rules`.
- The seed uses `firebase-admin` (a devDependency, never bundled) and reaches the emulators
  purely through `FIREBASE_AUTH_EMULATOR_HOST` / `FIRESTORE_EMULATOR_HOST`. It also sets
  `METADATA_SERVER_DETECTION=none`, without which the Admin SDK probes the GCP metadata
  server for credentials it does not need - a network call that can stall in a container.
- The API does **not** use the Firebase Admin SDK, so `FIREBASE_AUTH_EMULATOR_HOST` has no
  effect on it. `Program.cs` instead has an explicit emulator branch that accepts the
  emulator's *unsigned* (`alg: none`) tokens while still checking issuer, audience, and
  expiry. Never set `USE_FIREBASE_EMULATOR` on a deployed instance.
- Not emulated: **Functions**. The only callables the app uses belong to the deployed
  "Run Payments with Stripe" extension, whose source is not in this repo, so Stripe
  checkout and the billing portal are unavailable in emulator sessions.
- `VITE_DEV_AUTH_BYPASS` (see `src/lib/devAuth.ts`) must stay unset when using the
  emulators - it short-circuits `authedFetch` with a mock token and would shadow the
  real emulator session.

## History note

`frontend/` and `backend/` were merged in from separate repositories with `git filter-repo`
(`--to-subdirectory-filter`) so every commit's original author, email, and date were preserved.
Each original repo's `.github/workflows` moved into its subfolder during the merge, so no old
deploy workflow runs at the monorepo root.
Root-level deployment is wired up separately.
