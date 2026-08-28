# engine/ - conventions and invariants

C++20 CFR/QRE solver.
Headless CLI: reads a JSON config, writes a local `.hta` artifact, exits.

## Building and testing

On Windows, **always** go through the wrapper - cl, cmake, and ninja are not on the ambient PATH here:

```powershell
./build.ps1            # configure + build (RelWithDebInfo)
./build.ps1 -Test      # ... then ctest
./build.ps1 -Config Debug -Clean
```

Never invoke cl, cmake, or ninja directly on Windows.
On Linux/CI, plain `cmake -B build -S engine && cmake --build build && ctest --test-dir build` is fine (the toolchain is on PATH there).

## The dev box is more permissive than CI - expect green-here-red-there

Two environment gaps have bitten already, both invisible locally:

- **MSVC's headers include far more than libstdc++'s.** A missing `<cstdint>`/`<bit>` builds fine here and fails the GCC job. Include what you use; do not rely on transitive includes. The quickest check before pushing is a transitive include audit (resolve project `#include "..."` recursively, then look for `std::` symbols whose header appears nowhere in the graph) - it caught a second break that would otherwise have failed the *next* CI run.
- **The runner's MSVC and CMake are newer than the local ones.** A newer MSVC emits warnings the local one does not (C5285 on doctest specializing `std::tuple`), and CMake 4.x turns `cmake_minimum_required(VERSION < 3.5)` from a warning into an error. Hence `CMAKE_POLICY_VERSION_MINIMUM` and `FetchContent_Declare(... SYSTEM)` + `/external:W0`: **dependency headers are never held to our warning settings** - `/W4 /WX` is for our code only.

There is no Linux toolchain on this machine, so the GCC job is only ever verified by CI. Push to a branch and let the PR run it.

## Compiler and portability constraints

- **MSVC (cl) is the primary compiler; all code stays portable to clang-cl and GCC.**
- MSVC flags: `/permissive- /W4` with warnings-as-errors; GCC/Clang: `-Wall -Wextra -Werror`.
- No compiler-specific intrinsics or builtins without a portable fallback; prefer C++20 `<bit>` (`std::popcount`, `std::rotr`, `std::bit_cast`) over MSVC/GCC builtins.
- **SIMD ISA level is the `ENGINE_SIMD` CMake option (SSE2 | AVX2 | AVX512), default AVX2 - never hardcoded.** The dev machine (9800X3D) has AVX-512 but the deployment server does not; AVX2 is the shipping floor.
- **Floating point stays strict: `/fp:precise`, and never fast-math anywhere in the solver core.** Reproducibility matters for PioSolver validation; a fast-math "optimization" invalidates the acceptance gate.

## The vectorized-public-tree design (do not regress this)

