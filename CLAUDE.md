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

## History note

`frontend/` and `backend/` were merged in from separate repositories with `git filter-repo`
(`--to-subdirectory-filter`) so every commit's original author, email, and date were preserved.
Each original repo's `.github/workflows` moved into its subfolder during the merge, so no old
deploy workflow runs at the monorepo root.
Root-level deployment is wired up separately.
