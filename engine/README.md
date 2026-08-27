# htsolver - the HoldemTools engine

A headless C++20 poker solver ("htsolver"): vectorized CFR over a public tree.
Reads a JSON config, writes a binary `.hta` artifact, exits.
No GUI, no cloud SDKs, no Firebase - the same binary runs on a dev box, a big-RAM server, or a batch job with only a recompile.

Differentiators over existing solvers (PioSolver, MonkerSolver):

- **QRE** (quantal response equilibrium) via entropy-regularized CFR, with per-player rationality (λ) and λ-fitting from observed frequencies. *(Scheduled: M7.)*
- **3+ player support** from the ground up, with side-pot-correct terminal evaluation and NashConv as the convergence metric. *(Terminal evaluator landed; full multiway solving scheduled: M8.)*
- **Configurable cooperation/collusion**: a seat->agent partition plus payoff-weight matrix, with known (common-knowledge) and unknown (Bayesian) collusion modes. *(Scheduled: M9-M10.)*

Currently implemented: heads-up NLHE **river** solving in Nash mode, validated against Kuhn's analytic equilibrium, Leduc convergence curves, and PioSolver.

## Quickstart

```powershell
# Windows: always build through the wrapper (bootstraps MSVC + CMake + Ninja).
./build.ps1 -Test

# Estimate memory without solving.
./build/engine.exe dry-run configs/example_river_hu.json

# Solve and write the artifact.
./build/engine.exe solve configs/example_river_hu.json

# Inspect an artifact.
./build/engine.exe dump-json out/example_river_hu.hta --node 0
```

`configs/example_river_hu.json` is the documented reference config - every key is commented there.

## Theory caveats, stated plainly

- **CFR has no Nash-equilibrium guarantee for 3+ players.** It converges to the coarse correlated equilibrium set, and multiway games can have many Nash equilibria with no principled way to pick one. Pluribus used CFR anyway and it worked empirically - that is the state of the art, not a theorem. Multiway artifacts carry `multiway_no_nash_guarantee: true` in their metadata; downstream consumers should not over-trust multiway results.
- **QRE** (λ-parameterized logit response: `P(a) ∝ exp(λ·u(a))`) models boundedly rational opponents: λ=0 is uniform random, λ→∞ recovers Nash. A QRE solve is deliberately *not* an equilibrium in the Nash sense and is never comparable to Pio output - the validation harness refuses to try.
- **Collusion solving is a research/analysis capability.** Modeling information-sharing teams is standard published game theory and is how collusion-*detection* work is done. Using it against live real-money tables is cheating and bannable everywhere.

## Validation ladder

