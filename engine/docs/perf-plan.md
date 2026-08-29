# Competitive performance plan

Why jesolver and GTO Wizard are faster than PioSolver, what of it applies to htsolver, and in what order.
Written 2026-08-28 after a research pass; `docs/roadmap.md` stays the milestone record and this is the standing argument behind the next few performance milestones.

> **Direction, settled 2026-08-29.** The target is **GTO Wizard AI / Ruse-style depth-limited solving**, chosen for **multiway** speed, and the product needs **on-demand solving as well as a precomputed library**.
> The **jesolver track was picked first only because it looked easier to implement, and it is now largely spent** - five independent attacks measured neutral or negative (M7.2 in `roadmap.md`), because M6.8's action-major layout and compact hand universe had already bought what jesolver's changelog was buying.
> Read the tier list below as *finished work plus a few cheap leftovers*, not as the plan. The plan is "The fork" section.

## The one thing to get right first

**The two competitors are fast for unrelated reasons, and conflating them produces bad plans.**

**jesolver is the same computation, engineered harder.**
Written by Oskari Tammelin, who invented CFR+ and co-authored the Cepheus paper.
It is exact, abstraction-free vector CFR, like this engine and like Pio.
Vendor benchmarks claim 4.1-13.1x over PioSOLVER 1.6 (roughly 2016); the better-sourced 2+2 community figure is 3-5x to 0.25% of pot, growing as the accuracy target tightens.

**GTO Wizard is not running the same computation.**
GTO Wizard AI (the Ruse AI acquisition, 2023) is depth-limited solving with a neural counterfactual-value network: it solves one street at a time and replaces the whole remaining subtree with a learned value estimate.
The headline "6 s vs 4862 s" compares a one-street lookahead against a full four-street exact solve, on 2 cores against 16.
Their own multiway post gives the honest framing: street-by-street solving is a **30000x complexity reduction**.
Two tells confirm it - they solve **rivers exactly, with no neural network at all** (no future left to approximate), and their own *classical* engine still needs "multiple minutes on machines with 64 cores" for 3-way turn spots.

**Consequence for planning: jesolver is a roadmap this engine can follow. GTO Wizard is a different product category.**

## Hand abstraction is the wrong door

This gets offered as the lever whenever solve time hurts, so it is worth settling once.

Hand bucketing is **not** what makes GTO Wizard fast - they explicitly market abstraction-free solving and argue bucketing produces counterintuitive combo selections.
Depth-limiting is what makes them fast.
For htsolver specifically, bucketing is the worst available trade: it destroys the per-combo grids `/solutions` and `/compare` render, it invalidates the Pio gate, and the compact hand universe already banks most of the win on the realistic ranges anybody actually solves (roughly 190 live combos against 1176).

**The abstractions worth accepting are action abstraction (bet-size pruning) and depth-limiting. Keep the door shut on hands until PLO forces it open.**

## The jesolver evidence, because it is unusually good

