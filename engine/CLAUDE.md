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

## Compiler and portability constraints

- **MSVC (cl) is the primary compiler; all code stays portable to clang-cl and GCC.**
- MSVC flags: `/permissive- /W4` with warnings-as-errors; GCC/Clang: `-Wall -Wextra -Werror`.
- No compiler-specific intrinsics or builtins without a portable fallback; prefer C++20 `<bit>` (`std::popcount`, `std::rotr`, `std::bit_cast`) over MSVC/GCC builtins.
- **SIMD ISA level is the `ENGINE_SIMD` CMake option (SSE2 | AVX2 | AVX512), default AVX2 - never hardcoded.** The dev machine (9800X3D) has AVX-512 but the deployment server does not; AVX2 is the shipping floor.
- **Floating point stays strict: `/fp:precise`, and never fast-math anywhere in the solver core.** Reproducibility matters for PioSolver validation; a fast-math "optimization" invalidates the acceptance gate.

## The vectorized-public-tree design (do not regress this)

- Public tree nodes are **public states** (board, betting sequence, pot, stacks). An infoset is a `(public state, private hand)` pair. Private hands never appear in the tree.
- Every traversal computes values for **all hands at once** via range vectors. **Never add a per-(node, hand) recursive walk** - that is the naive tree walker this design exists to avoid.
- Cumulative regret and strategy live in **flat f32 arrays** at `node_offset + hand * num_actions + action` (`InfosetLayout` in `src/solver/cfr.hpp`). CFR is memory-latency-bound with poor locality: keep hot data flat and SoA; layout beats instruction-level cleverness here.
- Terminal showdown evaluation with card removal is the hot path. The 2-player path is the sort-by-strength single sweep with inclusion-exclusion blocker correction (`src/eval/terminal.cpp`). The multiway path is a marked correct-but-slow seam (`showdown_share`) awaiting the M8 milestone.
- The seat count and seat->agent partition are **never hardcoded** (`src/solver/agents.hpp` is the single source of truth). Only the identity partition is implemented today, but every data structure is N-seat-shaped.
- Utility convention: terminal value = share of final pot minus post-root commitment, so root EVs across seats sum to the root pot (Pio's convention). NashConv is invariant to this reference.
- `CfrSolver::scratch` buffers are pre-sized for the tree depth in the constructor; callers hold references across recursion, so the pool must never grow mid-traversal.

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
- Sizing rule of thumb: `bytes ~ sum over decision nodes of actor_hands x actions x 8` (regrets + strategy sums, f32 each).

## Honesty notes (keep these in docs and metadata)

- **CFR has no Nash guarantee with 3+ players.** It converges to the coarse correlated equilibrium set; multiple Nash equilibria may exist with no principled selection. Pluribus did it anyway and it worked empirically - state of the art, not a theorem. Surfaced as `multiway_no_nash_guarantee` in artifact metadata.
- **A QRE solve is not Nash and must never be compared to Pio.** The harness (`watcher/engine_compare.py`) refuses; keep it that way. Entropy-regularized CFR's QRE convergence carries the same "empirical in multiway" caveat as CFR itself.
- **Collusion solving is research/analysis tooling** (standard published game theory; how collusion-detection work is done). Using it against live real-money tables is cheating and bannable everywhere.

## Out of scope (do not build speculatively)

GPU code, hand abstraction/bucketing, TMECor / coordination-without-card-visibility, cloud SDKs inside the engine, one-file-per-node output, multithreaded traversal (the `threads` config key is reserved; current solver is single-threaded and fast enough for river trees).

## Milestone state

The durable roadmap (goal product, milestone status, next steps) is `docs/roadmap.md` - keep it updated when milestones move.

M0-M6 delivered (Kuhn, Leduc + CI, HU NLHE river Nash, artifact + C# reader, Pio harness, render path).
The M5 acceptance gate passed 2026-08-25 on a real full-range river spot (`configs/validate_river_fullrange.json`): Pio's own evaluator rated the engine strategy exploitable for 0.0 chips.
The harness's primary gate is cross-exploitability (engine strategy loaded into Pio via set_strategy), NOT per-hand L1 - per-hand strategies legitimately differ between equilibria; keep it that way.
Deferred with schema/plumbing already in place: M7 QRE (`qre.mode`, per-player lambda, annealing, `fit-lambda`), M8 multiway + side-pot fast path, M9 collusion best-response, M10 Bayesian unknown-collusion (`agents.collusion.p`).
