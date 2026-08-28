# htsolver roadmap

The durable copy of where this project is going, so no session loses the plot.
The full original spec lives in the engine bootstrap prompt (session plan file `~/.claude/plans/c-users-thejo-downloads-engine-bootstra-crispy-pike.md` on Josh's machine); this file is the repo-resident summary and is the one to keep updated.

## The goal product

htsolver replaces PioSolver in the HoldemTools pipeline.

- The watcher picks up a gametree job, solves it with **htsolver**, uploads schema-4 bundles, and frontend users browse the result in `/solutions` - exactly today's flow with Pio swapped out. The plumbing already exists: publish-mode `EngineCompareJob`s do this for river spots now.
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

- **M7 - QRE (quantal response equilibrium).** Landed 2026-08-28. **The first differentiator over Pio to actually ship.**

  Entropy-regularized CFR, implemented as a **reward transformation inside the traversal** rather than as a replacement for regret matching. At an actor's decision node each action's counterfactual value is charged the dilated KL of the current strategy to uniform:

  `vt(h,a) = v(h,a) - pi(h) * (1/lambda) * (log sigma(h,a) + log A)`

  whose fixed point is the logit QRE. `pi(h)` is `Game::compat_weights` - the compatible-opponent-reach the counterfactual values already carry - and it is load-bearing rather than cosmetic: softmax is not scale-invariant, so regularizing the raw counterfactual value would make effective rationality vary with how often the opponent can hold a compatible hand. Scaling by `pi(h)` is what makes one lambda mean the same thing at every infoset.

  **Why the transformation and not a softmax policy.** Because only the values fed into the regrets change, `regret_matched_action_major`, the cold-path `row_from_action_major`, `average_strategy()`, `current_strategy()`, the schema-4 exporter, the C# reader and the frontend are all untouched, and the average strategy is still the answer. A softmax-over-regrets design would have had to mirror itself in both regret-matching implementations and would have changed what `current_strategy()` means. Config is `qre.mode: "qre"` plus a per-seat `qre.lambda` (1/chips; a scalar broadcasts), with optional `qre.anneal: {factor, full_at}`.

  **The stop criterion is the interesting part, and it is a correction to the obvious plan.** A fixed-lambda QRE is not Nash: perturbing a payoff by at most eps makes the perturbed equilibrium a 2*eps-Nash of the true game, so plain exploitability plateaus around `2*D*log(A)/lambda` chips and **can never reach a tight accuracy target, however long the solve runs**. `compute_qre_best_response` therefore measures exploitability in the entropy-augmented game - a smooth (log-sum-exp) maximum against an on-profile value charged the same KL - which does converge and is chip-denominated, so `budget.target_exploitable_pct` works unchanged. Charging the `ev` side too is the easy thing to miss; regularizing only the best-response side leaves a gap that never closes. Both numbers are printed and land in artifact metadata, and solve start warns when the configured lambda cannot reach the configured target.

  Measured on `configs/validate_turn_fullrange.json` at lambda 0.1 (= 10 per pot) with a 0.3%-of-pot target: the QRE gap reaches 0.235% in 500 iterations while plain exploitability sits at 6.89% and stays there. That separation is the feature, not a failure.

  **Bit-neutral on the Nash path, verified rather than assumed:** `validate_turn_fullrange` at 300 iterations still gives `nashconv 0.232074, ev 45.9951 54.0049`, and all 37 pre-existing tests pass with no tolerance loosened (`test_parallel` and `test_iso` compare exact floats).

  Interactions, each tested rather than argued: the deferred DCFR discount is untouched (the transform runs inside the traversal, after `pay_discount`); the recalc schedule is fed the **regularized** gap, because feeding it a plateauing number would make its feedback controller quarter its aggressiveness on nothing; suit isomorphism composes, and the QRE test asserts something stronger than the Nash one can - the regularized solution is **unique**, so iso-on and iso-off must agree on the strategy itself, not merely the game value (measured residual 0.053 -> 0.028 -> 0.0085 at 600 -> 2400 -> 9600 iterations, i.e. going to zero); and 1 vs 8 threads stay bitwise identical.

  **Annealing is available but is a research bet, not a result.** With a moving lambda the strategy average would span different games, so the solver drops the average once at the moment lambda settles and the accuracy target reverts to plain Nash exploitability, gated on annealing having finished. Whether it beats plain DCFR to a Nash target is unmeasured; M6.10's negative results are the precedent for expecting little.

  Not built, deliberately: `fit-lambda` (MLE from observed frequency counts) needs hand-history frequency plumbing that does not exist yet.

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

### Also measured, so nobody re-derives it

- **DCFR is already the right update rule.** Iterations to 0.02% of pot on `9c 5d Jc 7s`: dcfr 1100 (6.07 s), cfr_plus 2000 (10.16 s), plain regret matching did not converge inside 20000 (100 s). There is no free win in swapping the rule.
- **Best-response checkpoints cost nothing.** 1000 iterations with a BR pass every 100 vs every 1000: 5.229 s vs 5.226 s, 0.06%.
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

- **M8 - multiway (3+ players)**: N-seat public tree, fast side-pot terminal path (`showdown_share` is the correct-but-slow reference), NashConv already generalizes. `multiway_no_nash_guarantee` stays surfaced - CFR converges to coarse correlated equilibria with 3+ players.
- **M9 - collusion, best-response mode first**: seat->agent partition + payoff-weight matrices, joint-range representation (1326x1225 - river-only on 16GB), frozen-opponent team best response.
- **M10 - Bayesian unknown-collusion**: chance root over team type with probability p; opponents' infosets span branches; honest branch keeps seats independent (the coordination-failure trap). Own pass with LP-verifiable toy games.

Out of scope, permanently (do not build speculatively): GPU, hand abstraction/bucketing, TMECor / coordination-without-card-visibility, cloud SDKs inside the engine.

## Working agreements

- Correctness before speed, speed before scale. Every solver change re-passes Kuhn/Leduc CI and a Pio cross-check on at least one spot.
- The artifact format is a versioned contract; changes move the spec, both readers, and the fixture in one commit.
- The 16GB dev box is the memory budget; the estimator must not drift from reality.