The [changelog](https://jesolver.com/download/free/changelog.txt) is a seven-year record of what actually moved, with percentages attached: compression modes (+55%), AVX2 (+25%), more SIMD (+15%), compiler update (+8%), prefetching, NUMA (+5-15% on big trees), auto-tuned params, AVX-512 (up to +25%), P-core/E-core awareness (+20%+).

**There is not one entry about a new equilibrium-finding algorithm.**
Every one is memory system, precision, ISA width, or scheduling.
That is the single most useful fact in this document, and it matches this engine's own measurements: dcfr 1100 iterations vs cfr_plus 2000 vs plain RM not converging inside 20000.

The knobs it ships are equally informative.
`set_compression` defaults to `fast` (~68% of uncompressed) and `max` reaches ~25%; a compression mode being both the *default* and sometimes *faster than no compression* is the tell that they trade ALU cycles for memory bandwidth and win.
`enable_adaptive_precision` is on by default and is documented as improving "performance and/or memory".
`enable_river_strategy 0` "nearly halves memory usage".
`set_recalc_accuracy <flop> <turn> <river>`, `solve_partial`, `solve_all_splits` are the same family as this engine's `algorithm.recalc`.
A shipped [per-CPU tuning table](https://jesolver.com/cpu_tuning.txt) sets opposite prefetch and eval modes on Intel and AMD.

## Where htsolver stands

M7.1 (the DCFR gamma sweep) changed the picture materially, so the older rows in `roadmap.md` understate it.

Measured after M7.1:

| | |
|---|---|
| turn, 100% ranges | **1.17x faster than Pio** (0.93-1.66x), 10/10 passing the gate - was 0.71x |
| `validate_turn_fullrange` gate | engine strategy **0.016 chips** exploitable per Pio, vs 0.019 for Pio's own solve |
| flop SPR 10, tight | 94.1 s -> **44.9 s** |
| flop SPR 7, tight | 40.5 s -> **18.0 s** |

**htsolver is now ahead of PioSolver in every family it has been swept on**, which puts it inside the band the community reports for jesolver on the families measured.

Not yet re-measured against Pio after M7.1: the tight-range turn and river families and the 100%-range river family.
Those were 3.43x / 18.2x / 8.1x before the gamma change and can only have improved, but the numbers are stale rather than wrong, and re-running `bench_boards.py --ranges tight` is the cheap way to make the claim precise.

## The ladder

### Done

**Tier 0 - DCFR exponent sweep.** M7.1. Roughly 2x on every family, from a constant nobody had swept.

### Next

**Tier 1 - i16 storage. PARTLY MEASURED 2026-08-28, and the result is a wash - read M7.2 in `roadmap.md` before spending more on this.** The strategy-sum half shipped as `algorithm.precision: "i16"`: 25% less solver memory, speed indistinguishable from f32 over three interleaved rounds. The regret half is now argued AGAINST on the measurement, not merely unstarted - it would pay the float/int conversion ~5x per cell against the strategy array's 1x, for 3x the traffic saved. What follows is the original reasoning, kept because the mechanism is still right and only its size was wrong here.

**Tier 1 (original) - i16 regrets and strategy sums with a per-node f32 scale.**
The flagship, and the largest remaining structural gap against jesolver.
`regrets_` and `strat_sum_` are both f32 today, so the `actor_hands x actions x 8` sizing rule becomes `x4`.
postflop-solver measures 1.25 GB -> 660 MB doing exactly this.
Flop trees run at 1.6-3.1 GB and are far past the 9800X3D's 96 MB V-Cache either way, so halving the bytes roughly doubles effective bandwidth on the dominant traffic - which is why compressed can beat uncompressed rather than merely fitting better.

Use **i16 with a per-node scale, not IEEE f16**: every implementation that ships this uses fixed point, because f16 spends bits on an exponent that regret accumulation does not need, and a per-node scale bounds the error far better than a global one.

The invariant story matters and is narrower than it first looks.
Quantization threatens the **golden fixture and the Pio gate calibration**; it does **not** threaten **bitwise determinism across thread counts**, because quantization is itself deterministic.
So `tests/test_parallel.cpp` can keep asserting exact equality in either mode.
Ship it as `precision: {f32 | i16}` with f32 as the gated validation path and the fixture untouched, and give i16 its own acceptance test (agreement with the f32 solve to within a stated exploitability delta).
That is exactly the shape jesolver uses, and its adaptivity means precision *rises* automatically as the target tightens.

**Tier 2 - the terminal-evaluator gather. MEASURED 2026-08-29 AND REFUTED. The fix proposed below is 0.82x - it makes things SLOWER.**
`tools/qbench.cpp` models the totals sweep both ways: gather-in-place as the engine does it today, against pre-permuting into contiguous order (with `hi`/`lo` pre-permuted at construction, which is free) and sweeping.
Contiguous measured **0.82x**, a banked-histogram variant **0.76x**, and removing the 52-bin scatter *entirely* only reaches **1.12x**.
The premise was wrong in two ways: a 536-hand reach vector is ~2 KB, so it and the index permutation are **L1-resident** and a gather from L1 is cheap; and the loop is latency-bound on the dependent double-precision accumulation rather than on its loads, so adding a pre-gather pass costs more iterations than the contiguous access saves.
Its ceiling is 1.12x and the standard fixes overshoot it. Left below as written because the reasoning is a good example of a plausible optimization that measurement kills.

**Tier 2 (original, refuted) - the terminal-evaluator gather.**
`RiverEvaluator::compat_reach` and `showdown_2p` in `src/eval/terminal.cpp` run `for (int i : sorted_)`, an indirect gather through a permutation, in the hottest loop in the solver.
It cannot autovectorize, and this engine has no explicit SIMD anywhere - it relies entirely on `/arch:AVX2` autovectorization, which succeeds in `plain_fold_in` and fails here.
The fix is the standard one: permute `opp_reach` into strength order once per call, sweep contiguously, permute back.
This is very likely what jesolver's undocumented `set_eval_mode <0..3>` / `set_eval_cap 72` control, and it would explain why the optimal mode differs between Intel and AMD, since gather throughput does.
It is also the piece that scales worst into PLO, so it earns its place twice.

**Tier 3 - an `enable_river_strategy 0` equivalent.**
"Nearly halves memory" per jesolver.
River decision nodes dominate a multistreet tree's node count and their strategy is recoverable from regrets; the cost is losing exact exploitability, so keep it on for gated runs and off for production sweeps.

**Tier 4 - Regret-Based Pruning** ([arXiv:1609.03234](https://arxiv.org/abs/1609.03234)) inside `traverse_impl`, following the QRE reward-transformation pattern.
Order-of-magnitude space reduction claimed, growing with game size, exactness preserved.
Note the existing warning: anything that reads regrets or strategy sums must run inside the traversal or flush the deferred discount first.

**Not on the ladder, and prefetch tuning aside: skip NUMA.**
The 9800X3D is single-socket, single-node.
It only pays on a deploy server or cloud instance.

### Ruled out, with the reason

- **PCFR+ / predictive Blackwell.** Beats CFR+/DCFR by up to two orders of magnitude on non-poker games and is measured *slower than DCFR* on poker river endgames ([AAAI'21](https://arxiv.org/pdf/2007.14358)). The stale `configs/_bench/ftt_pcfr.json` and `ftt_pdcfr.json` name update rules the parser does not accept; they are aspirational leftovers, not results.
- **MCCFR for postflop.** The CFR+ paper explicitly outperforms Public Chance Sampling and Pure CFR. `SamplingConfig` already records the same conclusion and scopes itself to preflop.
- **Lock-free atomic regret updates.** Published, and it would destroy bitwise determinism across thread counts.
- **GPU for exact vectorized CFR.** The 200-400x figures are against naive OpenSpiel per-infoset tree walkers, not against a vectorized engine. GPU earns its place for batched neural-network inference at lookahead leaves, which is GTO Wizard's shape, not this one.
- **Micro-optimizing the fold-in loops.** Already restrict-qualified, action-major, invariant-hoisted, branch-free, with packed ops confirmed by `dumpbin`. No meaningful headroom.

## The fork, and it is decided: depth-limiting

Tiers 1-4 plausibly take flop trees from 44.9 s to somewhere in the 15-25 s range and would put htsolver clearly ahead of Pio and competitive with jesolver everywhere.

**They will not reach GTO Wizard's 6 seconds, and no amount of engineering will.**
That 30000x is structural.

**An earlier version of this document argued that did not matter, on the grounds that "this pipeline already precomputes" and solve time is therefore a machine-hours cost rather than a user-facing one. That premise was wrong and the conclusion drawn from it should be ignored.**
The product wants BOTH: a precomputed library for common spots AND users solving their own trees on demand.
On-demand means somebody is waiting, which puts solve time back inside the product.
See `roadmap.md`, "The goal product".

**So depth-limited solving is the intended direction rather than an option to weigh, and MULTIWAY is why.**
A 3-way tree is at least 8x its heads-up equivalent, and GTO Wizard's own classical engine needs "multiple minutes on 64 cores" for a 3-way turn.
Nobody ships exact full-tree multiway at interactive speed.
Their shape - exact on the river, depth-limited on turn and flop - is the one that works, and M8 should be designed for it rather than built exact-only and retrofitted.

Two routes to it, and they are a real choice rather than a formality:

**A learned value network**, which is what Ruse/GTO Wizard actually did.
Highest ceiling, and the only one with a track record at 3+ players.
Costs: an offline training pipeline that does not exist yet, and the artifact's numbers stop being exact, which weakens the Pio gate as the trust mechanism and weakens the "these are the real collusion EVs" claim behind M9/M10.

**A continuation-strategy portfolio** ([Brown & Sandholm, NeurIPS 2018](https://arxiv.org/pdf/1805.08195)): at the street boundary each agent picks among a small set of precomputed continuation strategies rather than a single learned value.
No neural network, deterministic, provably converging to Nash as the portfolio grows, works with very few strategies, and **exact conditional on the portfolio** - so the Pio gate keeps its meaning.
Lower ceiling than a value net, far cheaper to build, and it preserves every invariant this engine has.

**Recommended sequencing: portfolio first, network later if it is not enough.**
The portfolio is the cheaper experiment, it answers "does depth-limiting actually buy what we need on a 3-way tree" without a training pipeline, and if it falls short the value-network work starts from a depth-limited engine that already exists rather than from scratch.

## Preflop and PLO

**Preflop is where the postflop playbook stops working.**
jesolver's own page still says the preflop functions "are not there yet", seven years in.
Every shipping preflop solver abstracts, samples, or uses learned continuation values; `SamplingConfig`'s comment already reaches that conclusion independently.
The continuation-strategy portfolio above is the lowest-conflict route, and Dynamic-Sizing-style iterative bet-size pruning attacks preflop node count multiplicatively and independently of it.

**PLO makes the existing design choices better, not worse.**
270,725 combos against 1,326 is a ~204x blowup in the hand dimension, but the compact universe scales with the universe rather than a constant, and the action-major layout *improves* at n ~ 50,000 because the contiguous SIMD runs get longer.
Two things to know: compression stops being optional at that scale, and **the terminal evaluator is the wall** - the 5-choose-2-of-board x 2-of-hand evaluation is far costlier per hand and the blocker inclusion-exclusion runs over 4 cards rather than 2.
Prototype that before anything else PLO-related.

## Caveats on the evidence

jesolver's 4.1-13.1x is vendor-published against a 2016 Pio; the 3-5x community figure is better sourced.
GTO Wizard publishes essentially no implementation detail, so the depth-limited reconstruction above is inference from marketing posts plus the academic literature, not documentation.
jesolver's `set_eval_mode` / `set_eval_cap` are undocumented; reading them as terminal-evaluation batching is inference from the shipped values and the Intel/AMD split.

## Sources

- [Jesolver changelog](https://jesolver.com/download/free/changelog.txt), [command reference](https://jesolver.com/cmdref.html), [CPU tuning](https://jesolver.com/cpu_tuning.txt), [beta page](http://jeskola.net/jesolver_beta/)
- [Solving Large Imperfect Information Games Using CFR+](https://arxiv.org/abs/1407.5042), [Revisiting CFR+ and Alternating Updates](https://arxiv.org/html/1810.11542)
- [GTO Wizard AI Explained](https://blog.gtowizard.com/gto-wizard-ai-explained/), [Benchmarks](https://blog.gtowizard.com/gto-wizard-ai-benchmarks/), [Custom Multiway Solving](https://blog.gtowizard.com/gto-wizard-ai-custom-multiway-solving/), [Introducing QRE](https://blog.gtowizard.com/introducing-quantal-response-equilibrium-the-next-evolution-of-gto/), [Dynamic Sizing](https://blog.gtowizard.com/dynamic-sizing-a-gto-breakthrough/)
- [postflop-solver](https://github.com/b-inary/postflop-solver) and [wasm-postflop benchmarks](https://github.com/b-inary/wasm-postflop) - DCFR gamma 3, i16 + f32 scale, bunching
- [Discounted Regret Minimization](https://arxiv.org/abs/1809.04040), [Predictive Blackwell Approachability](https://arxiv.org/pdf/2007.14358), [Regret-Based Pruning](https://arxiv.org/abs/1609.03234), [Depth-Limited Solving](https://arxiv.org/pdf/1805.08195)
