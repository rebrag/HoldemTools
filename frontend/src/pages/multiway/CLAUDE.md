# /multiway - the multiway preflop page

Solve queueing and result viewing for htsolver's sampled preflop core, plus the session simulator.
Solve semantics (lineages, baselines, one result per solve id) are documented in the root `CLAUDE.md` and `engine/CLAUDE.md`; this file covers what lives in this folder.

| File | Role |
|---|---|
| `MultiwaySolver.tsx` | The page: header, Recent strip, table, result panel, tree-builder drawer, polling |
| `compareJob.ts` | A job row as the API returns it (with its `spot` summary) and the shared "openable / finished" readings |
| `solveIdentity.ts` | How a solve is described to a person: phase (P1 baseline / P2 team SB+BB), stacks, spot key and title |
| `SolvesDrawer.tsx` | Every solve, sectioned by spot with phase badges and filters, plus the saved groups; exports `PhaseBadge` |
| `solveGroupsApi.ts`, `useSolveGroups.ts` | Client and page-level store for `/api/solvegroups` |
| `MultiwayTreeBuilder.tsx`, `multiwayView.ts` | The spot being built and the config it becomes |
| `PushFoldResultPanel.tsx`, `pushfoldResult.ts` | A result payload (`PushFoldDump`) and its charts |
| `fetchPushFoldDump.ts` | One job's payload from the API; shared by the panel and the simulator |
| `SessionSimulator.tsx` | The simulator drawer: rotation list, group load/save, parameters, results |
| `useSessionSimulation.ts` | Worker pool behind it |
| `SessionFanChart.tsx`, `DrawdownChart.tsx` | Its two recharts charts, lazy-loaded |

## Telling solves apart

The Recent strip shows only the newest few; the Solves drawer ("All solves") is the whole library.
Every row is described the same way everywhere, from `solveIdentity.ts`:
a phase badge - **P1** is the spot's no-team baseline, **P2** is a hand-sharing team named by its seats (`team SB+BB`, with `(aware)` when the opponents adapt) - then the spot (`4-way 10bb`), iterations and age.
That comes from `job.spot`, which the API parses out of the stored config (`PushFoldSpotSummary` server-side), so rows from before any of this exist have it too.
The drawer sections rows by `spotKey` (seats, stacks, blinds, button; not the team), which is also what a rotation has to share.
Board cards and ICM are not in the summary yet; when the config grows them, add them to the summary and to `spotKey`.

## Groups

A group is a saved rotation: a name and an ordered list of job ids (`SolveGroupsController`, `SolveGroups` + `SolveGroupMembers` tables).
Members are job ids rather than solve ids because a job is what has a result to play and older rows carry no solve id; when a newer job supersedes an older one of the same lineage, the watcher's report handler re-points the slots, so a group follows its solves as they converge.
The simulator loads a group into its rotation, saves a rotation as a group (or updates the one it came from), and remembers the last group in `localStorage` so the next visit starts on it.
The drawer renames, deletes and hands a group to the simulator through `SessionSimulatorHandle.loadGroup`.

## Session simulator

The core is React-free in `src/lib/sessionSim/` and the worker is `src/workers/sessionSimWorker.ts`; `npm run check:sessionsim` exercises the core in Node against a synthetic tree with exact payoffs.

- **Rotation.** An ordered list of hand-sharing team solves of ONE spot; hand `k` of a session plays solve `k mod n`.
Two solves is a pair sitting across the table (BB+BTN, SB+CO, ...), four is adjacent seats, one is the same pairing every hand.
`validateRotation` refuses a no-team solve, a different spot (`spotSignature`: seats, stacks, blinds, button, tree shape) and a payload without `team_rollup`.
- **A hand.** Fresh deal, stacks reset.
Frozen seats play their `rollup_169` row (exact preflop: the 169 classes are the suit orbits), the team its conditioned `team_rollup[partner class][own class]` chart, falling back to the marginal row where a conditioning has no data.
Showdowns are scored with `phe` on integer card codes and paid as layered pots, so unequal stacks stay correct.
The hand's result is the team seats' net chips summed.
- **Sessions** are bootstrapped from each solve's pool of per-hand results and never stored: every session is walked once and sampled at 250 checkpoints (cumulative result, running biggest downswing, running minimum), plus exact end-of-session scalars.
- **Definitions.** Downswing = largest peak-to-trough fall of the cumulative team result inside a session, with the peak starting at 0.
Bust = the cumulative result touches minus the bankroll at any hand of the session.
The long-run risk of ruin is the Brownian approximation `exp(-2 mu X / sigma^2)`, labelled as such.
- **Sanity check that ships.** Each entry's simulated bb/100 is shown beside the artifact's own sampled team EV; they should agree within a couple of standard errors.
A larger gap means the payload and the play disagree, which is a bug, not variance.
- **Determinism.** The task list and every chunk's seed are fixed from the run seed, so the same seed gives the same numbers on any core count.
- **Workers.** Cancel is `terminate()` (the loops are synchronous); every worker is in `poolRef` and terminated on unmount.
The simulator component stays mounted while the drawer is closed so a run survives closing it.