- Public tree nodes are **public states** (board, betting sequence, pot, stacks). An infoset is a `(public state, private hand)` pair. Private hands never appear in the tree.
- Every traversal computes values for **all hands at once** via range vectors. **Never add a per-(node, hand) recursive walk** - that is the naive tree walker this design exists to avoid.
- Cumulative regret and strategy live in **flat f32 arrays** at `node_offset + action * num_hands + hand` (`InfosetLayout` in `src/solver/cfr.hpp`). CFR is memory-latency-bound with poor locality: keep hot data flat and SoA; layout beats instruction-level cleverness here.
- **The layout is ACTION-MAJOR and that is load-bearing.** Every hot loop walks hands for a fixed action, so hand-major made them stride-`actions` scatters across the hand universe - cache-hostile and unvectorizable. Only the per-hand normalization in regret matching wants the other order, and that is 2-5 elements wide. `average_strategy()` / `current_strategy()` still emit hand-major rows because that is the public contract the artifact writer and the best-response pass read; the transpose lives in those two accessors and nowhere else.
- **Per-hand arrays are sized by the COMPACT hand universe, not by 1326** (`src/ranges/universe.hpp`). The universe is the combos with non-zero weight in at least one starting range after root-board removal, in ascending canonical order, shared by both seats. A combo neither seat can hold has zero reach everywhere and contributes an exact `0.0` to every sum, so dropping it changes no other hand's number - this is **not** the hand abstraction that is out of scope, nothing is merged or estimated. It is shared rather than per-seat because terminal showdown indexes hero and villain into one sorted-by-strength structure, and because the schema-4 exporter takes seat 0's dictionary as the bundle-wide `hand_order`.
- Terminal showdown evaluation with card removal is the hot path. The 2-player path is the sort-by-strength single sweep with inclusion-exclusion blocker correction (`src/eval/terminal.cpp`). The multiway path is a marked correct-but-slow seam (`showdown_share`) awaiting the M8 milestone.
- The seat count and seat->agent partition are **never hardcoded** (`src/solver/agents.hpp` is the single source of truth). Only the identity partition is implemented today, but every data structure is N-seat-shaped.
- Utility convention: terminal value = share of final pot minus post-root commitment, so root EVs across seats sum to the root pot (Pio's convention). NashConv is invariant to this reference.
- `CfrSolver::scratch` buffers are pre-sized for the tree depth in the constructor; callers hold references across recursion, so an arena must never grow mid-traversal.
- **The DCFR discount is deferred, and `run()` is the only thing that settles it.** Per-iteration factors live in a history; a node pays everything it owes on its next visit (compounded into one product per sign - exact, because regret signs cannot change while a node is unvisited), and `run()` flushes the remainder so callers read exactly what an eager sweep would have produced. `iterate()` is private for this reason. The history exists because the recalc schedule can leave a node unvisited for several iterations; with recalc off a node owes at most one factor and the result is bit-for-bit the old sweep. Anything new that reads regrets or strategy sums (a pruning pass, QRE) must either run inside the traversal or flush first.
  The trap this replaced is worth remembering: discounting a node the moment its own seat finishes with it is NOT equivalent, because a traversal for seat p reads every decision node (regret matching runs at opponent nodes too) even though it writes only its own.
- **Suit isomorphism (`isomorphism`, default true) is a lossless relabeling with ONE compatibility rule.** Member subtrees own no solver storage; every read goes through `Game::iso_rep()` and the `average_strategy()` redirect, which is what keeps the artifact, the C# reader, the frontend and the Pio harness unchanged. Anything new that reads per-node solver state must go through those accessors, never through `InfosetLayout` offsets directly (member nodes carry the `kNoOffset` sentinel and zero hands). Collapse legality is checked per node (board fixed set-wise) and per solve (both ranges invariant, weight-for-weight); an asymmetric range disables the feature entirely rather than collapsing partially.
- **The recalc schedule (`algorithm.recalc`) is deterministic and budget-annealed.** It never engages until the caller feeds it measured exploitability via `set_recalc_budget()`, its aggressiveness is feedback-controlled so stalls self-correct toward plain CFR, and `tests/test_recalc.cpp` asserts the skip count and solution are identical on 1 and 8 threads. Do not replace the annealed budget with a fixed epsilon - fixed thresholds were measured to stall convergence at exactly the threshold - and do not add catch-up weighting to skipped updates - measured to inflate iteration counts, worse than the skipping it compensates for.

## Multithreading: same numbers at any thread count

`threads` in the config is live (0 = one per hardware thread, negative = leave that many cores free). `src/util/parallel.hpp` holds the pool; `CfrSolver` and `compute_best_response` fork sibling subtrees onto it.

- **Bitwise determinism is a hard invariant, not a nice-to-have.** Sibling subtrees write disjoint slices of the flat regret/strategy arrays, and every cross-child accumulation happens serially in child order after the join. A change that makes 16 threads disagree with 1 thread in the last bit has broken the PioSolver acceptance gate, which is calibrated against exact numbers. `tests/test_parallel.cpp` asserts exact equality (Leduc and an NLHE turn tree) - keep it exact; never relax it to a tolerance.
- **Anything the traversal touches must be immutable during a solve.** That is why the per-runout showdown evaluators are built eagerly and in parallel in `NlhePostflopGame`'s constructor instead of lazily on first touch: terminal evaluation is the hot path, and a lazy cache there is either a data race or a lock on every showdown.
- `ThreadPool::parallel_for` is re-entrant - a thread waiting on its own batch runs tasks from other batches instead of blocking - so nested forks cannot deadlock a saturated pool.
- Forking is bounded by a fan-out budget (`threads * 4`, divided among children at each fork) and by `kMaxSplitLevels`. The memory estimator's workspace term is a ceiling derived from that bound; it deliberately over-reserves rather than undershooting.

## The artifact format is a versioned contract

Spec: `docs/artifact-format.md`.
Any layout change bumps the format version and updates - in one commit - the spec, `src/io/artifact_writer.cpp`, `src/io/artifact_reader.cpp`, the C# `backend/Services/EngineArtifacts/EngineArtifactReader.cs`, and regenerates the fixture pair `backend/Tests/Fixtures/engine/tiny_river.{hta,golden.json}` (commands in `configs/fixtures/tiny_river.json`).

All storage goes through `ArtifactStore` (`src/io/artifact_store.hpp`) - open/write/seek/read-range/close over an opaque path.
No filesystem calls in solver code; `LocalStore` is the only implementation, and an `AdlsStore` must be able to drop in without touching solver code.

## Hard dependency rules

- **Zero cloud SDKs, zero Firebase, zero GUI dependencies, ever, in this binary.** Uploading artifacts to ADLS is someone else's job (backend/watcher).
- External deps are exactly: nlohmann/json and doctest, pinned by URL hash in CMakeLists. Everything else (SHA-256, hand evaluator, CLI parsing) is vendored/self-contained. Keep it that way.

## Memory discipline

- `src/solver/memory.cpp` estimates solver memory from the layout before allocating; `solve` fails fast against `memory_limit_gb` and `dry-run` prints the estimate without solving. **Update the estimator whenever per-node solver state grows** - it must not drift from reality.
- Every solve logs peak RSS into the artifact metadata.
- Sizing rule of thumb: `bytes ~ sum over decision nodes of actor_hands x actions x 8` (regrets + strategy sums, f32 each), where `actor_hands` is the **compact universe size** - so a 15%-range spot really does cost a fraction of a 100%-range one.

## Honesty notes (keep these in docs and metadata)

- **CFR has no Nash guarantee with 3+ players.** It converges to the coarse correlated equilibrium set; multiple Nash equilibria may exist with no principled selection. Pluribus did it anyway and it worked empirically - state of the art, not a theorem. Surfaced as `multiway_no_nash_guarantee` in artifact metadata.
- **A QRE solve must never be GATED against Pio, and its differences from Pio must never be reported as error.** That is the whole invariant, and it is narrower than "never compared": Pio may solve the identical tree for Nash beside a QRE run, and reading the two grids side by side is how you see what bounded rationality did. What `watcher/engine_compare.py` refuses is `--cross-check` (Pio rating how exploitable a deliberately non-Nash strategy is - the feature, not a defect); root-EV differences are labelled as expected rather than printed as a bare diff. Entropy-regularized CFR's QRE convergence carries the same "empirical in multiway" caveat as CFR itself.
- **A fixed-lambda QRE has a Nash-exploitability FLOOR of roughly `2*D*log(A)/lambda` chips, by construction.** It converges to the QRE, not to Nash, so plain exploitability plateaus and can never reach a tight `target_exploitable_pct`. That is why a QRE solve stops on the **QRE gap** (`compute_qre_best_response`) and prints both numbers. Do not "fix" the plateau; `tests/test_qre.cpp` pins it deliberately.
- **QRE is a modelling feature, never a speed one. On FLOP trees at SPR 4-10 annealed lambda is 1.3x to 1.9x SLOWER than dcfr, and worse the deeper the stacks** (`docs/roadmap.md` M7 has the table). The iteration saving collapses with depth - 1.41x at SPR 4, 1.13x at 7, 1.07x at 10 - while the per-iteration overhead climbs to 1.85-2.03x, because a deeper stack charges the regularizer at more of the actor's own decision points per iteration while the homotopy's fixed head start becomes a smaller slice of a longer solve. Do not repeat the earlier "1.44x faster" claim, or the "wash" that replaced it; both came from shallower trees. Reducing the overhead is not a lever either - four attempts are recorded above, all slower.
- **Collusion solving is research/analysis tooling** (standard published game theory; how collusion-detection work is done). Using it against live real-money tables is cheating and bannable everywhere.

## Out of scope (do not build speculatively)

GPU code, hand abstraction/bucketing, TMECor / coordination-without-card-visibility, cloud SDKs inside the engine, one-file-per-node output.

## Milestone state

The durable roadmap (goal product, milestone status, next steps) is `docs/roadmap.md` - keep it updated when milestones move.

M0-M6 delivered (Kuhn, Leduc + CI, HU NLHE river Nash, artifact + C# reader, Pio harness, render path).
The M5 acceptance gate passed 2026-08-25 on a real full-range river spot (`configs/validate_river_fullrange.json`): Pio's own evaluator rated the engine strategy exploitable for 0.0 chips.
The harness's primary gate is cross-exploitability (engine strategy loaded into Pio via set_strategy), NOT per-hand L1 - per-hand strategies legitimately differ between equilibria; keep it that way.
It is now **opt-in** (`engine_compare.py --cross-check`) and off in the queue path, because PioSolver is being retired and most /compare runs are engine-only: a validation sweep has to ask for it explicitly, and a run without it reports "no verdict" rather than a PASS.
The reach-weighted per-hand L1/EV diagnostics were removed with the per-solver payload split - each solver writes its own `.htc` and agreement is judged by eye on the two grids.
**M7 QRE landed** (`qre.mode: "qre"`, per-seat `qre.lambda`, optional `qre.anneal`): entropy-regularized CFR as a REWARD TRANSFORMATION inside `traverse_impl`'s actor branch, not a replacement for regret matching. Each action's counterfactual value is charged `pi(h) * (1/lambda) * (log sigma + log A)`, where `pi(h)` is `Game::compat_weights` - the dilation, and load-bearing: softmax is not scale-invariant, so without it one lambda would mean a different rationality at every infoset. Because only the values fed into the regrets change, `regret_matched_action_major`, `row_from_action_major`, both strategy accessors, the artifact exporter, the C# reader and the frontend are all untouched, and the average strategy is still the answer. Anything that changes this must keep that property.

Still deferred: `fit-lambda` (MLE from observed frequency counts - needs hand-history frequency plumbing that does not exist yet), M8 multiway + side-pot fast path, M9 collusion best-response, M10 Bayesian unknown-collusion (`agents.collusion.p`).
