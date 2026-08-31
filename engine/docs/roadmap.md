# htsolver roadmap

The durable copy of where this project is going, so no session loses the plot.
The full original spec lives in the engine bootstrap prompt (session plan file `~/.claude/plans/c-users-thejo-downloads-engine-bootstra-crispy-pike.md` on Josh's machine); this file is the repo-resident summary and is the one to keep updated.

## The goal product

htsolver replaces PioSolver in the HoldemTools pipeline.

- The watcher picks up a gametree job, solves it with **htsolver**, uploads schema-4 bundles, and frontend users browse the result in `/solutions` - exactly today's flow with Pio swapped out. The plumbing already exists: publish-mode `EngineCompareJob`s do this for river spots now.
- **BOTH delivery models, and this is a product requirement rather than a nice-to-have.** A precomputed library covers the common spots, AND users solve their own trees **on demand**. Do not plan as though precomputing removes the latency constraint - it does not, and a plan that assumes it will reach the wrong conclusion about what to optimize. On-demand means a user is waiting, which puts solve time in the product rather than in the compute budget.
- **The intended direction for that speed is GTO Wizard AI / Ruse-style depth-limited solving, explicitly, and the motivation is MULTIWAY.** Solving one street at a time with an estimated continuation value is the only published approach that makes 3+ player trees tractable at interactive speed; GTO Wizard's own figure for street-by-street solving is a **30000x complexity reduction**, and it is what lets them do 3-way spots at all. See `docs/perf-plan.md` for what they actually do and the two routes to it (a learned value network, or a Brown-Sandholm continuation-strategy portfolio that keeps the computation exact).
- **jesolver-style optimization was the FIRST target only because it looked easier to implement, and it is now largely spent.** Five independent attacks were measured in one session and all came back neutral or negative - see M7.2. That is not a reason to abandon speed work; it is the reason the speed work moves to depth-limiting.
- Pio is retired once htsolver is trusted **as much or more than Pio**. Trust is earned through the `/compare` loop: every spot solvable by both, compared per hand, gated on cross-exploitability.
- htsolver's differentiators over Pio/Monker (the reason it exists): **QRE** (per-player rationality - *shipped, M7*; lambda fitting still to come), **3+ players** (NashConv, side pots), **configurable cooperation/collusion** (seat->agent partitions, payoff weights, Bayesian unknown-collusion). Everything else is table stakes.
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
  Remaining: the viewer-facing bundle exporter (publish mode) is still river-only.

- **M6.7 - multithreaded traversal.** Landed 2026-08-26.
  Sibling subtrees are independent - they write disjoint slices of the flat regret/strategy arrays - so `CfrSolver::traverse_impl` and the best-response walk fork their children onto a shared `ThreadPool` (`src/util/parallel.hpp`) while every cross-child fold-back stays serial and in child order.
  That last part is the point: results are **bitwise identical at any thread count**, so the PioSolver acceptance gate keeps its meaning and `tests/test_parallel.cpp` can assert exact equality rather than a tolerance.
  Measured on `configs/validate_turn_fullrange.json` (300 iterations, 9800X3D): 12.55 s at 1 thread, 4.13 s at 4 (3.0x), 1.56 s at 16 (8.0x), with identical NashConv and root EVs at every count.
  The per-runout showdown evaluators moved from a lazy cache to an eager parallel build in the game's constructor - a lazy map is a data race once the traversal is threaded, and a solve touches all of them on iteration 1 anyway.

  Diagnostic weighting is load-bearing here. Per-hand L1/EV are weighted by `gfreq * min(engine reach, pio reach)`: a (node, hand) that either solver never reaches is off-path for that solver, where its strategy is unconstrained by equilibrium and its `calc_ev` is conditioned on a zero-probability event (Pio has been observed returning -381 chips there). Comparing off-path numbers measures which equilibrium was picked, not correctness.

  **The multistreet EV-convention bug (found 2026-08-26, fixed).** The artifact's per-hand EV was "pot share minus *future* contributions", treating already-committed chips as sunk. Pio's `calc_ev` subtracts *all* post-root contributions. The two agree at a street root and diverge by exactly the actor's commitment everywhere else - invisible in river-only validation, and worth ~33 chips of apparent per-hand disagreement on a flop tree. Since the viewer's schema-4 bundles carry Pio's numbers for every Pio-solved board, publishing engine EVs under the other convention would have made the same field mean two different things in one library. The engine now uses Pio's convention; `docs/artifact-format.md` states it and says why.

- **M6.8 - compact hand universe + action-major layout.** Landed 2026-08-26. **This is where htsolver overtook PioSolver.**

  Two changes, shipped together because they touch the same structures:

  1. **Compact hand universe** (`src/ranges/universe.hpp`). Every per-hand array used to be 1326 wide regardless of the configured ranges, so a 15%-range solve cost exactly as much as a 100%-range one. The solver now sizes everything by the combos with non-zero weight in at least one starting range after root-board removal - shared across seats, ascending canonical order. Exact, not an abstraction: a combo neither seat can hold has zero reach everywhere and contributes an exact `0.0` to every sum, so dropping it changes no other hand's number.
  2. **Action-major `InfosetLayout`**, `node_offset + action * hands + hand`. Every hot loop walks hands for a fixed action; hand-major made all of them stride-`actions` scatters. `average_strategy()` / `current_strategy()` still emit hand-major rows, so no consumer changed.

  **Both are bit-for-bit neutral, and that was verified rather than assumed.** Re-solving the committed fixture reproduces the golden's NashConv (`0.00039826105587081884`) and both root EVs to the last digit, and `configs/validate_turn_fullrange.json` at 300 iterations still gives `nashconv 0.232074, ev 45.9951 54.0049` - a 4-action tree with a 48-way chance node. The hand dictionary in that fixture went from ~1176 entries to 12, so the fixture pair was regenerated and `EngineSolutionExporterTests` lost a stale `handOrder.Length > 1000` assertion (`hand_order` is the solve's universe now, not every board-legal combo).

  Measured on the 20-board sweep, realistic (~15%) ranges, same accuracy target, all 20 passing the cross-exploitability gate:

  | family | before | after | memory |
  |---|---|---|---|
  | turn (4 cards) | 0.30x (Pio 3.0x faster) | **2.46x faster than Pio** (1.87-2.90x) | 13 MB vs Pio's 48 |
  | river (5 cards) | ~5x faster | **16.4x faster than Pio** (3.4-20.6x) | 7 MB vs Pio's 39 |

  Per-iteration cost on `9c 5d Jc 7s`: **5.25 ms -> 0.67 ms** with realistic ranges (7.8x). A realistic-range flop tree now estimates **266 MB** where it needed **1.80 GB**, and runs at 37 ms/iteration with a 242 MB peak.

  **The 100%-range case is the honest caveat.** Compaction has almost nothing to remove there, so the only win is the layout flip - and the same sweep at 100% ranges shows exactly that and nothing more: turn median 0.38x -> **0.54x** and river 5.15x -> **7.06x**, both a flat ~1.4x, with per-iteration cost 5.43 -> 3.93 ms. So on 100% ranges the engine is still slower than Pio on turn trees. That case is also the one nobody solves; `bench_boards.py --ranges tight` is the number that describes the product.

- **M6.9 - deferred DCFR discount + branch-free inner loops.** Landed 2026-08-26.

  1. **Deferred discount.** `apply_discounts()` used to sweep every regret and strategy entry after every iteration - pure memory traffic over data nothing else was touching, costing **12.7% of an iteration on a turn tree and 18.5% on a flop tree** (measured as dcfr vs plain rm at fixed iterations). The factors owed for iteration t are now recorded, and each decision node pays them on its first visit in iteration t+1, when its rows are already in cache for regret matching. A `u32` per-node stamp keeps it to once, `run()` settles the remainder so callers read exactly what the eager sweep left, and `iterate()` became private so nothing can read half-discounted state.
  2. **Blocked-hand lists at chance nodes.** `hand_blocks_card` was asked once per hand per card; the Game interface now also answers the inverse - `hands_blocking_card(seat, card)` - and only ~4% of a universe contains any given card. The fold-back zeroes those few entries in the child's values and then accumulates over every hand unconditionally, which is safe because adding an exact `0.0f` cannot change an accumulator that starts at `+0.0f`, and leaves a contiguous loop the compiler can vectorize.
  3. **Clamp hoisted** out of the regret/strategy update, splitting it into two branch-free bodies. `r < 0 ? 0 : r` rather than `std::max`, which keeps `-0.0f` as `-0.0f` exactly like the branch did.

  Still bit-for-bit neutral, verified on both tree shapes again: the fixture reproduces the golden's NashConv and EVs to the last digit, and `validate_turn_fullrange` at 300 iterations still gives `nashconv 0.232074, ev 45.9951 54.0049`.

  | tree | after M6.8 | after M6.9 | |
  |---|---|---|---|
  | turn, ~15% ranges | 0.706 ms/iter | **0.575** | 1.23x |
  | turn, 100% ranges | 3.93 ms/iter | **2.70** | 1.45x |
  | flop, ~15% ranges | 35.2 ms/iter | **25.3** | 1.39x |

  The gain is largest on the biggest trees, which is where the discount sweep was costliest - the arrays stop fitting in cache, so a whole extra streaming pass over them hurts most exactly where it can least be afforded.

  **Head to head after M6.8 + M6.9**, 20-board sweep at realistic (~15%) ranges, same accuracy target, all 20 passing the cross-exploitability gate:

  | family | pio / ht speed | htsolver peak | pio peak |
  |---|---|---|---|
  | turn (4 cards) | **3.36x faster than Pio** (2.03-3.66x) | 13 MB | 48 MB |
  | river (5 cards) | **18.8x faster than Pio** (13.5-22.7x) | 7 MB | 39 MB |

  Where this started: turn 0.30x (Pio 3.0x faster) and river ~5x. The turn family moved by **11x**.

### Two harness bugs found while verifying the above

Both were found by chasing an iteration count that could not have moved if the engine really was bit-neutral. Recorded because each one hid the other.

- **`bench_boards.py` reported stale results.** It treated "the output file exists" as success, so a spot whose compare failed silently re-read the previous sweep's JSON and reported it as fresh. One row of an early sweep carried the numbers of a completely different run. It now deletes the file first and checks the exit code.
- **`engine_compare.py` turned a diagnostic gap into a false FAIL.** On `5c 5h 5s 2c 8d`, Pio's `calc_global_freq` underflows to `0.0` on every node - including the root, which is reached by definition - and one line reports `-5e-12`. Total diagnostic weight was therefore zero, and the harness gated on it: `FAIL: nothing compared (tree mismatch everywhere?)`. But weight only normalizes the per-hand **diagnostics**; zero weight means "we learned nothing about per-hand agreement", not "the solvers disagree". It now warns, skips the diagnostics, and lets cross-exploitability decide - which passes that board with the engine strategy rated *exactly* as exploitable as Pio's own solve (0.018 vs 0.018). `summary.diagnostics_weighted` carries the distinction into the JSON so `/compare` shows "unavailable on this board" rather than a fabricated `0.000`.

