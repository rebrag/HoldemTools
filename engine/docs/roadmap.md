# htsolver roadmap

The durable copy of where this project is going, so no session loses the plot.
The full original spec lives in the engine bootstrap prompt (session plan file `~/.claude/plans/c-users-thejo-downloads-engine-bootstra-crispy-pike.md` on Josh's machine); this file is the repo-resident summary and is the one to keep updated.

## The goal product

htsolver replaces PioSolver in the HoldemTools pipeline.

- The watcher picks up a gametree job, solves it with **htsolver**, uploads schema-4 bundles, and frontend users browse the result in `/solutions` - exactly today's flow with Pio swapped out. The plumbing already exists: publish-mode `EngineCompareJob`s do this for river spots now.
- Pio is retired once htsolver is trusted **as much or more than Pio**. Trust is earned through the `/compare` loop: every spot solvable by both, compared per hand, gated on cross-exploitability.
- htsolver's differentiators over Pio/Monker (the reason it exists): **QRE** (per-player rationality, lambda fitting), **3+ players** (NashConv, side pots), **configurable cooperation/collusion** (seat->agent partitions, payoff weights, Bayesian unknown-collusion). Everything else is table stakes.
- Hard boundaries that never change: the engine is a headless CLI with zero cloud/Firebase/GUI dependencies; artifacts are local files; upload/index/serving is the backend + watcher's job; Firebase is auth-only.

## Milestones

Done:

- **M0-M2** - engine skeleton, Kuhn (analytic equilibrium) and Leduc (convergence curve) gating in CI.
- **M3** - HU NLHE river Nash: vectorized CFR over the public tree, DCFR default, memory estimator + dry-run, Pio-style accuracy stop (`target_exploitable_pct`).
- **M4** - versioned `.hta` artifact (spec `docs/artifact-format.md`) + C# reader with committed round-trip fixture.
- **M5** - Pio validation harness (`watcher/engine_compare.py`). Primary gate = **cross-exploitability** (htsolver strategy loaded into Pio via set_strategy, rated by Pio's MES; never lock_node - locked nodes read 0.000). Per-hand L1/EV are diagnostics only (equilibria are not unique). `--solve-pio` builds the engine's exact tree in Pio over UPI, validated node-for-node. First pass 2026-08-25: 0.015 chips exploitable per Pio.
- **M6** - render path: schema-4 exporter, `/solutions` renders engine solves; hidden `/compare` workbench (side-by-side grids, ActionSummary, HandBreakdown, per-combo table, tree builder).
- **M6.5** - compare-job pipeline: `/compare` -> `POST /api/enginecompare` -> `engine_compare_watcher.py` on the Pio machine -> results to ADLS. `publish` mode (admin-only) = htsolver-only solves into the solutions library. Deployed and working.

In progress:

- **M6.6 - multistreet validation (flop -> river)** - the original spec's "after river passes: turn, then small flop trees". Largely landed 2026-08-25:
  Engine: chance nodes between streets, per-street/per-seat sizing incl. OOP donks + `preflop_aggressor`, all-in runout chains, per-runout showdown evaluators (lazy cache). **Turn-to-river PASSED**: root EVs matched Pio to 3 decimals; cross-exploitability 0.016 chips (Pio's own solve: 0.015) on `configs/validate_turn_fullrange.json`.
  Harness: multistreet `add_line` (token = hand-cumulative total per action, checks repeat the total - a mid-line 0 after chips are in crashes Pio), card-segment node ids, `calc_global_freq`-weighted diagnostics, and the node-budget policy (full compare + cross-check <= `--full-limit` decision nodes, else deterministic sampled runouts with a root-EV gate). pyosolver now raises instead of spinning when Pio dies mid-command.
  Frontend: per-street sizing inputs on `/compare` follow the board length (3/4/5 cards).
  **Flop-to-river PASSED** 2026-08-26 (`configs/validate_flop_small.json`, 85k decision nodes, 1.7GB, ~10.5 min): tree verified node-for-node against Pio (106 betting nodes), root EV 45.276 vs Pio 45.289 (0.013 chips apart, threshold 0.5).

  Per-hand EV agreement after the convention fix below: **turn 0.161 chips**, **flop 0.649 chips** (from 23.9 and 33.4 respectively). The flop residual is larger because that spot targets 0.1% of pot exploitable versus the turn's 0.02% - five times looser convergence - and is measured on sampled runouts. Tighten the budget if a closer number is wanted.
  Remaining: solver **multithreading over chance branches** is the obvious next perf step for flop-sized trees (a single flop tree is minutes, and full mode needs trees under a few thousand decision nodes); the viewer-facing bundle exporter (publish mode) is still river-only.

  Diagnostic weighting is load-bearing here. Per-hand L1/EV are weighted by `gfreq * min(engine reach, pio reach)`: a (node, hand) that either solver never reaches is off-path for that solver, where its strategy is unconstrained by equilibrium and its `calc_ev` is conditioned on a zero-probability event (Pio has been observed returning -381 chips there). Comparing off-path numbers measures which equilibrium was picked, not correctness.

  **The multistreet EV-convention bug (found 2026-08-26, fixed).** The artifact's per-hand EV was "pot share minus *future* contributions", treating already-committed chips as sunk. Pio's `calc_ev` subtracts *all* post-root contributions. The two agree at a street root and diverge by exactly the actor's commitment everywhere else - invisible in river-only validation, and worth ~33 chips of apparent per-hand disagreement on a flop tree. Since the viewer's schema-4 bundles carry Pio's numbers for every Pio-solved board, publishing engine EVs under the other convention would have made the same field mean two different things in one library. The engine now uses Pio's convention; `docs/artifact-format.md` states it and says why.

Next (config schema already carries the keys; do not re-plumb):

- **M7 - QRE**: entropy-regularized CFR (`qre.mode`, per-player lambda, annealing schedules), `fit-lambda` subcommand (MLE from observed frequency counts). A QRE artifact must never be compared to Pio (the harness refuses).
- **M8 - multiway (3+ players)**: N-seat public tree, fast side-pot terminal path (`showdown_share` is the correct-but-slow reference), NashConv already generalizes. `multiway_no_nash_guarantee` stays surfaced - CFR converges to coarse correlated equilibria with 3+ players.
- **M9 - collusion, best-response mode first**: seat->agent partition + payoff-weight matrices, joint-range representation (1326x1225 - river-only on 16GB), frozen-opponent team best response.
- **M10 - Bayesian unknown-collusion**: chance root over team type with probability p; opponents' infosets span branches; honest branch keeps seats independent (the coordination-failure trap). Own pass with LP-verifiable toy games.

Out of scope, permanently (do not build speculatively): GPU, hand abstraction/bucketing, TMECor / coordination-without-card-visibility, cloud SDKs inside the engine.

## Working agreements

- Correctness before speed, speed before scale. Every solver change re-passes Kuhn/Leduc CI and a Pio cross-check on at least one spot.
- The artifact format is a versioned contract; changes move the spec, both readers, and the fixture in one commit.
- The 16GB dev box is the memory budget; the estimator must not drift from reality.