1. **Kuhn poker** - solved strategy must land in the analytic one-parameter equilibrium family, game value -1/18 (`tests/test_kuhn.cpp`).
2. **Leduc hold'em** - NashConv must fall monotonically (loosely) and beat a threshold within a fixed iteration budget; runs in CI (`tests/test_leduc.cpp`, `.github/workflows/engine-ci.yml`).
3. **HU NLHE river vs. PioSolver** - unabstracted, so any difference is an engine bug. Manual harness on the machine that has Pio:

   ```bash
   cd watcher
   python engine_compare.py --artifact ../engine/out/spot.hta --cfr path/to/spot.cfr
   ```

   Solve the spot in the engine with `"ev_float32": true` and `"strategy_quantize_u8": false`, build and solve the same tree in Pio to its usual accuracy (`max(pot * 0.002, 1e-4)` chips).
   The **primary gate is cross-exploitability**: the harness loads the engine's strategy into Pio (`set_strategy` + `lock_node`) and Pio's own evaluator reports how exploitable that profile is - the only metric that stays meaningful when the two solvers land on *different equilibria* (a 2p zero-sum game has a unique value but many equilibria, and indifference regions are huge in symmetric spots).
   Per-hand L1 on action frequencies and per-hand EV differences are reported as diagnostics with the worst-offending hands printed.
   `configs/validate_river_fullrange.json` is a validated reference spot: **passed 2026-08-25** - Pio rated the engine profile exploitable for 0.0 chips (vs 0.25 for Pio's own solve of the same tree) and reproduced the engine's root EVs to three decimals.

   With `--solve-pio` the harness needs no .cfr at all: it builds the engine's exact tree in Pio over UPI (add_line per showdown line, validated node-for-node against the artifact before solving), sets the same ranges, solves to `--pio-accuracy-pct` (default 0.02% of pot, PioViewer's default), and compares - fully unattended.
   The cross-check deliberately does NOT `lock_node` before `calc_results`: locked nodes are excluded from Pio's MES search, which silently reports 0.000 exploitability for any strategy (verified with a garbage-strategy negative control).

   For eyeballing the per-hand numbers, add `--ht-out a.ht.htc` (and `--pio-out a.pio.htc --pio-detail` if you want Pio's side too) and drop the files on the frontend's hidden `/compare` page (no nav entry): 13x13 strategy grids with EV-heat mode, per-action summaries and per-combo breakdown panels, side by side when both solvers are loaded, plus a per-combo table (frequencies, EVs, ΔEV, L1) for every node. The files load from disk in the browser, so the page works on the deployed site too.
   The gate itself is `--cross-check`, which is off by default: a run without it prints "no verdict" rather than a PASS that proves nothing.
   The queue path (`/compare` -> `POST /api/enginecompare` -> the compare watcher) is the normal way in and works from anywhere; the dev-only `POST /api/engine/compare` runs the same harness locally and returns the log plus both payload summaries.
4. **Turn and flop trees** - the engine solves any 3/4/5-card root board (chance nodes between streets; all-in calls run out as pure chance chains; per-street/per-seat sizing incl. OOP donks and a `preflop_aggressor` gate). `configs/validate_turn_fullrange.json` is the turn reference spot. The harness compares small trees in FULL mode (every node + cross-exploitability); trees past `--full-limit` decision nodes switch to deterministic sampled runouts (`--runouts` cards per chance node) where the gate is root-EV agreement - stated loudly in the output, since a partial strategy upload would make the cross-check meaningless. Pio's multistreet `add_line` token = the actor's hand-cumulative total after every action (checks repeat the current total; a mid-line 0 after chips are in crashes Pio - verified empirically).

## Artifact

The solve output is a single versioned binary file with a byte-offset node index, designed so a consumer can fetch one node without deserializing the file (and later, straight off ADLS Gen2 with HTTP Range requests).
Spec: [docs/artifact-format.md](docs/artifact-format.md).
Production reads happen through the C# reader in `backend/Services/EngineArtifacts/`; `engine dump-json` is a developer tool.

## Config reference

See the commented `configs/example_river_hu.json`. Summary:

| key | meaning |
|---|---|
| `game` | `nlhe` (river-only this pass), `kuhn`, `leduc` |
| `board`, `pot`, `chip_scale` | 5-card board; root pot in chips; chips per display unit (100 = 1bb) |
| `players[]` | seat label, stack (chips behind), range string or `@file:` |
| `bet_sizing.<street>` | per seat: `bets`/`raises` (and OOP `donks`) as %-of-pot lists, plus `no_3bet` (that seat never makes the street's third aggression); `allin_threshold` and `max_raises` are street-wide |
| `algorithm` | `rm` \| `cfr_plus` \| `dcfr` (+ `dcfr.alpha/beta/gamma`; default DCFR, linear averaging) |
| `qre` | `mode: "nash"` (QRE lands in M7; schema reserved) |
| `agents` | `partition` (identity only this pass), `payoff_weights`, `collusion` (reserved) |
| `budget` | `iterations`, `target_nashconv` (chips, early stop), `checkpoint_every` |
| `memory_limit_gb` | fail-fast ceiling for the pre-solve estimate |
| `output` | artifact path, `strategy_quantize_u8`, `ev_float32` (default true), `rollups_169` |
| `threads` | workers: `0` = one per hardware thread, negative = leave that many cores free. Results are **bitwise identical at any thread count** - the traversal forks sibling subtrees but folds every child back serially and in order |

Range grammar: comma-separated `token[:weight]`, tokens are classes (`AA`, `AKs`, `T9o`) or explicit combos (`AhKd`); weights in `[0,1]`. `TT+` / `A5s-A2s` shorthand is not supported yet.