- **M6.10 - chance-child recalc schedule.** Landed 2026-08-26. **Delivers ~6-10%, not the hoped slope change - and the reasons why are the valuable part.**

  Mechanism: per (chance child, seat), cache the subtree's value vector and skip re-traversing it while (a) its last movement is small against the CURRENT error budget, (b) the opponent reach that produced the cache has not drifted, and (c) its doubling revisit period has not expired. The budget is fed back by the caller at every checkpoint (`set_recalc_budget(exploitable_chips)`) and governed by a **feedback controller**: aggressiveness starts at `algorithm.recalc.margin`, is quartered whenever a checkpoint's exploitability falls slower than sqrt-rate, and relaxes 1.5x while progress is healthy. Stalls therefore self-correct toward plain CFR instead of burning the iteration cap. Movement is measured as **range-weighted L1** (the quantity the error bound is actually made of); plain L1 over-counted by the hand count and never engaged on small games. No cache maintenance happens until the first budget arrives, so quick solves pay nothing.

  Deterministic end to end: every trigger is a function of best-response measurements and traversal values that are bit-identical at any thread count, so `tests/test_recalc.cpp` asserts the skip COUNT and the full solution are equal on 1 and 8 threads, with recalc ON. Off-mode reproduces the golden fixture bitwise. The deferred DCFR discount became a per-iteration factor history with compound catch-up, because a skipped node can now owe several discounts (signs cannot change while unvisited, so compounding is exact per schedule).

  Measured on `6s Th Qd Td` 100% ranges (the user-reported 25s board): 24.5 -> 22.7 s, same iterations, target reached. Realistic ranges on the same board: 2.33 -> 2.19 s. `recalc_skips` lands in artifact metadata so production solves show whether the schedule engaged.

  **Negative results, so nobody re-litigates them:**

  - **Fixed skip thresholds stall convergence at the threshold.** eps-value 5e-3 relative stalled a 0.02%-target solve at 0.025-0.05% of pot and burned the whole 20k cap; 2e-2 stalled at 0.2%. A frozen subtree biases the values it feeds upward by its own residual movement, full stop. Hence the annealed budget + controller.
  - **Catch-up weighting (weight a revisit's updates by the k skipped iterations) makes it WORSE.** Tried, measured, reverted: at aggressive settings it inflated iterations from 4500 to 7500 (and 6500 to 15250) - amplifying one stale sample by k overshoots under DCFR.
  - **Freezing has a hard ceiling on hard boards, and it is low.** On this tree, ~100% skipping only doubles per-iteration speed (river subtrees are ~50-75% of iteration cost; per-child fold/drift overhead remains), and every frozen iteration is lost learning that inflates the iteration count nearly 1:1. Net ceiling ~1.25x; the landed default reaches ~1.1x. **Pio's sublinear scaling on hard boards is NOT explained by runout freezing** - closing the remaining 100%-range hard-board gap needs a genuinely different update rule (sampling, alternating schemes), which is M7+ scope, not schedule tuning.

- **M6.11 - suit isomorphism over runouts.** Landed 2026-08-26, the CONTAINED design: **artifact format, C# reader, frontend and harness all unchanged.**

  A runout child is collapsed into an earlier sibling when a suit permutation maps the node's board to itself, maps the sibling's card to its own, and leaves both ranges invariant (checked weight-for-weight; an explicit-combo token like `AdQd` disables the whole feature - correct fallback, no partial collapsing). Member subtrees are never traversed: their chance-fold contribution is the representative's zeroed value vector read through a hand gather (the rep's blocked-hand zeros land exactly on the member's blocked hands, so no re-zeroing), and their regrets/strategy are never allocated. The entire compatibility story is one redirect: `average_strategy()`/`current_strategy()` on a member node return the representative's rows with hands relabeled, so best response, the export pass, the artifact writer and dump-json walk the full explicit tree and cannot tell.

  Measured, same iteration counts as iso-off (the quotient game is the same game): symmetric two-tone turn `Ah Kh 7c 2c` **1.38x** at 100% ranges (19.0 -> 13.8 s) and **1.31x** at realistic ranges; the `9c 5d Jc` flop tree **1.58x** per iteration with regret memory **203 -> 124 MB**. Pio gate PASSED on the collapsed solves (engine strategy rated 0.02/0.018 chips vs Pio's own 0.02/0.017), including the harness's node-for-node tree verification - which exercises the redirect end to end. Boards with no usable permutation (`6s Th Qd Td`, `9c 5d Jc 7s`) are **bitwise identical** to iso-off, asserted in `tests/test_iso.cpp`.

  A structural consequence worth knowing: the committed fixture pair did NOT need regeneration - river trees have no chance nodes, so both the recalc schedule and the isomorphism are inert there by construction, and the turn validation reference has no usable permutation.

### Standing after M6.10 + M6.11 (full 20-board sweep, all 40 runs passing the Pio gate)

| family, ranges | pio / ht speed (median) | before these two | htsolver peak | pio peak |
|---|---|---|---|---|
| turn, ~15% | **3.43x faster** (2.45-4.45x) | 3.36x | 14 MB | 48 MB |
| river, ~15% | **18.2x faster** (13.0-24.8x) | 18.8x (noise) | 7 MB | 38 MB |
| turn, 100% | **0.71x** (0.43-0.93x) | 0.54x | 55 MB | 64 MB |
| river, 100% | **8.1x faster** (4.0-14.6x) | 7.1x | 9 MB | 38 MB |

The sweep's hardest board (`Ks Kd 4c 9h`, which has a usable s<->d permutation) went 17.9 s -> 9.45 s at 100% ranges. Full-range turn boards remain the one family where Pio is still ahead (0.71x median, best board 0.93x - close to parity); per M6.10's negative results, closing that residual is an update-rule question, not further scheduling or collapsing.

**That last sentence was right, and M7.1 answered it.** The DCFR gamma sweep closed the family outright: re-run after the default change, 100%-range turn boards are **1.17x faster than Pio** (median over the same 10 boards, range 0.93-1.66x), all 10 passing the cross-exploitability gate. Only `Ks Kd 4c 9h` is still behind, at 0.93x. **htsolver is now ahead of PioSolver in every family it has been swept on.** The prediction that it would take an update-rule change rather than more scheduling held exactly - it just turned out to be a parameter of the rule already in use, not a different rule.

**Do not over-read that sentence: the swept families are turn and river, at tight and 100% ranges, on a two-size tree. A real user flop spot measured 2026-08-28 is still 3.8x behind Pio**, and it is worth recording exactly because it is the shape the sweep does not cover.

`8d 4c 2c`, pot 100, stacks 700 (SPR 7), ~50-60% asymmetric ranges, flop/turn/river sizes of 30/80/all-in plus raises, `max_raises` 3: **648732 nodes (248536 decision), 536-hand universe**. Same tree built node-for-node in Pio via `--solve-pio`, both to a 0.3%-of-pot target.

| | htsolver | pio |
|---|---|---|
| solve | **53.85 s** | **14.13 s** (+0.59 s tree build) |
| reached | 0.237% of pot | 0.250% |
| iterations | 100 | - |
| solve-phase peak | 1951 MB | 1818 MB |
| root EV (OOP) | 30.992 | 30.977 |

**The loss is entirely per-iteration cost, not convergence.** 100 iterations is all it needs - post-gamma convergence is excellent - but each costs **538 ms**, against ~49 ms for the 213356-node SPR 7 bench tree. Only 17% more nodes for 11x the cost. Roughly 5x of that is honest arithmetic (536 hands vs ~190 at tight ranges, and 5-6 actions per node vs 3-4); the rest is cache behaviour at a 1.4 GB regret+strategy working set.

Two things measured on this spot rather than assumed:

- **Suit isomorphism IS active here and worth 1.57x** (53.85 s on, 84.69 s off). "Asymmetric range" in the collapse rule means a range that is not suit-symmetric - one carrying an explicit combo token like `AdQd` - **not** "the two seats' ranges differ". Ranges written in class notation with weights (`AJs:0.75`) stay suit-symmetric and collapse fine. That lever is already spent on spots like this, not available.
- **`checkpoint_every` was most of the earlier user-visible complaint.** This solve stops at iteration 100, so the old hardcoded 250 could not have stopped before 250 and would have cost ~134 s - 9.5x Pio instead of 3.8x.

So the remaining gap on wide-range multi-size flop trees is the per-iteration work, and the ladder in `docs/perf-plan.md` is pointed at exactly it: i16 regret/strategy storage halves the dominant memory traffic, and the terminal-evaluator gather is the other half. Neither is convergence work, and no further update-rule tuning will touch this.

- **M7 - QRE (quantal response equilibrium).** Landed 2026-08-28. **The first differentiator over Pio to actually ship.**

  Entropy-regularized CFR, implemented as a **reward transformation inside the traversal** rather than as a replacement for regret matching. At an actor's decision node each action's counterfactual value is charged the dilated KL of the current strategy to uniform:

  `vt(h,a) = v(h,a) - pi(h) * (1/lambda) * (log sigma(h,a) + log A)`

  whose fixed point is the logit QRE. `pi(h)` is `Game::compat_weights` - the compatible-opponent-reach the counterfactual values already carry - and it is load-bearing rather than cosmetic: softmax is not scale-invariant, so regularizing the raw counterfactual value would make effective rationality vary with how often the opponent can hold a compatible hand. Scaling by `pi(h)` is what makes one lambda mean the same thing at every infoset.

  **Why the transformation and not a softmax policy.** Because only the values fed into the regrets change, `regret_matched_action_major`, the cold-path `row_from_action_major`, `average_strategy()`, `current_strategy()`, the schema-4 exporter, the C# reader and the frontend are all untouched, and the average strategy is still the answer. A softmax-over-regrets design would have had to mirror itself in both regret-matching implementations and would have changed what `current_strategy()` means. Config is `qre.mode: "qre"` plus a per-seat `qre.lambda` (1/chips; a scalar broadcasts), with optional `qre.anneal: {factor, full_at}`.

  **The stop criterion is the interesting part, and it is a correction to the obvious plan.** A fixed-lambda QRE is not Nash: perturbing a payoff by at most eps makes the perturbed equilibrium a 2*eps-Nash of the true game, so plain exploitability plateaus around `2*D*log(A)/lambda` chips and **can never reach a tight accuracy target, however long the solve runs**. `compute_qre_best_response` therefore measures exploitability in the entropy-augmented game - a smooth (log-sum-exp) maximum against an on-profile value charged the same KL - which does converge and is chip-denominated, so `budget.target_exploitable_pct` works unchanged. Charging the `ev` side too is the easy thing to miss; regularizing only the best-response side leaves a gap that never closes. Both numbers are printed and land in artifact metadata, and solve start warns when the configured lambda cannot reach the configured target.

  Measured on `configs/validate_turn_fullrange.json` at lambda 0.1 (= 10 per pot) with a 0.3%-of-pot target: the QRE gap reaches 0.235% in 500 iterations while plain exploitability sits at 6.89% and stays there. That separation is the feature, not a failure.

  **QRE is NOT faster than DCFR, and the hope that it might be is now measured and dead.** On the `LPopenBBcall` flop tree (`3s Kd Js`, pot 100, stacks 700, ~30% ranges, 414110 decision nodes), both to a 0.3%-of-pot target:

  | | iterations | wall | ms/iteration | what it reached |
  |---|---|---|---|---|
  | dcfr | 225 | **53.0 s** | 236 | 0.30% plain exploitable |
  | qre, lambda 20/pot | 525 | **195.5 s** | 372 | 0.30% QRE gap; plain exploitability plateaued at **4.09%** |

  So QRE cost **3.7x the wall clock** for a strategy that is 13.6x more exploitable in the Nash sense. Two independent factors, worth separating because only one is fixable:

  - **1.58x per iteration** (236 -> 372 ms). This is the `logf` per regret cell plus a `compat_weights` pass per actor node. It is the cost of the feature and roughly matches the 20-60% predicted up front. Fusing `log sigma` into the regret matcher (one pass producing both) and/or a vendored polynomial `log2f` would recover part of it; not attempted, since QRE is a modelling feature rather than a speed feature.
  - **2.3x the iterations.** At a soft lambda the QRE gap simply starts much higher and grinds down; the regularization is too mild here to buy the better conditioning that would pay for itself.

  **Annealed lambda saves iterations everywhere, and wall clock nowhere. Swept, not guessed.**

  The first measurement of annealing was on `LPopenBBcall` alone and looked like a 1.44x wall-clock win (225 -> 100 iterations, 53.0 -> 36.4 s). **It did not survive the sweep.** `bench_boards.py` now has a `--no-pio` engine-only mode and a `--qre-lambda` / `--qre-anneal-*` arm precisely so this could be checked; run over 4 flop + 10 turn + 10 river boards at tight ranges, both arms to the same PLAIN Nash target:

  | family, target | dcfr iters | annealed iters | iteration saving | dcfr wall | annealed wall |
  |---|---|---|---|---|---|
  | flop, 0.3% | 260 | 185 | 1.41x | 17.5 s | 22.7 s (**1.29x slower**) |
  | turn, 0.02% | 1250 | 900 | 1.39x | 0.63 s | 0.63 s (wash) |
  | river, 0.02% | 700 | 500 | 1.40x | 0.04 s | 0.04 s (wash) |
  | turn, 0.3% | 210 | 155 | 1.35x | 0.13 s | 0.17 s (1.3x slower) |
  | river, 0.3% | 105 | 80 | 1.31x | 0.01 s | 0.01 s (wash) |

  Two things are now solid, and they pull against each other:

  - **The iteration saving is real and strikingly stable: 1.31-1.41x across every family and both accuracy targets.** Iteration counts are deterministic, so this is not a noise story.
  - **QRE costs 1.44x per iteration**, measured directly rather than inferred: same flop tree, 100 fixed iterations, no accuracy stop, median of 5 interleaved runs - 4.28 s nash vs 6.17 s qre. That is one `logf` per regret cell plus a `compat_weights` pass per actor node.

  1.44x per iteration against a 1.31-1.41x iteration saving is why every wall-clock row is a wash or worse. **The `LPopenBBcall` outlier is unexplained**: its 2.25x iteration saving sits far outside the 1.3-1.4x band seen on 24 other boards. Its distinguishing features are 700-deep stacks, three bet sizes plus donks, and asymmetric ranges (which also disables suit isomorphism); none of that is obviously the cause, and one spot is not a result. The re-measurement was reproducible (36.4 / 36.9 s across two runs), so it is a real property of that spot rather than a mismeasurement.

  ### The per-iteration cost, attacked (2026-08-28). One win, four losses, and a measured floor.

  First, where the 1.44x actually lives. Same flop tree, 100 fixed iterations, recalc off, median of 5 interleaved runs - and a third arm with the `std::log` call replaced by its own argument, which keeps the memory traffic identical and removes only the transcendental:

  | arm | wall | what it isolates |
  |---|---|---|
  | nash (QRE off) | 3.99 s | the floor |
  | qre, log removed | 4.50 s | compat_weights + the transform's arithmetic |
  | qre | 5.75 s | + the log |

  So **the log is 71% of QRE's overhead** (1.25 s of 1.76 s) and everything else is 29%. The premise was right.

  **What worked: the fold-in loops were scalar because of pointer provenance, not arithmetic.** As lambdas capturing `std::vector` references, MSVC could not prove the five arrays disjoint and re-loaded every loop invariant through the capture block per element; `regret_matched_action_major` vectorizes in the same file precisely because it takes plain `float*` parameters. Extracting `plain_fold_in` / `qre_fold_in` as free functions with `ENGINE_RESTRICT` pointers and by-value invariants, plus folding `max(pi,0) * (1/lambda)` into the compat buffer once per node instead of once per cell, is **bit-for-bit neutral** and worth:

  | | before | after | |
  |---|---|---|---|
  | nash (every dcfr solve) | 4.23 s | **3.96 s** | -6.5% |
  | qre | 5.83 s | 5.77 s | -1.1%, inside noise |

  The Nash number is the real prize: it speeds up every solve the product runs, not just QRE.

  **What did not work - four attempts to make the log cheaper, every one measured SLOWER than `std::log`:**

  | attempt | qre wall |
  |---|---|
  | `std::log` (kept) | **5.75 s** |
  | vendored `2*atanh((m-1)/(m+1))`, degree 4, before the restrict work | 6.01 s |
  | the same, after it | 5.88 s |
  | divide-free degree-7 polynomial, coefficients fitted rather than recalled | 6.15 s |
  | branch skipping the log where sigma is exactly 0 (it shares one constant) | 6.02 s |

  The polynomials vectorized - `dumpbin` confirms zero `call logf` and packed ops rising from 14 to 20 - and still lost. MSVC's `logf` beats a hand-rolled approximation here, and a long Horner dependency chain is worse than a well-tuned library call in a loop that is memory-latency-bound anyway. The zero-sigma branch loses because the misprediction costs more than the calls it skips.

  **So the log cost is effectively irreducible by these means**, and the remaining levers are all things this repo has ruled out or that change the maths: SVML (compiler-specific, no GCC fallback, and its results are not stable across versions - a worse determinism story than what we have), `/fp:fast` (forbidden; it would invalidate the Pio gate), or swapping Shannon entropy for a Tsallis/L2 regularizer whose gradient is linear - which is a different equilibrium concept, not an optimization. `compat_weights`, the other 29%, has a serial `double` accumulation over the full universe per actor node; reassociating it would change every Nash solve and the golden fixture.

  **The actionable conclusion is the per-iteration cost, not the algorithm.** The iteration saving is already there and robust; only the 1.44x overhead stands between it and a genuine ~1.35x wall-clock win on every board. Both halves are reducible - fuse `log sigma` into `regret_matched_action_major` so the transcendental shares the pass that already computes sigma, and/or vendor a polynomial `log2f` (pure float ops, deterministic under `/fp:precise`, and vectorizable where `logf` is not). That is the experiment worth running next; it was skipped in this pass on the assumption QRE was a modelling feature rather than a speed one, which the iteration numbers now contradict.

  ### Flop trees at real stack depths, which is where solve time actually hurts (2026-08-28)

  The 1.31-1.41x iteration saving above was measured on turn and river trees plus one shallow flop family, all at SPR 4. Re-run on the flop family across the stack depths a player actually plays - `bench_boards.py --only flop --spr 4|7|10`, 4 boards, tight ranges, both arms to the same plain Nash 0.3% target:

  | SPR | decision nodes | dcfr iters | dcfr | qre iters | qre | iteration saving | wall |
  |---|---|---|---|---|---|---|---|
  | 4 | 170,528 | 260 | 16.5 s | 185 | 21.8 s | 1.41x | 1.32x slower |
  | 7 | 213,356 | 565 | 41.1 s | 500 | 70.0 s | **1.13x** | 1.70x slower |
  | 10 | 345,656 | 900 | 95.7 s | 845 | 182.5 s | **1.07x** | 1.91x slower |

  **The iteration saving collapses with stack depth** - 1.41x, 1.13x, 1.07x - while the per-iteration cost climbs:

  | SPR | dcfr | qre | overhead |
  |---|---|---|---|
  | 4 | 63.6 ms/iter | 117.9 | 1.85x |
  | 7 | 72.8 | 140.1 | 1.92x |
  | 10 | 106.3 | 215.9 | 2.03x |

  Both trends have the same cause. A deeper stack means more of the actor's own decision points per line, so the regularizer is charged at more nodes per iteration (cost up), while the homotopy's fixed head start becomes a smaller fraction of a solve that now needs 900 iterations instead of 260 (saving down). The QRE overhead on flop trees is **1.85-2.03x**, not the 1.38x measured on the small fixed-iteration A/B - that tree was SPR 4 and shallow.

  This settles it for the case that matters: **on flop trees at SPR 4-10, annealed QRE is not an accelerator. It is 1.3x to 1.9x SLOWER, and worse the deeper the stacks.** It also retires the `LPopenBBcall` outlier for good - that spot is SPR 7, where this sweep measures a 1.13x iteration saving against the 2.25x it showed.

  The conclusion to carry forward: **fixed lambda is a modelling feature and costs 3.7x. Annealed lambda is not a Nash accelerator on flop trees at any realistic stack depth - it saves 7-13% of iterations at SPR 7-10 and pays about 2x per iteration for them.** Use QRE because you want a boundedly-rational strategy. For a Nash answer, dcfr, every time.

  **Bit-neutral on the Nash path, verified rather than assumed:** `validate_turn_fullrange` at 300 iterations still gives `nashconv 0.232074, ev 45.9951 54.0049`, and all 37 pre-existing tests pass with no tolerance loosened (`test_parallel` and `test_iso` compare exact floats).

  Interactions, each tested rather than argued: the deferred DCFR discount is untouched (the transform runs inside the traversal, after `pay_discount`); the recalc schedule is fed the **regularized** gap, because feeding it a plateauing number would make its feedback controller quarter its aggressiveness on nothing; suit isomorphism composes, and the QRE test asserts something stronger than the Nash one can - the regularized solution is **unique**, so iso-on and iso-off must agree on the strategy itself, not merely the game value (measured residual 0.053 -> 0.028 -> 0.0085 at 600 -> 2400 -> 9600 iterations, i.e. going to zero); and 1 vs 8 threads stay bitwise identical.

  **Annealing is available but is a research bet, not a result.** With a moving lambda the strategy average would span different games, so the solver drops the average once at the moment lambda settles and the accuracy target reverts to plain Nash exploitability, gated on annealing having finished. Whether it beats plain DCFR to a Nash target is unmeasured; M6.10's negative results are the precedent for expecting little.

  Not built, deliberately: `fit-lambda` (MLE from observed frequency counts) needs hand-history frequency plumbing that does not exist yet.

- **M7.1 - the DCFR strategy-discount exponent.** Landed 2026-08-28.
  **A ~2x wall-clock win on every family, from a constant that had never been swept.**

  `UpdateConfig::gamma` is the exponent on the strategy-sum discount `(t/(t+1))^gamma`.
  It was 1.0 - plain linear averaging - since M3.
  The DCFR paper's value is 2 and the reference Rust implementation (`b-inary/postflop-solver`) ships 3.
  Nobody had checked, because "DCFR is already the right update rule" (measured, and still true) was read as "the update rule is settled" and the rule's own parameters went with it.

  Iterations to the same accuracy target, medians over the standard board sets at tight ranges, via the new `bench_boards.py --dcfr-gamma`:

  | family, target | gamma 1 | gamma 2 | gamma 3 | gamma 4 | gamma 5 | best saving |
  |---|---|---|---|---|---|---|
  | river, 0.02% | 675 | 435 | 425 | 425 | 455 | 1.59x |
  | turn, 0.02% | 1225 | 675 | 585 | 590 | 590 | **2.09x** |
  | flop SPR 4, 0.3% | 260 | 155 | 135 | 125 | - | **2.08x** |
  | flop SPR 7, 0.3% | 565 | - | 255 | 235 | 230 | **2.46x** |
  | flop SPR 10, 0.3% | 900 | - | 405 | 395 | - | **2.28x** |

  Wall clock follows exactly, because **gamma is a pure iteration-count lever**: the discount is one multiply per cell either way, so per-iteration cost does not move.
  Flop trees at SPR 10 went 94.1 s -> 44.9 s; at SPR 7, 40.5 s -> 18.0 s; turn trees 0.70 s -> 0.36 s.

  **The saving does NOT decay with stack depth**, which is what separates this from the annealed-QRE result directly above it.
  QRE's iteration saving collapsed 1.41x -> 1.13x -> 1.07x across SPR 4/7/10 while its per-iteration cost climbed; gamma's is 2.08x -> 2.46x -> 2.28x with no per-iteration cost at all.
  That asymmetry is the reason one is the default now and the other is a modelling feature.

  **Why 3 and not 4.** The curve is flat from 3 to 5 and degrades by 8 (turn 625, river 485), so 3 sits at the knee with margin on both sides.
  4 is a few checkpoints better on flop trees and equal-or-worse on turn and river, and most of those gaps are inside the `--checkpoint-every 5` resolution.
  3 is also the value postflop-solver independently converged on.
  If flop trees ever become the only thing that matters, 4 is defensible; do not go past 5.

  **Gated, not assumed.** `configs/validate_turn_fullrange.json` through `engine_compare.py --solve-pio --cross-check`: Pio's own evaluator rates the engine strategy **0.016 chips** exploitable against **0.019** for Pio's own solve of the same tree. The strategy is not merely cheaper to reach, it is at least as good.

  **Two baselines moved, and this is the note that stops a future session calling it a regression.**
  Neither is a bit-neutrality failure - gamma legitimately changes the numbers, and everything above was verified bit-neutral against the gamma-1 defaults of its own day.

  - `validate_turn_fullrange` at 300 iterations now gives **`nashconv 0.106929, ev 46.0018 53.9982`**, where the M6.8/M6.9/M7 entries above record `nashconv 0.232074, ev 45.9951 54.0049`. Same iterations, 2.17x lower exploitability. Use the new numbers as the refactor reference from here.
  - The committed fixture pair `backend/Tests/Fixtures/engine/tiny_river.{hta,golden.json}` was regenerated; its `final_nashconv` went from `3.9826105587081884e-4` to `2.4049526814451383e-9` at the same 500 iterations.

  `tests/test_qre.cpp`'s isomorphism case went from 2400 to 4800 iterations.
  Not a convergence regression - the same sweep has gamma 3 reaching a QRE-gap target in 440 iterations against gamma 1's 595.
  A heavier strategy discount makes the running average *younger*, so at a **fixed iteration count** it carries more of the still-moving recent iterates and two equivalent-but-differently-accumulated solves (iso on vs off) agree less closely.
  Re-measured residual under gamma 3: 0.063 at 2400, 0.027 at 4800, 0.0097 at 9600, 0.0087 at 19200 - going to zero, which is what rules out a relabeling bug.
  Measuring an accuracy target and measuring agreement at fixed `t` are different questions and gamma moves them in opposite directions.

  Also fixed here because the suite was red: `tests/test_memory.cpp`'s hand-computed workspace mirror still read `(2 + seats)` hands-wide scratch slots per level after M7 added `kSlotCompat`, so it expected 360 bytes where the estimator correctly said 420. The estimator was right; the test had not been updated with it.

- **M7.2 - i16 strategy sums (`algorithm.precision`).** Landed 2026-08-28.
  **A 25% memory win and NO speed win, which is a negative result against the jesolver evidence and the reason it is written up in full.**

  Strategy sums store as u16 with a per-node f32 scale; regrets stay f32. `precision: "f32" | "i16"`, f32 the default and the Pio-gated path, verified bit-identical (`validate_turn_fullrange` at 300 iterations still `nashconv 0.106929, ev 46.0018 53.9982`, all 47 tests pass).

  The strategy half was chosen first because it is the safe half, and none of its properties carry over to regrets: sums are accumulate-only from non-negative terms, their discount is a single sign-independent factor (so it is charged to the SCALE, deleting that memory pass rather than narrowing it), they are never read inside the traversal, and `row_from_action_major` normalizes every row by its own sum - **so the per-node scale cancels on read and there is no dequantization step anywhere**. Overflow is a per-node bound, not a per-cell check: sigma is a probability, so no cell can grow by more than `max(rw)` per visit, and that number is free in the loop that already builds `rw`.

  On the user flop spot above (248536 decision nodes, 536 hands), regrets+strategy **1.40 GB -> 1.05 GB**, root EVs matching f32 to four decimals and nashconv 0.472781 against 0.473739. The quantization is numerically sound.

  Wall clock, three interleaved rounds, 100 iterations each:

  | attempt | i16 vs f32 | why |
  |---|---|---|
  | fused update loop | **-4.3%** (consistent sign) | the loop compiled SCALAR |
  | split into two loops | **-2.75%** (consistent sign) | vectorized again |
  | + scale hoisted per node | **+0.45%, +3.5%, -2.4%** | sign flips: not resolved |

  **The final answer is "indistinguishable from f32".** Within-arm spread was 10.6% against an effect under 1.5%, which is well inside the box's documented ~3% wall-clock noise floor, so no percentage should be quoted from it in either direction.

  **The vectorization finding is the durable part, and it is a new instance of a trap this file has hit twice.** Writing f32 regrets and u16 strategy sums in ONE loop makes MSVC give up entirely: `dumpbin` showed **zero packed ymm ops against the f32 version's seven**, and 37 scalar `ss` ops. It scalarised the regret half too, which is why the loss was bigger than the strategy array's share of traffic could explain. Splitting restored 12 ymm ops in each half. **Mixing output widths in one loop silently costs the whole loop its vectorization** - alongside the lambda-capture provenance trap in M7 and the hand-major scatter in M6.8.

  **On the regret half - and this is a CORRECTION to the first version of this entry, which said flatly "do not attempt it".** That was argued from conversion counts rather than measured, and `tools/qbench.cpp` (written afterwards, at the user's prompting) measures the thing directly. Same action-major layout, 536 hands x 5 actions x 25000 nodes = 268 MB of f32 cells, far past the 96 MB V-Cache:

  | variant | time | packed ymm | vs f32 |
  |---|---|---|---|
  | A: f32 store, f32 math (what the solver does) | 0.0131 s | 16 | - |
  | B: u16 store, **f32 math** (naive quantized regrets) | 0.0341 s | **0** | **0.39x - 2.6x SLOWER** |
  | C: u16 store, **u16 integer math** | 0.0051 s | 12 | **2.56x FASTER** |

  So both halves of the folk wisdom are true at once, and which one you get depends entirely on where the conversion sits:

  - **Naive u16 regrets are much worse than doing nothing.** Reading u16, converting to float to subtract a float counterfactual value, converting back and storing u16 is a round trip MSVC refuses to vectorize at all (0 ymm ops), and it lands at 0.39x. This is the same mixed-width failure as the fused loop above, and it is the version anyone would write first.
  - **A pure 16-bit integer inner loop is 2.56x faster than f32**, which is better than the 2x that halving the bytes alone would predict - the extra is 16-wide integer lanes against 8-wide float. The prize is real.

  Reaching C is a **fixed-point** design, not a storage change: the per-node value vector `out[]` would be quantized once per node (H conversions) instead of per cell (H x A), leaving the update loop pure integer. That is the same hoisting trick that already paid for the strategy scale. The unsolved part is `regret_matched_action_major`, which reads H x A regrets and must emit float sigma because sigma multiplies float child values - so it cannot obviously be made integer, and a partially-integer loop reintroduces exactly the mixed-width pattern that measures 0.39x.

  **That experiment was then run.** `tools/qbench.cpp` now models all three ways the traversal touches the regret array, and the answer is that each one behaves differently:

  | touch | f32 baseline | best i16 form | |
  |---|---|---|---|
  | the update (`r -= out[h]`) | - | **2.35x faster** | pure integer, if `out[]` is quantized once per node |
  | regret matching (pass 1) | - | **1.21x faster** | widen i16 -> f32 scratch in its OWN loop, then the existing all-float kernel |
  | `plain_fold_in` (`r += cv`) | - | **0.76x - still a loss** | even with every loop single-width |

  **The governing rule, which explains all eleven variants measured: MSVC vectorizes a loop whose streaming array is touched at ONE width, and scalarises it the moment the streaming array has to be widened or narrowed inside the loop.** Pure f32 and pure integer loops get 12-20 packed ymm ops; every fused mixed-width variant gets exactly zero. Splitting the widening into a loop of its own is what rescues regret matching (`j_widen`, 17 ymm ops), and it is the same fix that rescued `strat_accum_q16` in the solver. Fold-in cannot be rescued the same way because it needs a float multiply, a narrowing, and an integer accumulate, and the cheap cache-resident half stays scalar and dominates.

  Weighting the three touches equally puts the whole regret quantization at about **1.16x on this array alone**, which is a few percent of a solve - far too little for signed quantization, per-node scale management, and a sign-dependent discount that cannot be folded into the scale.

  **And the reason it is that small is the genuinely useful finding, because it explains why jesolver's compression does not transfer.** A twelfth variant merged `plain_fold_in` and the update into ONE streaming pass over the regrets, which halves the bytes moved and needs no quantization at all. It measured **0.99x - exactly nothing**. The regret rows for a single node are H x A x 4 bytes = about 10.7 KB at these sizes, so they are **L1-resident for the whole time the node is being processed**. The array streams from DRAM roughly ONCE per node per iteration and every subsequent touch is a cache hit. So the traffic that quantization would halve is already small, while the conversion cost is paid on every cell.

  **Verdict: do not quantize regrets.** Not because narrow cells are slow - variant C is 2.35x - but because this engine's hot data is already mostly in L1 within a node, so there is little streaming traffic left to save. The action-major layout and compact hand universe from M6.8 are what made that true; compression pays for jesolver because it is buying something this engine already has.

  ### The showdown gather, measured the same way (2026-08-29) - also refuted

  `docs/perf-plan.md` listed the `for (int i : sorted_)` gather in `RiverEvaluator` as the next lever, on the reasoning that an indirect gather in the hottest loop cannot autovectorize. `tools/qbench.cpp` models its totals sweep four ways, at 500 valid hands:

  | variant | vs today |
  |---|---|
  | N: gather + 52-bin scatter (today) | - |
  | O: `hi`/`lo` pre-permuted at construction, reach pre-gathered, contiguous sweep | **0.82x - SLOWER** |
  | Q: contiguous plus a 4-bank scatter (the standard histogram fix) | **0.76x** |
  | P: contiguous with the scatter removed entirely (the ceiling) | **1.12x** |

  **The premise was wrong twice over.** A 536-hand reach vector is ~2 KB, so it and the permutation are **L1-resident** - a gather out of L1 is cheap, and there is no bandwidth problem to fix. And the loop is latency-bound on the dependent `double` accumulation rather than on its loads, so a pre-gather pass adds a whole extra traversal to save something that was not costing much. **Even deleting the scatter completely only reaches 1.12x**, so the sweep is already within ~12% of its own floor and every standard fix overshoots that budget.

  Scope, stated honestly: this models the opening totals pass of `showdown_2p` and `compat_reach`, not the group sweep below it. What it does establish is that the *gather* is not the problem, which is what the perf plan claimed.

  ### The artifact export is 24% of the run, single-threaded, and INVISIBLE in every number we report (measured 2026-08-29)

  Found by chasing a user observation that `engine.exe` sits at ~30% CPU in Task Manager while PioSolver sits at ~70%. Both halves of that turned out to be the same thing.

  On the `8d 4c 2c` user spot, one run:

  | | |
  |---|---|
  | printed `solve time` | 56.15 s |
  | printed `wall ... including setup` | 56.29 s |
  | **actual process wall** | **74.49 s** |

  `wall_s` is captured in `main.cpp` **before** `write_artifact` is called, so the 18.2 s export pass is in neither the console line nor `wall_time_s` in the artifact metadata. `watcher/engine_compare.py` reads `wall_time_s` for the htsolver-vs-Pio comparison, which means **every ratio this project has published understates htsolver's end-to-end cost on flop trees by about a quarter**. The solve-loop-to-solve-loop comparison is still the fair one for the solver, but it is not what a `/compare` user experiences: end to end this spot is 74.5 s against Pio's 14.1 s.

  `ExportPass::visit` is a plain recursive call (`artifact_writer.cpp`) with no `parallel_for` anywhere, so those 18.2 s run on ONE core. That is the CPU number: the solve loop reaches ~8x on 16 threads (50% efficiency, measured in M6.7), then a quarter of the run drops to 1/16 of the machine, and the average lands near 30%. Pio has no equivalent serial tail.

  Three separate problems now point at the same code, which makes it the highest-value target in the engine:

  1. **Memory** - the export holds one record per decision node for ALL of them at once: 4.43 GB against the solver's own 1.40 GB, and 9.58 GB on the config that could not run at all.
  2. **Wall clock** - 24% of the run, single-threaded.
  3. **Reporting** - it is excluded from the only timing number the pipeline records.

  #### Two of those fixed, and the map swap was a dud (2026-08-29)

  **The timing is now reported.** `write_artifact` returns its own elapsed seconds, `export_time_s` lands in artifact metadata, and `solve` prints `total N s (setup + solve + artifact export, single-threaded)`. `wall_time_s` deliberately keeps its old meaning - it is what `engine_compare.py` rates against Pio's solve time, and redefining it would silently move every ratio ever recorded - so the export is surfaced beside it rather than folded into it.

  **`exports` went from `std::map<NodeId, NodeExportData>` to a `std::vector` indexed by `decision_index`, and it bought essentially nothing: 18.2 s -> 18.5 s (noise), 4.43 GB -> 4.42 GB.** Worth recording as a dud so nobody tries it again. The reasoning was sound - a red-black node per entry, 248536 of them, O(log n) lookups - but the arithmetic was not: those map nodes are ~16 MB against 4.4 GB of payload, and 248536 lookups are nothing against the traversal itself. The change stays because a dense array index has no business being a map key, not because it is faster.

  **What the timing number then made obvious is that the export is not slow - it is SERIAL.** 18.5 s single-threaded against a solve loop that does ~558 ms per iteration on 16 threads. In core-seconds the export is about 18.5 against an iteration's ~8.9, so it is roughly two iterations' worth of work - entirely reasonable for a full tree traversal that copies both seats' reach per node, calls `compat_weights` per seat per node, and divides per hand. It only looks pathological because it runs on one core while everything around it uses sixteen.

  **So the fix is to parallelize it, not to micro-optimize it.** Sibling subtrees are independent in the export exactly as they are in `CfrSolver::traverse_impl`, and the same fork-onto-the-pool treatment applies. At the solver's measured 8x on 16 threads that is 18.5 s -> ~2.3 s, taking this spot's end-to-end from 74 s to ~58 s. The remaining ~2.5M small vector allocations (about ten per decision node) are the other half, and streaming the blobs during the traversal removes both those and the 4.4 GB at once.

  ### The export is parallel now - and it uncovered a much bigger problem (2026-08-29)

  `ExportPass::visit` forks sibling subtrees onto the solver's pool exactly as `CfrSolver::traverse_impl` does, with the same discipline: siblings write DISJOINT `exports` slots (indexed by `decision_index`), every cross-child accumulation stays serial and in child order, and the per-action fold-back lives in one `fold_child` lambda shared by the forked and serial paths so there is a single copy of the arithmetic. **Verified bit-identical at 1 vs 16 threads** across all 3237 nodes of a turn tree, and pinned by a new `TEST_CASE` in `tests/test_parallel.cpp` in the same bitwise style as the existing thread-count tests.

  Then the thread sweep on the `8d 4c 2c` user spot, which was supposed to confirm the win:

  | threads | solve | speedup | efficiency | export | speedup |
  |---|---|---|---|---|---|
  | 1 | 130.02 s | 1.00x | 100% | 15.05 s | 1.00x |
  | 2 | 72.86 s | 1.78x | 89% | 12.35 s | 1.22x |
  | 4 | 60.21 s | 2.16x | 54% | 11.93 s | 1.26x |
  | 8 | 55.34 s | 2.35x | 29% | 14.07 s | 1.07x |
  | 16 | 48.47 s | **2.68x** | **17%** | 11.63 s | **1.29x** |

  **The flop SOLVE gets 2.68x out of 16 threads. M6.7 measured 8.0x - on a turn tree - and that number does not generalize.** This is the third time a turn-tree measurement has been over-read as a general result, after "best-response checkpoints cost nothing" and "faster than Pio in every family". Treat any figure in this file that was taken on `validate_turn_fullrange` as a turn-tree figure until it is re-measured on a flop tree.

  **Both phases scale well to 2 threads and then stop** - the solve is 89% efficient at 2 and 17% at 16; the export saturates immediately at ~1.25x. Two independent code paths hitting the same wall at the same thread count points at a **shared resource**, not at a structural problem in either one. It is not a shortage of parallel work: 89% efficiency at 2 threads means the fork-out is feeding the pool fine.

  **What it is NOT, measured rather than assumed:** the fan-out budget. The flop root has a single child (OOP can only check in this config), so the obvious theory was that `kMaxSplitLevels` got consumed on narrow betting nodes before reaching the 48-way chance nodes. Raising it 4 -> 10 gave ~10% and doubled the workspace ceiling to 293 MB. Reverted; worth revisiting, not the answer.

  **Hyperthreading works but has little left to gain here.** The 9800X3D is 8 physical cores / 16 logical, so 8 -> 16 is the SMT comparison: **1.14x on the solve, nothing on the export.** SMT is doing its job; the workload simply stops scaling long before the extra logical cores could matter.

  **This also re-explains the ~30% CPU report.** The export was only part of it - a solve using an effective 2.7 cores of 16 is the larger half. Fixing the export moved total wall on this spot from 74 s to ~60 s, but the CPU number will not approach Pio's 70% until the solve scales.

  **Next step is a profiler, not another hypothesis.** Two mechanisms were proposed and measured wrong today (the showdown gather, the fan-out budget), and a third guess is not worth the tokens. Hardware counters (VTune / uProf) on a flop solve at 2 vs 16 threads would settle whether this is memory bandwidth, L3/V-Cache thrash between threads, or contention on something shared like the arena mutex.

  ### The pattern across all three attacks

  Three independent per-iteration ideas were measured this session - i16 regret storage, merging the fold-in and update passes, and de-gathering the showdown sweep - and all three came back **neutral or negative**. The common cause is the same each time: the data these loops touch is already cache-resident, because M6.8's action-major layout and compact hand universe removed the structural problem that made it otherwise.

  **Treat "the per-iteration cost has headroom" as disproven until someone profiles the real solve and shows where the time actually goes.** The wins this session came from iterations (M7.1's gamma sweep, ~2x) and from not wasting them (the `checkpoint_every` fix). The remaining credible levers are algorithmic - fewer iterations, fewer nodes (bet-size pruning, regret-based pruning), or depth-limiting - not narrower cells or tighter loops.

  **The likely reason this diverges from jesolver**, stated as a hypothesis rather than a finding: compression pays there because it removes stalls that this engine has already removed by other means - the action-major layout (M6.8), the compact hand universe (M6.8), and the restrict-pointer fold-in work (M7). That win can only be spent once.

  Memory-wise the result is also out-scaled by its neighbour: on the same spot the ARTIFACT EXPORT is 4.43 GB against regrets+strategy's 1.40 GB, so streaming the export saves ~12x what i16 does.

## Where the time goes: the chance-node cliff (measured 2026-08-26)

`watcher/bench_boards.py` swept 10 turn boards and 10 river boards through both solvers - same ranges, pot, stacks and betting structure, same 0.02%-of-pot accuracy target, so the only variable is whether the tree contains a chance node. All 20 passed the cross-exploitability gate.

| family | tree | median pio/ht speed | htsolver peak | pio peak |
|---|---|---|---|---|
| river (5 cards) | 21 nodes, 0 chance | **5.15x faster** (2.7-8.9x) | 8 MB | 37 MB |
| turn (4 cards) | 3237 nodes, 7 chance x 48 | **0.38x - Pio 2.6x faster** (0.18-0.46x) | 53 MB | 63 MB |

**Those numbers are htsolver's best case, because the sweep used 100% ranges.** Range width is not neutral between the two solvers - see "The dense hand universe" below. On the same turn board with a ~15% opening range for both seats, htsolver's cost per iteration does not move at all (5.31 -> 5.30 ms) while Pio drops 29%, so the gap widens from 2.3x to 3.0x and htsolver's memory advantage flips to a small deficit (54 MB vs 48 MB). Re-run with `--ranges tight` for the number that resembles a real spot.

The scaling exponents are the whole story. Fitting time against the number of iterations htsolver needed for that board:

- **htsolver: slope 0.99 on turns, 0.94 on rivers.** Perfectly linear, and its cost per iteration is flat to within 9% across every board in a family (5.24-5.71 ms on turns, 0.15-0.17 ms on rivers). Every iteration walks the entire tree, including all 48 river runouts under every turn line, at full precision, forever.
- **Pio: slope 0.40 on turns, -0.12 on rivers.** Sublinear in difficulty on a multistreet tree and *flat* on a river tree. That is the signature of a solver that stops revisiting subtrees once they converge - which is exactly what `set_recalc_accuracy` / `set_always_recalc` control, and which pyosolver sets on every connection.

So neither half of the result is a compute win:

- The river 5x is mostly **Pio's floor**, not htsolver out-computing it. Pio's river tree build is 10 ms, but its `go()` sits at 0.64-0.67 s on nine of ten boards regardless of how hard the spot is. htsolver's 0.12-0.24 s is genuinely proportional to work. Do not read "5x faster on rivers" as "5x better solver".
- The turn 2.6x deficit is **entirely the linear-in-iterations traversal**. The worst board (`Ks Kd 4c 9h`) needed 4700 iterations and cost htsolver 24.7 s; Pio did the same tree in 4.6 s, only 1.9x its own easiest board while htsolver paid 4.6x its own.

### The dense hand universe (measured 2026-08-26)

`Game::num_hands()` returns 1326 unconditionally. Every regret and strategy array, every reach vector and every inner loop is the full combo universe no matter how narrow the configured ranges are. Measured on `9c 5d Jc 7s`, 500 iterations, 100% ranges vs a ~15% opening range for both seats:

| | 100% ranges | ~15% ranges |
|---|---|---|
| htsolver ms/iteration | 5.43 | 5.25 (**-3%**) |
| htsolver peak | 52 MB | 51 MB |
| Pio solve (same tree, same target) | 2.49 s | 1.77 s (**-29%**) |
| Pio peak | 63 MB | 48 MB (**-24%**) |

A tight range is roughly 190 live combos per seat against 1176 for a full range after board removal, and htsolver charges for all 1326 either way. Since every spot a user actually solves is a range spot, this is the single largest and least risky win available, and it is a re-indexing rather than an algorithm change.

### Every peak-memory figure above is a SOLVE-PHASE number (corrected 2026-08-28)

Until 2026-08-28 the engine sampled peak RSS when the solve loop ended and wrote
that into `peak_rss_bytes`, so every htsolver peak in the tables above excludes
the artifact export pass that runs immediately afterwards.

That keeps the **Pio comparisons honest** - the harness reads Pio's counter right
after its own `go()`, so both sides are solve-only - and those rows stand. What it
does not describe is what a box has to hold: on `3s Kd Js` at ~30% ranges with
142k decision nodes, the solve phase peaked at 538 MB and the process peaked at
2255 MB, because the export pass holds one record per decision node alive at once.
The line above about a realistic-range flop tree running "with a 242 MB peak"
is a solve-phase figure in exactly this sense.

Both numbers now travel in the metadata (`solve_peak_rss_bytes` and
`peak_rss_bytes`, plus `peak_commit_bytes`), the estimator counts the export term,
and `engine_compare.py` compares Pio against the solve-phase one. Re-running the
sweep would not move any ratio in the tables; it would add a second, larger column.

### Also measured, so nobody re-derives it

- **DCFR is already the right update rule.** Iterations to 0.02% of pot on `9c 5d Jc 7s`: dcfr 1100 (6.07 s), cfr_plus 2000 (10.16 s), plain regret matching did not converge inside 20000 (100 s). There is no free win in swapping the rule.
  **Corrected 2026-08-28: there was a free win in its EXPONENTS.** The conclusion above is about which *rule* to use and it still holds; it was read for years as "the update rule is settled", which stopped anyone from sweeping DCFR's own parameters. `gamma` had been sitting at 1.0 the whole time. See M7.1.
- **Best-response checkpoints cost nothing** *on a TURN tree*. 1000 iterations with a BR pass every 100 vs every 1000: 5.229 s vs 5.226 s, 0.06%.
  **Corrected 2026-08-28: this does NOT generalize to flop trees, and reading it as a general result is how `/compare` ended up with a bad default.** Same SPR 7 flop tree (213356 decision nodes), 250 fixed iterations, no accuracy stop, interleaved runs: `checkpoint_every 5` (50 BR passes) 19.31 / 19.17 s against `checkpoint_every 250` (1 BR pass) 12.37 / 13.36 s. **A BR pass costs about 2.7 iterations there** - it walks the whole tree per seat, so it scales with the tree like an iteration does, and the turn measurement only looked free because 10 passes over 1000 iterations is a hundredth of the ratio being charged here.
  Both ends of the range are therefore expensive, and for opposite reasons: frequent checkpoints pay BR passes, rare ones overshoot the target because **the accuracy stop can only fire at a checkpoint** (`main.cpp`). Expected overshoot is `checkpoint_every / 2` iterations, so the cost is `(N/cp) * 2.7 + cp/2` iterations and the optimum is near `cp = sqrt(2 * N * 2.7)` - about **25-40 for a 250-iteration flop solve**, where both 5 and 250 cost roughly 50%.
  Measured on the four SPR 7 flop boards, `cp 250` against `cp 5`: three boards land at or under 250 and finish in **0.69-0.71x** the time, while `Ah Kd 7c` needs 265, overshoots to 500, and costs **1.44x**. That coin flip is the user-visible symptom.
  Consequence for the numbers recorded elsewhere in this file: **every wall clock measured with `--checkpoint-every 5` is inflated by roughly 55% on flop trees**, M7.1's table included. The iteration counts are unaffected and the gamma RATIOS are unaffected (at a fixed `cp` the BR count is proportional to iterations, so both arms pay the same factor), but the absolute seconds are not the cost of a well-configured solve.
- **Threading is done.** 8.0x on 16 threads (8 physical cores).
- **The DCFR discount sweep is ~10%** of an iteration: dcfr 2.699 s vs plain rm 2.445 s over 500 iterations. Real, cheap to fix, not the gap.

### What would close it, in priority order

1. ~~**Compact the hand universe per solve.**~~ **LANDED 2026-08-26** - see "M6.8" above.
2. ~~**Flip `InfosetLayout` from hand-major to action-major.**~~ **LANDED 2026-08-26** - see "M6.8" above.
3. ~~**SIMD the elementwise inner loops.**~~ **LANDED 2026-08-26** - see "M6.9" above.
4. ~~**Fold the DCFR discount into the per-node update.**~~ **LANDED 2026-08-26** - see "M6.9" above. The justification written here originally ("each traversal writes a disjoint set of nodes, so this is exactly equivalent") was **wrong**, and worth recording as a trap: a traversal for seat p *writes* only nodes where `actor == p`, but it *reads* every decision node, because regret matching runs at opponent nodes too. Discounting node N the moment seat 0 finishes with it would change what seat 1 reads there in the same iteration. The deferred-and-stamped scheme in M6.9 is what actually makes it equivalent.
5. ~~**Stop traversing converged subtrees.**~~ **LANDED 2026-08-26 as M6.10, with a much smaller win than hoped (~10%)** - see the milestone entry and its negative results. The determinism invariant survived intact (the schedule is deterministic), but the slope hypothesis was wrong: freezing cannot reproduce Pio's sublinear scaling.
6. ~~**Suit isomorphism over runouts.**~~ **LANDED 2026-08-26 as M6.11.** Two corrections to what this entry used to claim: the blast radius was designed away (the contained design touches nothing outside the engine), and the per-board arithmetic here was wrong - a usable permutation must fix every board card, so `9c 5d Jc 7s` collapses NOTHING, while ~69% of flops and ~40% of turn boards have at least one usable permutation and gain 1.3-1.6x.

### Sequencing call

Items 1-4 are all pure engineering with no algorithmic risk and they compose: a conservative 3x from the compact universe and 2x from layout + SIMD puts a realistic-range turn spot near 0.9 s against Pio's 1.77 s. That is the "honestly faster" bar, reached without touching the determinism invariant, and it should come **before** M7.

Item 5 is what makes hard boards and flop trees scale, and it is the one to do deliberately and last of the performance work, because it changes what the engine promises about reproducibility.

Re-run `bench_boards.py --ranges tight` after each item; it is the only number that settles the argument.

Next (config schema already carries the keys; do not re-plumb):

- **M8 SPLITS IN TWO, and the preflop half is done** - see "M8a" below for the results.

- **M8a - multiway PREFLOP (jam/fold). LANDED 2026-08-30.**
  It has no postflop tree, so it does **not** force the depth-limiting decision, and it de-risks every N-seat data path (config, tree, terminal, agents, artifact writer, both readers) against a tree that fits in cache.
  It is also the only multiway milestone with a real external correctness gate: published heads-up Nash push/fold charts.

- **M8b - multiway POSTFLOP (3+ players)**: N-seat public tree over streets, fast side-pot terminal path, NashConv already generalizes. `multiway_no_nash_guarantee` stays surfaced - CFR converges to coarse correlated equilibria with 3+ players.
  **This is the milestone that forces the depth-limiting decision, and it should be designed with that in mind rather than built exact-only and retrofitted.** A 3-way tree is at least 8x the size of the heads-up equivalent and costs GTO Wizard 1.5x per iteration on flop/turn and 2x on the river even after their reductions; their own *classical* engine needs "multiple minutes on 64 cores" for a 3-way turn. Exact full-tree multiway at interactive speed is not a thing anyone has shipped. The shape that works, and that they use, is **exact on the river** (no future left to approximate, and they explicitly run no network there) with **depth-limited turn and flop**. Building M8 as exact-everywhere first would produce something correct that cannot be served on demand, which is half the product.
### M8a - multiway preflop push/fold. Landed 2026-08-30.

`game: "nlhe_preflop"` with `preflop.action_set: "jam_fold"`, 2 to 9 seats, unequal stacks, blinds and antes.
The 4-way 10bb target spot (blinds 1/2, stacks 20) solves **end to end in about 7 s**, of which 4.7 s is table construction and 2.4 s is the solve.

**The board is not in the tree, and that is the load-bearing decision.**
Runouts as chance-node children would make the cards PUBLIC, which is a different and far easier game; and `CfrSolver` cannot express infoset-sharing siblings without breaking bitwise determinism.
So the tree is pure betting - **29 nodes for 4-way jam/fold: 14 decision, 15 terminal (4 fold, 6 two-way showdowns, 4 three-way, 1 four-way)** - and the whole board average lives inside `Game::terminal_values`.
`build_preflop_tree` is a separate file from `build_postflop_tree` on purpose: the postflop builder is 2-player in every line of its recursion and produces the Pio-gated tree, and the structural difference is that **a preflop fold is not terminal** until one seat remains.

**Two estimators, because heads-up and multiway are different problems.**

- **k = 2: the board expectation COMMUTES with the sum over opponent hands**, so a static pairwise matrix `e2_` is exact in the limit. Built once from `pair_count` boards, every heads-up showdown is then one matvec with **no per-iteration board loop at all**.
- **k >= 3: the value contains a PRODUCT over opponents inside the board expectation**, which does not factorize and for which no static table exists. Those terminals average over `iter_count` boards, a FIXED sample drawn once at construction. Fixed is what separates this from `SamplingConfig`, which redraws per iteration and is therefore guarded by `sampling_exact()`: a fixed sample makes the solve an exact solve of a well-defined sampled game, so it genuinely converges and the accuracy stop keeps its meaning.

**Suit symmetrization of `e2_` is the highest-value line in the milestone, and it was not in the plan.**
Pairwise all-in equity depends only on the two hands and the suit-invariant board distribution, so it must satisfy `E2[h][o] == E2[pi(h)][pi(o)]` for every suit permutation - and it does **not** depend on the ranges, so this holds unconditionally.
A finite board sample does not satisfy it. Projecting onto the suit-symmetric subspace removes error and adds no bias, and the 24 images are near-independent, so it is worth about a sqrt(24) ~ 4.9x noise reduction for one cheap pass.
Without it the four combos of `J3s` came out with jam EVs spread over **0.11 chips** at `pair_count` 20000 - larger than the entire jam/fold margin of a threshold hand, and visible in the chart as suits disagreeing about a hand class.
With it the measured within-class spread is **exactly 0.00000**, which `tools/bench_board_sample.py` reports as a regression guard.

**Two normalization bugs, both found by writing the reference rather than by reading the charts, and both of which produced plausible-looking charts.**

1. **The win side and the commitment side rode different measures.** The multiway branch averaged over every sampled board, counting hero-blocked ones as zero, while the commitment term used the unrestricted opponent mass - quietly shrinking every jam by the ~34% of boards that conflict with four known cards. The fix is to make the middle factor a pure equity FRACTION (`num/den` accumulated over the same boards) and multiply by `compat_weights`, which is exactly the form the `e2_` path already had. That is why heads-up was right and multiway was not.
2. **Seats that could not win a layer were not weighting its board distribution.** A seat that is folded, or alive but committed below a side pot, still holds two cards and so still decides which runouts were possible. Leaving it out conditioned the layer on a different board distribution than the deal allows: measured at **4-5% of the layer's value**, and shown to be systematic rather than noise by holding steady when the sample went from 3 boards to 40. Every seat now contributes a per-board factor to both numerator and denominator.

**Validation.** `tests/test_multiway_terminal.cpp` gates `terminal_values` against a brute-force O(H^k) reference built on `showdown_share` - independently written, side-pot correct, and already covered by `test_terminal.cpp`.
Agreement is **1.1e-7 relative** on 3- and 4-way showdowns and on layered side pots with three distinct commit levels.
The reference had to be taught the engine's measure to get there: the estimator integrates over (board, deal) PAIRS jointly, not board-averages within each deal, and the two coincide exactly under full card removal.
Layers with exactly one eligible opponent are skipped by that gate and covered by the heads-up path instead, because they are answered out of `e2_` and so integrate a different board set.

`tests/test_preflop_game.cpp` adds the product-facing gates, all self-contained with nothing checked in:

- **Heads-up 10bb is an exact hand-by-hand best response**: each hand's jam and fold value is recomputed from `terminal_values` under the solved opponent strategy, and every pure action agrees with the sign while every mixed hand is indifferent. 762 pure jams, 556 pure folds, 8 mixed, **worst inconsistency 0 chips**.
- **The chart lands where published Nash charts do**: SB jams **57.8%** of combos and BB calls **37.3%**, against a published 58-60% / 37-40%. Asserted as a band rather than a golden file - wide enough not to be a chart test in disguise, narrow enough that a mispriced all-in equity would miss by tens of percent.
- **4-way position ordering**: CO **25.4%** < BTN **33.1%** < SB **57.8%** open jams, and the big blind calls 37.2% against the SB but only 17.5% against the CO.

**The honest caveats, measured rather than argued:**

- **Nothing is bucketed.** Every combo carries its own regret row, strategy row and EV; the 169 rollup is export-only aggregation exactly as it already is postflop. **Abstraction-free in the hand dimension, sampled in the chance dimension, exact on hero blockers.**
- **Opponent-vs-opponent card removal (bunching) is dropped at 3+ seats**, and is exact at 2. The inclusion-exclusion over collision events grows combinatorially, and the strength-conditioned per-card sums it needs cost roughly 52x the current sweep. Its cost surfaces as a chip-conservation error: root EVs on the 4-way spot sum to **0.068 chips instead of 0** against a 3-chip root pot. `test_preflop_game.cpp` reports that number and guards it loosely.
- **CFR has no Nash guarantee at 3+ players.** `multiway_no_nash_guarantee` already fired correctly and now travels on real artifacts.

**No artifact format bump, and that was verified rather than assumed.**
The `.hta` layout was already N-seat: the node record carries `i32[9]` per-seat commitment and every node blob is prefixed with its own `u16 num_seats` and per-seat counts.
Only a `num_seats() != 2` guard and a pair of scalar EV fields stood in the way.
`tests/test_artifact_roundtrip.cpp` now round-trips a 4-seat artifact with a short stack, which is the test that proves it - so the one-commit rule (spec + both readers + regenerate the fixture) is not triggered.
`SolveStats::ev_seat0/ev_seat1` became `std::vector<double> ev_chips`; metadata gained `stacks`, `preflop` (derived button and blind seats plus the action order, so no consumer re-derives the heads-up blind exception), `board_sample` and `opponent_card_removal`.
There is deliberately no `folded_mask` on the record: a fold edge names its actor through its parent, so the alive set is derivable, and a redundant copy could disagree with the tree.

**The board-sample defaults are measured, not picked** (`tools/bench_board_sample.py`, heads-up 10bb, two seeds per rung):

| pair_count | jam% | classes flipped vs the finest rung | within-class EV spread | setup |
|---|---|---|---|---|
| 5000 | 57.79 / 58.43 | 4 / 6 | 0.00000 | 1.2 s |
| 20000 | 58.48 / 58.13 | 2 / 1 | 0.00000 | 4.7 s |
| 80000 | 58.09 / 58.08 | 1 / 3 | 0.00000 | 18.9 s |
| 200000 | 58.59 / 58.37 | 0 / 2 | 0.00000 | 47.2 s |

Setup is linear in `pair_count` and the answer is essentially converged from 5000: the jam percentage moves under a point across a 40x range, and the residual 1-3 flips are boundary classes that are genuinely mixed (seed 1 at 200000 still shows 2).
**20000 is the knee that fits an on-demand solve** and is the default.

#### Bunching, half closed: the MASS is corrected, the FRACTION is not (2026-08-30)

Prompted by a user comparison against MonkerSolver on the 4-way 10bb spot, which is worth recording because the diagnosis came out of arithmetic rather than opinion.

**First, what the gap was not.** Re-running with **8x the multiway boards (4000), 5x the pairwise matrix (100000) and a 6.7x tighter target** - 128 s against 7 s - moved the root EVs by **0.05-0.08 bb/100**. The residual is bias, not variance, and no amount of sampling touches it.

**What it was.** Converting Monker's mchip at 2000/bb, every seat was high and the four excesses summed to **exactly** the chip-conservation error:

| seat | Monker | before | gap | after | gap |
|---|---|---|---|---|---|
| BTN | +24.1 | +24.74 | +0.64 | +24.23 | **+0.13** |
| CO | +17.0 | +17.41 | +0.41 | +17.20 | **+0.20** |
| SB | -12.2 | -10.53 | +1.67 | -11.46 | **+0.74** |
| BB | -28.9 | -28.12 | +0.78 | -28.66 | **+0.24** |
| **sum** | **0.0** | **+3.50** | **+3.50** | **+1.30** | **+1.30** |

(bb/100. Monker's own EVs sum to zero, which is what makes the comparison usable as a gate at all.)

**The fix, and why it is affordable in one place and not the other.** The dropped correction enters in two places, and they cost wildly different amounts:

- The profile **MASS** (`compat_weights`, and through it `total_profile_weight` and every terminal's normalizer) carries no board and no strength conditioning. Removing opponent-vs-opponent collisions there is one 52-wide pass per pair per hand - `sum_c Ca(c|h) Cb(c|h) - sum_o ra(o) rb(o)`, where the second sum puts back the same-combo pair the first counts twice. Landed.
- The equity **FRACTION** - the chips-per-unit-mass the per-board sweep produces - would need the same pairwise sums recomputed **at every strength threshold on every sampled board**. That is a rewrite of the hottest loop, not an extra pass. Not landed.

The split was not a guess about where the error lived; the per-seat gaps summing exactly to the conservation error is a signature of a measure error rather than a ranking error, and correcting the mass alone removed **63%** of the total gap for a solve that went 7 s -> 8.5 s.

**Exact where it can be, measured where it cannot.** With two opponents there is exactly one collision pair, so first-order inclusion-exclusion is the whole expansion: `compat_weights` matches a brute-force enumeration of pairwise-disjoint profiles to **8.7e-8** at three seats, and `terminal_values` matches the `showdown_share` reference to **1.3e-7** there. At four seats three pairs mean profiles where two different pairs collide at once, which the first-order term leaves in; that residual is asserted only as "much closer to exact than the uncorrected mass" (3x on the test universe) rather than against an absolute bound, because the gate's deliberately tiny 34-combo universe collides far more often than the 1326 a real solve carries.

The layered side-pot gate now compares **per unit of profile mass** on both sides. Layers need four seats to exist, so its mass carries the triple term; dividing it out keeps that test on what it is actually for - layer amounts, eligible sets, tie expansion - all of which live in the per-unit half. It passes at 1.0e-7.

**What is left, measured rather than argued.** A 3-seat solve has an exact mass, so its remaining conservation error is purely the fraction: **0.020 chips** on 3-way 10bb. `tests/test_multiway_terminal.cpp` reports the per-hand size of the fraction gap directly. Closing it is the hot-loop rewrite above, and it is what stands between 1.30 bb/100 and matching Monker outright.

#### Then the fraction too, because conservation is all-or-nothing (2026-08-30)

The mass-only fix above left root EVs summing to 1.30 bb/100 instead of zero. That residual is not a rounding artifact to be shrugged at: **chip conservation holds if and only if every seat integrates the identical set of deals**, and a rule phrased as "the others must miss MY cards" defines a different set for every hero. Half-correcting it - exact mass, hero-only fraction - is exactly the shape that cannot conserve, because the two halves are then two different measures multiplied together.

So the fraction was rewritten too. `layer_masses` replaces the per-opponent sweeps with ONE joint sweep over the board's tie groups, carrying per-card accumulators for every other seat and every pair of them, so the pairwise collision term can be evaluated at each hero hand's own strength threshold. `worse_and_tie` and `board_compat` are gone, superseded.

**Two more things changed that are not the correction itself and matter as much.**

- **A single scale, not a per-hand ratio.** `num/den` per hand corrects for a hand happening to be blocked by more of the sampled boards than average - lower variance, and tempting. But it gives every hand its own effective measure, and chips only conserve when every hand integrates the same one. One shared constant leaves the imbalance as variance, which shrinks with the board sample, instead of as a conservation error, which does not.
- **A folded hero is measured on the sampled mass too.** It wins nothing and pays what it put in, so the chips are trivial - but charging it against the board-free mass while the seats still in the hand are valued over sampled deals puts one seat at that terminal on a different measure than the others.

**Two bugs, both found by the per-terminal conservation gate and neither visible in a chart.**

1. `classify` collapsed "better than hero" into "not dealable", so the total column never removed hero-blocked hands that happened to beat hero.
2. The same-combo term was skipped whenever the two states differed - correct only for worse-versus-tied. **kTotal CONTAINS both**, so every pair involving a bystander lost its correction entirely. It showed up only at terminals with a folded seat, which is why the 3-way tree failed at exactly one node.

**Where it landed.**

| | before any bunching work | mass only | mass + fraction |
|---|---|---|---|
| 3-way 10bb, sum of root EVs | 1.00 bb/100 | - | **0.04 bb/100** |
| 4-way 10bb, sum of root EVs | 3.50 | 1.30 | **-0.55** |
| 4-way wall clock | 7 s | 8.5 s | **216 s** |

`tests/test_multiway_terminal.cpp` gates it directly: per-terminal conservation is **1.3e-8 of the pot at two and three seats**, and `terminal_values` matches the brute-force `showdown_share` reference per unit of profile mass to **1.4e-7** at three seats.

**Four or more players cannot be made exact this way, and that is a property of the expansion rather than a missing line of code.** With three opponents there are three collision pairs, and first-order inclusion-exclusion gives a deal weight of `1 - (number of colliding pairs)`. A deal where two different pairs collide gets `-1` from a seat that is clean and `0` from the seats caught in a collision - not the same number, so the measure stops being seat-independent. Fixing it needs the second- and third-order terms, and those are `O(H)` per hero hand per board (a sum over one opponent's whole range for each of the other two's collision masses), which measures at roughly `3e10` operations per iteration. Intractable at this shape.

The two escape routes, recorded so they are not re-derived: treat hero's own collisions to first order as well, which restores symmetry at any seat count but degrades hero blocking from exact to approximate - the dominant effect, currently free; or abandon the factorized sweep for sampled deals, which is manifestly symmetric and is what a sampling solver like MonkerSolver gets for free, at the cost of its 55,934 tree passes against our 25.

**A note for anyone reading Monker's abstraction dialog while debugging this: bucketing and bunching are different things with opposite effects.** Bucketing merges strategically similar hands so they must be played identically - a hand abstraction, which makes the answer less exact and which the vectorized core does not do. Bunching is card removal between opponents, which makes it more exact.

**Correction (2026-08-30): Monker's texture abstraction is NOT inert on a jam/fold tree.**
An earlier version of this note claimed a preflop-only sim leaves the bucket settings unused; running the 4-way ALLIN/FOLD tree in Monker disproved that from its own output.
The run wrote `holdemturn_30_4.ser`, which decodes (zlib + Java serialization) as a `TIntObjectHashMap` of exactly **16,432 entries - the suit-isomorphic turn-board count** - each an ~548-entry `TShortShortHashMap` from a packed hand key to a bucket in 0-29: a per-canonical-board 30-strength-bucket table for texture tier 4.
A jam/fold tree has no turn strategy to store, so the only consumer is the runout evaluation; with the running-stats arithmetic (~2,366 tree nodes against a 29-node betting tree) and the texture-sensitive RAM estimate, the conclusion is that Monker walks all-in runouts through abstracted chance structure with hand strength carried at 30 buckets per canonical board.
Its jam/fold EVs therefore carry board/strength abstraction error of their own, the recorded comparison bands stay TOLERANCE bands rather than exact-match gates, and part of any residual gap belongs to Monker's side of the table.
The sampled core (M8c) deals real boards and evaluates exact 7-card strength per deal, so it is strictly more exact at these terminals.

Still open in M8a: the equity-fraction half of bunching (above), real preflop bet sizings (the tree builder's `open_bb` / `raise_pct` / `max_raises` fields exist and are refused), and a 3-player toy game as a cheap CI gate for the N-seat CFR loop.

### M8c - the sampled-deal solver core. Landed 2026-08-30.

The escape route M8a recorded, taken: **deal the cards instead of correcting for not dealing them.**
`SampledCfrSolver` (`src/solver/sampled_cfr.*`) is a second solver core beside the vectorized `CfrSolver`, selected by `algorithm.family: "sampled"`, sharing the tree builder, config, artifact writer, CLI and thread pool - and sharing nothing of the hot loop, which stays byte-identical.

**The shape is chance-sampled CFR with the hero vectorized.**
Each iteration draws ONE deal - a hand per seat plus a full board, without replacement - shared by all of that iteration's seat traversals.
The traversing seat stays vectorized over its whole compact universe with deal-colliding hands zeroed (hero blockers exact, as everywhere else in this engine); every other seat is pinned to its dealt combo and walks as a scalar reach; action loops enumerate rather than sample.
Collisions cannot occur by construction and every deal's payoffs sum to the pot deal by deal, so **chip conservation holds at ANY seat count as a property of each sample** - the thing the factorized first-order expansion provably cannot reach at 4+.
Ignoring the hero's own dealt cards during its traversal is unbiased by an exchangeability argument recorded in `game/deal_game.hpp`.

**Determinism kept to the house standard.**
Iteration t's deal is a counter-based function of (seed, t) (`solver/deal.hpp`, the sibling of `sample_draw`); batches of `algorithm.sampled.batch` iterations run against regrets frozen at batch start (lanes only read the master and write private delta buffers, so freezing costs nothing); iteration t belongs to lane t mod `lanes`, and lanes fold back into the master SERIALLY in lane order.
The result is a pure function of (seed, iterations, batch, lanes); `tests/test_sampled_kuhn.cpp` asserts BITWISE equality of the raw arrays between 1 and 8 threads.
Discounting is linear at batch granularity (batch k's weight becomes k/n), applied serially.

**Two bugs the gates caught, and one diagnosis that was wrong first.**
Kuhn initially converged to a stable wrong equilibrium at nashconv 0.16; the first hypothesis - too few strategy revisions at batch 512 - was disproved by batch 32 landing on the identical number.
The real bug: terminal values for deal-blocked hero hands were never zeroed, so a Fold terminal's constant and a showdown row's garbage fed regret to exactly the hands the opponents were holding.
The vectorized core does this zeroing implicitly through the opponent REACH VECTOR inside `terminal_values`; a pinned scalar reach cannot, so the sampled traversal zeroes an explicit blocked list at every terminal.
The second bug: Kuhn's `hands_blocking_card` answered empty (the vectorized core never asks - no chance nodes), making the hero-universe masking a silent no-op there.
And a measurement lesson: the 3-way solve "plateaued" at nashconv 0.27 flat from 200k to 600k iterations - which was not the solve but the measuring stick.
The sampled core solves the TRUE game (a fresh board every iteration), so best response against a 40-fixed-board evaluator reports the game mismatch as a floor; at 2000 boards the same profile measures under 0.05.
Measure against a fine evaluator, not with more iterations.

**Measured, 2026-08-30, 16 threads:**

| gate | result |
|---|---|
| Kuhn, 200k iters | nashconv < 0.02 of a 2-chip pot, EVs conserve to 1e-4 |
| Leduc, 400k iters | nashconv < 0.05, strictly decreasing, bitwise across thread counts |
| HU 10bb, 150k iters | nashconv **0.0044 chips**, SB jam / BB call inside the published bands |
| 3-way 10bb, 150k iters | root EVs sum to **0.001 chips** against the exact evaluator |
| 4-way 10bb, 200k iters | see below |

The 4-way 10bb target spot, against the recorded MonkerSolver reference (bb/100):

| seat | Monker | factorized (216 s) | sampled |
|---|---|---|---|
| SB | -12.2 | -11.98 | **-12.05** |
| BB | -28.9 | -29.79 | **-29.81** |
| CO | +17.0 | +17.20 | **+17.04** |
| BTN | +24.1 | +24.03 | **+24.25** |
| sum | 0 | -0.55 | **-0.56** |

The -0.56 sum is NOT the profile: it is the measuring evaluator's own first-order residual (the same -0.55 signature the factorized solve carries), because per-seat EVs still ride `Game::terminal_values` at 4+ seats.
The profile's own measure conserves by construction; a sampled EV export that would make the DISPLAYED numbers conserve too is the recorded follow-up.
Both solvers now sit within the tolerance band of a Monker reference that is itself abstracted at the runout (see the correction note above), so the band is the strongest claim the comparison supports.

**Cost, measured (16 threads, 4-way 10bb), and the bug that hid in it.**
`SampledCfrSolver::split_budget()` returned 1.
That reads as a statement about this core's own traversal - which is true, iterations parallelize across lanes, not across subtrees - but `split_budget()` is not read by the solver at all.
It is the fan-out budget the CONSUMERS take: `compute_best_response` and the artifact export pass both fork sibling subtrees onto the pool with it.
Returning 1 pinned both to a single core, and since both are `Game::terminal_values` walks over the factorized evaluator, they were most of the wall clock: a user watching Task Manager saw ~70% for a few seconds and then ~6% (one core of sixteen) for a minute and a half.
It now returns `threads * 4`, the same policy `CfrSolver` uses, and the outputs are bit-identical (the BR fold-back was already serial and in child order).

| phase | before | after |
|---|---|---|
| 200k deals, end to end | 93 s | **25 s** |
| 600k deals, end to end | ~98 s | **32 s** |
| best response (one pass, 500 boards) | ~38 s | **~8 s** |
| artifact export (per-hand, all nodes) | ~45 s | **~8.6 s** |
| engine test suite | 80 s | **62 s** |

The marginal iteration rate is ~57,000 deals/s, so at 600k the split is roughly setup 4.6 s + iterations 10.6 s + best response 8.2 s + export 8.6 s.
**The factorized measuring stick is still the majority of it**, and `board_sample.iter_count` scales it linearly while the sampled solve never reads that value - so it is the honest wall-clock knob, priced in EV display noise rather than strategy quality.
The export pass is not "the root EVs": it stores per-hand, per-seat reach and conditional EV for EVERY decision node, and each terminal it touches runs the 500-board layer sweep.

#### The suit quotient and the rollup payload (2026-08-31)

Prompted by a user question that turned out to be two questions with one answer: why upload per-hand data a preflop chart never renders, and can the variance come down.

**The quotient.** `algorithm.sampled.symmetry` (default on) makes the sampled core store one row per 169-class suit orbit on preflop trees: `DealGame::hand_classes` reports the map (built from `combo_class_index`), storage shrinks 8x, and `average_strategy` expands class rows back to the per-hand contract, so members of a class emit BITWISE-identical rows (gated in `test_sampled_preflop.cpp`). This is a lossless relabeling, not abstraction - preflop, no infoset can tell suits apart, so the classes are exactly the orbits of the suit group. The identity path (games reporting no quotient, or `symmetry: false`) is bit-for-bit the original solver.

**The variance result, measured rather than repeated.** The naive expectation was ~8x sample pooling per row. The realized nashconv gain at equal deal budgets:

| spot | without | with | ratio |
|---|---|---|---|
| HU 10bb, 50k deals | 0.01022 | 0.00902 | 1.13x |
| 3-way 10bb, 150k deals (exact evaluator, 2000 boards) | 0.00797 | 0.00729 | 1.09x |
| 4-way 10bb, 200k deals (first-order evaluator) | 0.04038 | 0.03900 | 1.04x |

The gap between 8x and 1.1x has a mechanism: members of a class share each deal's board and pinned opponents, so their counterfactual samples are heavily correlated, and pooling correlated samples buys little. The quotient still earns its default - suit asymmetry in the OUTPUT is now structurally impossible (previously pure cosmetic noise), memory is 8x smaller, and it costs nothing (marginally faster). But anyone hunting a large variance win should look at the chance dimension (the board), not the hand dimension: the deal-to-deal board noise is the common factor the quotient cannot touch.

**The payload.** `dump-json --fields rollup` emits node structure plus the 169-class rollups and none of the per-hand fields; the watcher uploads that for pushfold jobs. Measured on the 4-way artifact: 5.93 MB full -> 217 KB rollup (27x). `/multiway` renders identically - it never read the per-hand fields - and old full payloads remain a superset, so previously stored results still load.

**What stays on the factorized path, deliberately.**
Best-response diagnostics and the artifact export's per-hand reach/EV fields ride `Game::terminal_values` - exact at 2-3 seats, first-order at 4+ (artifacts stamp `solver_family`; the export caveat is `export_ev_estimator` territory).
The 2-seat `e2_` path and the 3-seat factorized estimator stay: exact, fast, and the only deterministic cross-check oracle the sampled core has.
The 216s corrected 4-way demotes from product path to reference oracle; `/multiway` emits `family: "sampled"` for 4+ seats and stays vectorized at 2-3.

**Follow-ups this core unlocks, in the order they are likely to matter:** a sampled EV export (displayed EVs conserving at any seat count); ICM as a terminal payoff transform on `DealGame` (the sampled core evaluates concrete stacks exactly where ICM applies); bucketed multiway POSTFLOP and PLO through the `InfosetIndexer` seam (buckets/node = strength buckets x texture classes over suit-isomorphic boards - in scope for THIS core only, see the per-core rule below); QRE and real preflop sizings ported over.

### M9 - hand-sharing teams (cooperation/collusion). Landed 2026-08-31, on the sampled core.

The original M9 plan ("joint-range representation, 1326x1225 - river-only on 16 GB") was written for the vectorized core and is SUPERSEDED: on the sampled core a teammate is PINNED to a dealt hand during a traversal, so hand-sharing became an indexing change - which storage row the hero reads - not a joint-range representation, and it runs preflop multiway on ~180 MB in under 30 s.

**What it is.** `agents.partition` with one 2-seat group makes that pair share hole cards and maximize SUMMED chips.
A team actor's infoset is (node, own hand, partner hand); storage rows are the suit orbits of ordered disjoint hand pairs - **93,769** of them, the exact quotient (Burnside with stabilizers; pinned in `test_team_preflop.cpp`), built by `NlhePreflopGame::joint_hand_classes` from the same `perm_hand_map` machinery as `e2_`.
A team hero's terminal value is its own chips plus the pinned partner's chips on the same deal (`deal_showdown_values_team`, gated exactly - worst gap 0 over 4,515 hands - against pinning the hero per hand and reading the partner's value).
Chip conservation is untouched: payoffs per deal still sum to the pot; only preferences over them changed.

**The two awareness modes ARE the answer to "does it matter if the others know".**

- `agents.awareness: "unaware"` - two phases in one run: phase 1 solves the no-team baseline, then opponents are FROZEN at its average strategy and only the team trains.
  A two-headed team with one payoff and shared information is a single optimizer, so this phase has a REAL convergence guarantee, unlike general 3+ agent CFR.
  The gated theorem: the team could always play its baseline strategies against the same frozen opponents, so the joint best response must beat the baseline.
- `agents.awareness: "aware"` - everyone trains together with the team as one payoff-coupled meta-player; opponents adapt.
  No ordering theorem connects this to the baseline (it is an equilibrium of a DIFFERENT game), and the usual 3+ agent CCE caveat applies.

**Measured, 4-way 10bb, CO+SB sharing against BB and BTN (chips; bb = 2):**

| | SB | BB | CO | BTN | team (SB+CO) |
|---|---|---|---|---|---|
| baseline (no team) | -0.255 | -0.615 | +0.364 | +0.506 | **0.109** |
| unaware | -0.220 | -0.995 | +0.553 | +0.663 | **0.333** |
| aware | -0.316 | -0.673 | +0.477 | +0.512 | **0.161** |

(Numbers are from the two-sided-update build; the first shipped build measured unaware 0.271 / aware 0.125 - the stronger conditioned training is worth ~40% more uplift.)

Three findings worth the table:
the unaware uplift is **+0.223 chips = +11.2 bb/100** for the pair, and it is extracted almost entirely from the BB (-0.62 to -1.00) while the unaware BTN **free-rides** the team's pressure (+0.51 to +0.66);
opponents who KNOW keep most of it away (uplift +0.052 chips = +2.6 bb/100);
and on the 3-way gate the aware team measured BELOW its own baseline (0.304 vs 0.322) - being known to collude can cost more than the sharing gains, which is a property of the changed game, not a bug, and exactly why the two modes had to ship together.

**The estimator trap, paid for and recorded.** During a team hero's traversal the partner's policy conditions on the hero's hand - and the hero is VECTORIZED, so a partner node's sigma is a per-hand vector, not a scalar.
The first implementation conditioned the partner on the hero's DEALT hand; each member then trained against a partner reacting to the wrong cards, and the measured result was a team losing to its own no-team baseline (-0.97 vs +0.32 on the 3-way gate).
If a future change makes a team lose to its baseline, look here first.
(The vector originally traveled as a per-hand opponent-weight channel folded before the descent; the two-sided update below replaced that with folding the sigma into the returned values AFTER each partner node's descent - same expectation by linearity, and it keeps the child values counterfactual for the partner.)

**The two-sided team update (landed one day later, after the first user run).** The initial traversal only updated the HERO's rows, so a conditioned cell (own X, partner Y) trained only on deals where BOTH classes were literally dealt - about freq(X) x freq(Y) = 0.001% of deals - and the conditioned charts shipped as visible noise (the first 4-way run showed CO jamming "nearly any-two" with AA behind; the converged answer is the OPPOSITE, CO folds everything and lets AA collect).
Since a partner node's descent already computes the mate's per-hand sigma and, per action, the team's per-hand counterfactual values, the mate's full conditioned row (own = dealt, partner = every hero hand) is updated there too: regret weight `hero_reach[h]` times the returned value (which carries the external reach via `opp_w`) is exactly the everyone-but-the-mate counterfactual weight.
Per-cell coverage goes from freq(X)*freq(Y) to ~freq(X)+freq(Y) - three orders of magnitude - and the stronger joint best response it finds raised the measured 4-way unaware uplift by ~40%.
Strategy sums at team nodes are additionally weighted by BOTH seats' reach (`mate_reach` threading), so the exported marginal is a real reach-weighted average and the rollup's per-partner-class mass is an honest reach signal - `team_rollup.partner_reach` ships it, and `/multiway` flags conditionings that never happen ("partner folded AA").

**What converges and what legitimately does not.** The unaware team EV is seed-stable (0.766 vs 0.765 on the 3-way gate at 640k iterations) because the joint best-response VALUE is unique - but the argmax is NOT: which seat carries the aggression can be interchangeable at identical team EV, and once the outsider folds, the last team seat calling its own partner's jam only moves chips WITHIN the team, a genuine indifference.
So conditioned charts at deeper team nodes keep a mixing band that two seeds resolve differently, on top of a small-edge threshold band that sharpens only as 1/sqrt(iterations).
`test_team_preflop.cpp` gates EV agreement tight and strategy agreement reach-weighted and loose, on purpose; do not tighten the strategy gate without first checking the disagreement is not one of these two EV-free kinds.

**Frozen seats export their baseline.** In unaware phase 2 the frozen seats never accumulate strategy sums, and `average_strategy` originally fell to its uniform fallback - artifacts showed the opponents playing 50/50 while the solve itself (training traversals and the EV pass read `frozen_rows_`) was correct all along.
`average_strategy` now returns the frozen rows, and a gate pins every frozen node's export bitwise-equal to the baseline solver's.

**EV honesty forced a general improvement.** Per-seat marginal strategies cannot reproduce a team's correlated play, so team EVs cannot ride `Game::terminal_values` - and now EVERY sampled solve's root EVs come from a **sampled EV pass** (200k fresh seeded deals under the average profile, all seats pinned, `deal_showdown_pinned`).
These conserve exactly at any seat count, retiring the displayed "-0.011 evaluator residual" on 4-way solves; metadata says `root_ev_estimator: "sampled_deals"`.
`final_nashconv` is null on team artifacts (best response against marginals is not a meaningful measure of a correlated team; a proper team best-response evaluator is future work).

**Export shape.** The artifact's per-hand strategy blobs and 169 rollups are MARGINALS over the partner (`team.strategy_export` flags it); the conditioned strategy - the actual shared-cards play - travels as `team_rollup` in metadata: per team decision node, reach-weighted action frequencies per (partner class, own class) cell, plus per-cell per-action conditioned TEAM EVs (`ev`, own + partner chips: `ev_sum_`/`ev_w_` accumulate reach-weighted counterfactual values against an opp_w denominator during training, under the same linear discount) and `partner_reach`.
`/multiway` renders it with a partner-hand selector; the marginal chart is the default, and conditioned tooltips show the team EVs.
Configs: `configs/pushfold_4way_10bb_team_{unaware,aware}.json`.
Phase control: `agents.baseline_iterations` is phase 1 (the frozen baseline; defaults to `budget.iterations` when unset), `budget.iterations` is phase 2 (the team) - independently, so a long team solve sets a modest baseline and pours the budget into phase 2, which is also the cheaper phase (2 hero traversals per deal instead of one per seat).
`/multiway` exposes both (Baseline iterations appears when a team is marked unaware).

Still open under M9: teams of three or more seats and multiple teams (the joint quotient generalizes but the orbit space grows), general payoff-weight matrices (only summed-EV teams exist), and a team-aware best-response evaluator so team solves get a convergence number again.

- **M10 - Bayesian unknown-collusion**: chance root over team type with probability p - now precisely the p-interpolation between M9's two awareness modes (p=0 is unaware, p=1 is aware); opponents' infosets span branches; honest branch keeps seats independent (the coordination-failure trap). Own pass with LP-verifiable toy games.

Out of scope, permanently (do not build speculatively): TMECor / coordination-without-card-visibility, cloud SDKs inside the engine.
Hand abstraction/bucketing became a PER-CORE rule with M8c: still permanently out of the vectorized core, in scope for the sampled core as the route to multiway postflop and PLO (the `InfosetIndexer` seam is where it lands).

**"GPU" moved off that list and needs splitting, because the depth-limiting direction above touches it.** The boundary that still holds is the *engine binary*: `engine.exe` stays a headless CPU-only CLI with no cloud SDK, and a value network it consults would be a local file it reads, with inference on the CPU. What is no longer forbidden is a **separate, offline training tool** that produces that file - training a value network is the one part of the Ruse approach that plausibly wants a GPU, and it is not part of the solver. Keep them apart: if a GPU dependency ever appears inside `engine.exe`, that is the line being crossed, not training hardware.

Hand abstraction stays out for the same reason it always was, and note that this is consistent rather than in tension with copying GTO Wizard: **they are abstraction-free too.** Depth-limiting is what makes them fast; bucketing is not something they do. See `docs/perf-plan.md`.

## Working agreements

- Correctness before speed, speed before scale. Every solver change re-passes Kuhn/Leduc CI and a Pio cross-check on at least one spot.
- The artifact format is a versioned contract; changes move the spec, both readers, and the fixture in one commit.
- The 16GB dev box is the memory budget; the estimator must not drift from reality.
