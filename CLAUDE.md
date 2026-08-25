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
| `watcher/` | Python + pywinauto + PioSOLVER | `rebrag/GTOLite-Helper-Script` (archived; snapshot copy, history stays there) | Postflop solve pipeline: runs on Josh's PC, solves uploaded gametrees with Pio, uploads solution blobs to ADLS |
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

**Building the engine on Windows: always `engine/build.ps1`** (it bootstraps vcvars64 via VsDevCmd, then CMake+Ninja).
Never call cl, cmake, or ninja directly - they are not on the ambient PATH.

Validation: Kuhn + Leduc convergence tests run in CI (`.github/workflows/engine-ci.yml`); the PioSolver comparison harness is `watcher/engine_compare.py`, a manual dev tool that needs Pio on Josh's box.

Out of scope, recorded so it is not built speculatively: GPU code, hand abstraction/bucketing, TMECor (coordination without card visibility), any cloud SDK inside the engine.
QRE, multiway solving, and collusion modes are scheduled follow-ups whose config schema already exists - see `engine/CLAUDE.md`.

## Commands

- Frontend: `cd frontend && npm run dev` (dev) | `npm run build` (build/type-check)
- Backend: `cd backend && dotnet run` | migrations: `dotnet ef migrations add <Name>` then `dotnet ef database update` (requires the .NET SDK, not just the runtime); tests: `dotnet test backend/HoldemToolsAPI.sln` (also run by `.github/workflows/backend-ci.yml`)
- Engine: `cd engine && ./build.ps1 -Test` (Windows; see the build rule above)

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
