# HoldemTools — monorepo

This is a **single git repository** containing the HoldemTools frontend and backend side by side,
so cross-cutting (frontend + backend) changes can happen in one commit and one Claude Code session.

The repo was created by merging two previously separate repositories, with their **full commit
history preserved** under the `frontend/` and `backend/` subfolders.

## The two subprojects

| Folder | Stack | Original repo | Role |
|---|---|---|---|
| `frontend/` | React + TypeScript + Vite + Tailwind | `rebrag/GTOLite` | Frontend web app |
| `backend/` | .NET 8 Web API + EF Core + SQL Server | `rebrag/HoldemToolsAPI` | Backend API (namespace `PokerRangeAPI2`, assembly `GTOLiteAPI`) |

Each subfolder keeps its own `README.md`, and `frontend/` keeps its own `CLAUDE.md` with
frontend-specific conventions.
Defer to those for subproject-specific rules.

Hosting: frontend on Vercel, API on Azure App Service.
Solver data is served from Azure Data Lake.

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

## Commands

- Frontend: `cd frontend && npm run dev` (dev) | `npm run build` (build/type-check)
- Backend: `cd backend && dotnet run` | migrations: `dotnet ef migrations add <Name>` then `dotnet ef database update` (requires the .NET SDK, not just the runtime)

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
