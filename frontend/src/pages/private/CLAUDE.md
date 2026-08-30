# /private - client tools

Pro-tier page (`useCurrentTier().isPro`) holding two tools built for a paying client.
Routable but deliberately absent from `NavBar`, the same way `/equity` is.
All compute is client side, in workers, with no backend involved.

| File | Role |
|---|---|
| `PrivatePage.tsx` | Tier gate and the tab switcher |
| `RankingsTab.tsx` | Top X% hand rankings: hold'em, Badugi, Badugi with 1-3 draws |
| `TaiwaneseTab.tsx` | Taiwanese hand-setting advisor (one hand) |
| `AdvancedTab.tsx` | Full-table dealer: every player sets their best pre-board split, board resolves, click a player for their ranking |
| `useAdvancedSolves.ts` | Runs the advisor worker once per player, sequentially |
| `SplitRows.tsx`, `BreakdownTable.tsx` | Shared split and scoresheet renderers |
| `ScoringExplainer.tsx` | Readout of how Taiwanese scoring is configured, opened from the advisor's info button |
| `taiwaneseScoring.ts` | Derives that readout from the scoring code |
| `ScoringVerifier.tsx` | Score checker: enter a real deal, see per-player points from the same code; opened from the page's info button |
| `protocol.ts` | Worker message types, shared with `src/workers/` |
| `useRankingsSim.ts`, `useTaiwaneseSolve.ts` | One worker per run, terminated on cancel, re-run and unmount |
| `scripts/taiwanese-ev-audit.mjs` | `npm run audit:taiwanese`: what the #1 EV number means, measured off-browser |

Both of those render bare content with no container of their own: they live inside
`components/InfoButton` overlays, which supply the heading, the padding and the scroll
region.
That is deliberate - the page is inputs and results, and everything explanatory sits one
tap away rather than between them.

Game logic lives in `src/lib/` (`badugi.ts`, `taiwanese.ts`, `handEval.ts`), not here.
Workers must only import from `src/lib/`, never from a page module that pulls in React.

## The rules and where they came from

Two published sources the client designated as official (fetched 2026-08-23):

- <https://www.pokernews.com/poker-rules/taiwanese-poker.htm>
- <https://infogram.com/taiwanese-poker-rules-1hmr6gldm7w84nl>

plus the client's home-game specifics, relayed from his friend (2026-08-23).

Common ground, always in force: row wins pay top 1 / middle 2 / bottom 3, per board, and
**any card may be set in any row** (an earlier pre-board setting rule was removed at the
client's request; a real home-game deal shows an ace set on top over a weaker middle).

The **royalties toggle** switches between two rule sets that differ in settlement shape,
not just the bonus chart:

- **Off = house rules** (the default; it is the client's actual game): **every pair of
  players settles separately**. Per board per row the better hand takes the row's points
  from the other; sweeping every row on every board against one specific opponent takes an
  8-point scoop from that opponent. No royalties. Vs one opponent this gives the stated
  maxima: 6 + 8 = 14 single board, 12 + 8 = 20 double.
- **On = PokerNews rules**: the **outright best hand in each row collects from every other
  player** (second best collects nothing), royalty chart added to the winner's collect,
  ties split and pay nothing, and a scoop (every row on every board outright, vs the whole
  table) pays **3** from everyone. Where PokerNews and Infogram contradict each other, the
  client chose the PokerNews reading: losers pay the winner's royalty in full even when
  their own hand would qualify (Infogram's example waives it).

The pairwise house shape is not guesswork: it was reverse-engineered from, and verified
against, a real scored 4-player double-board deal from the client's game (2026-08-24).
That deal is the `ScoringVerifier` example fixture, with its expected scoresheet in the
comment above it; house scoring must reproduce those numbers exactly.
Winner-take-all scoring provably cannot (two players who tie a row net 0 pairwise but
would both pay under winner-take-all).

## Rule: the page explains the rules by reading them, not by restating them

The client has already been burned by a rules misunderstanding, so the page has to show
what the code actually does, and has to keep showing it correctly after the code changes.

`taiwaneseScoring.ts` therefore derives every demo number by **calling `scoreDealHero` on
constructed tables**, under the settings currently selected in the UI, and printing what it
returns.
It does not do points arithmetic in prose, and `ScoringExplainer.tsx` contains no scoring
numbers of its own; the royalty chart it shows is printed verbatim from `ROYALTY_TABLE`,
never re-typed.
A change to scoring in `src/lib/taiwanese.ts` moves the on-page text with it, with nothing
else to remember.

**When you change how scoring works:**

- Change it in `src/lib/taiwanese.ts` only.
  `scoreDealAll` is the single place points are decided; the advisor worker (via the
  `scoreDealHero` wrapper), the explainer, and the score checker all go through it.
- After any scoring change, open the score checker on the page: its preloaded example must
  still reproduce the real scoresheet in house mode. If it stops matching, the change broke
  the house rules (or the client's rules genuinely changed, in which case update the
  fixture and its expected numbers together).
- Never hardcode a points value into JSX, a comment, or a string anywhere in this folder.
  If you catch yourself typing a number that scoring produces, add a probe to
  `scoringLines()` instead and print that.
- If the change adds a rule that no existing line demonstrates, add a `scoringLines()`
  entry that exercises it. An unexercised rule is one the client cannot verify.
- `SOURCE_FACTS` in `taiwaneseScoring.ts` is the one deliberately hand-written block: the
  numbers the rule sources state outright, the outside reference `sourceChecks()` compares
  the code against.
  Update it only when the agreed rules change.
  Never edit it to silence a failing check, since that check failing is the page doing its
  job.

## EV semantics (both advisor tabs)

Splits are committed PRE-BOARD: each split's EV is its average net points over random
unseen boards and random opponent hands, so the ranking answers "what should I set before
seeing anything", never a hindsight pick.

Two opponent models, chosen by the "Opponent model" toggle (self-play is the default):

- **Heuristic (fast)**: opponents set their hands with `heuristicSplit`, a fixed
  board-independent rule. EVs are best-response-to-that-model numbers and average about
  +1 per opponent over random hands rather than zero (measured; hero playing the same
  heuristic averages zero, half the hands negative).
- **Self-play**: policy iteration toward the setting equilibrium, in the worker's
  `build-library` op. It samples a fixed set of hands, solves each one's best-response
  split against the previous round's policy (round 1 responds to the heuristic), and the
  solved library becomes the opponent policy: solves then draw opponents' hands AND splits
  from it (rejection sampling keeps hands card-disjoint). Setting is a ONE-SHOT
  simultaneous decision, so iterated best response reaches the same fixed point CFR would
  without CFR's per-infoset machinery; a policy that is a best response to itself is the
  equilibrium. Convergence evidence ships with the library: `prevPolicyEvLoss` = points
  per deal that re-optimizing gains over the previous round's choices (an upper bound -
  argmax noise inflates it; ~0.4 at current settings means effectively converged). Do NOT
  judge convergence by exact-split agreement: many splits are near-exact EV ties, so the
  argmax flips freely among them. The library is cached per
  (opponents, boards, royalties) for the session; building takes under a minute.

Under self-play opponents, weak random hands price NEGATIVE as they should; under the
heuristic they mostly price positive (the optimizer's edge over the fixed rule).

Accuracy knobs, and what each one actually controls (all measured, 1 opponent / double
board). The library build and the per-hand solve both fan out over a worker pool, so
these are affordable:

- `samples` (UI "Samples") - run-to-run jitter in the displayed EV only, scaling as
  1/sqrt(n). Measured SD of the top split's EV: 0.16 at 1k, 0.10 at 5k, about 0.04 at 20k
  (the default). Each solve also reports a per-split standard error, computed from pooled
  sums of squares, and the UI prints it as "±". The RANKING is far steadier than the
  number: across 10 repeat solves the #1 split never changed.
- `ENTRIES` in `useSelfPlayLibrary.ts` (1500) - the pool of distinct opponent hands.
  Opponents are drawn from it, so it sets how finely the opponent hand distribution is
  approximated. This is an accuracy CEILING, not jitter: a fixed library offsets every
  solve the same way, so more samples cannot lift it.
- `LEVELS` (3) - policy-iteration rounds, the knob that makes opponents genuinely
  stronger rather than merely measured more precisely. Judge it by the per-round gain the
  UI now tabulates: 1.26 -> 0.42 -> 0.22 pts/deal. Stop when the next round's gain is
  below the precision you care about. It will never hit exactly 0, because argmax over
  noisy estimates always looks better than the truth.
- `INNER_SAMPLES` (300) - scenarios per hand inside a build round. Only has to be good
  enough to pick each hand's best split; it also sets the noise floor under the per-round
  gain above.

Build cost is ENTRIES * LEVELS * INNER_SAMPLES scenarios (1.35M at these settings, about
80s over 6 workers, cached per settings for the session). A solve at 20k samples is ~1.2s.
Changing opponent count, board count, or royalties is a different cache key and rebuilds.

Best-response iteration can cycle in principle (rock-paper-scissors dynamics); it looks
stable here, but that is an observation, not a proof. If it ever oscillates, average the
policies across rounds (fictitious play) instead of replacing them.

### What the #1 EV number actually is (measured 2026-08-30)

`npm run audit:taiwanese` drives `solveHand` from Node over worker threads, against the
same shipped policy the page fetches, and answers this in three modes.
Reproduce any line below with the flags shown; all of them are house rules, double board,
1 opponent, best-split opponents.

The advisor's headline number is NOT "the EV of playing this game".
Hero does not play the policy; hero plays the best response to it, so the number is the
**exploitability** the shipped policy still leaves on the table, plus any bias from taking
a maximum over 105 noisy estimates.
Both terms were measured:

| Quantity | Measured | How |
|---|---|---|
| Hero playing the SAME policy as the opponent | **-0.026 +/- 0.054** | `--mode mirror --hands 4000 --samples 3000 --seed 777` |
| Argmax (winner's-curse) bias at 20k samples | **0.0015 +/- 0.0054** | `--mode bias --hands 400` |
| Overfitting the sampled opponent pool | **-0.001 +/- 0.007** | `--mode holdout --hands 600 --seed 4242` |
| Mean #1 EV over random hands | **+0.19 +/- 0.10** | `--mode avg --hands 1000` |

The mirror row is the load-bearing one: house scoring is pairwise and antisymmetric, so
two seats running an identical strategy must each average exactly 0.
It does, so scoring, the harness, and the policy's own symmetry are all sound - treat a
mirror run that excludes 0 as a bug in scoring, not as a finding about the game.
Be careful about sample size when reading it: at 600 hands the same check came back
+0.17 +/- 0.14 (2.3 sigma), which was pure noise.
Hand-to-hand SD is ~1.73 pts, so a mean is only worth quoting past ~2000 hands.

The bias row retires a worry rather than confirming one.
A max over 105 estimates is biased upward in general, but at 20k samples it is
indistinguishable from zero here, because the splits are all scored on the SAME scenarios
(so the noise in their differences is far smaller than the +/-0.04 standard error on any
one split's absolute EV) and the top split is genuinely separated - the same split wins on
two independent passes 93.5% of the time.

Do not confuse that with the ~0.1 floor under `prevPolicyEvLoss` in the precompute notes
above: that floor is a different quantity, measured on fresh hands at 3000 INNER samples
per hand during a build round, and it does not transfer to a 20k-sample solve.

The holdout row rules out the other way the number could have been an artifact.
Hero best-responds to a FINITE sample of opponent hands, so some of the gain could have
been hero exploiting that particular sample rather than the policy - choose against half
the pool, score against the other half, and the gap is that overfitting.
It is zero even at a 5000-hand half-pool, and the same split wins against both halves
93.8% of the time, so the shipped 10,000 entries are already past the point where pool
size limits anything.
**Do not spend an overnight raising `ENTRIES` to chase this number** - it will not move.

So the whole +0.19 is real exploitability: a player who used the tool against opponents
drawn from this policy would win about a fifth of a point per deal.
Paired on identical hands, best-responding beat playing the policy by 0.21 pts/deal.
That number is the honest convergence metric for the shipped library - it is what another
round of policy iteration would have to reduce - and it is the one to re-measure after any
change to `LEVELS`, `ENTRIES`, or `INNER_SAMPLES`.
Note the spread dwarfs it either way: SD across hands is ~1.7, about 9x the mean, so the
hand you are dealt decides far more than the edge does.

#### Lowering it

Measured, the number is not noise, not a scoring artifact, and not pool overfitting, which
leaves exactly two knobs and one structural change:

- **`INNER_SAMPLES` is the first place to spend.**
Every library hand's stored split is itself an argmax over 105 candidates from 3000
scenarios, and argmax stability was measured at 55% @150, 67.5% @300, 77.5% @1200 - so a
large minority of entries store a split that is not that hand's best, and each one is a
systematic leak a best-responder collects.
The cheaper version of the same lever is to spend samples ADAPTIVELY (successive
elimination over the top-K, extra scenarios only while the top two are inside the noise)
rather than giving every hand the same budget regardless of how close its race is.
- **`LEVELS`: cut them, do not add them** (measured, see below).
- **If it plateaus, the fix is structural.**
Iterated best response can cycle; this game (house rules, one opponent) is symmetric
zero-sum, where fictitious play converges - respond to the AVERAGE of all previous
policies, not the last one, and store a mixed policy per hand.
If the equilibrium genuinely needs mixing, a pure lookup table's exploitability cannot
reach zero no matter how long it iterates.

#### Rounds past 3 make the policy worse (measured 2026-08-30)

`precompute-taiwanese.mjs --custom --dump-rounds` snapshots the library after every round,
so a whole levels curve comes from ONE hand pool and only the round count differs.
`taiwanese-ev-audit.mjs --dump` writes per-hand EVs, and two runs sharing a `--seed` see
identical hands and scenario seeds, so arms difference PAIRWISE - which cancels the ~1.7
hand-to-hand SD that otherwise swamps every comparison.

Exploitability by round, 2000 entries, 750 inner samples, one pool:

| Round | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Exploitability | 0.491 | **0.268** | 0.273 | 0.312 | 0.369 | 0.373 |

Paired differences (positive = more exploitable = worse):

| Comparison | Paired difference |
|---|---|
| round 3 vs round 2 | +0.006 +/- 0.026 (nothing) |
| round 4 vs round 3 | +0.038 +/- 0.031 |
| round 6 vs round 3 | +0.100 +/- 0.032 |
| round 6 vs round 2 | +0.105 +/- 0.014 |
| 6 rounds vs 3, separate builds | +0.134 +/- 0.035 |
| 8x inner samples (6000 vs 750), 3 rounds | **-0.047 +/- 0.013** |

Iteration is done by round 2 here, and every round after 3 makes the policy measurably
MORE exploitable.
The mechanism is the one the argmax-stability numbers imply: each round rebuilds the
opponent field out of the previous round's stored argmaxes, so when only ~50% of those are
that hand's true best, later rounds best-respond to a field that is wrong in a structured
way and lock the error in rather than averaging it out.
Iterating harder cannot fix per-hand noise; it compounds it.

Raising `INNER_SAMPLES` is the lever that does work, but it is expensive at this exchange
rate: 8x the scenarios bought an 18% reduction, with argmax stability going 50% -> 57%.
That is the argument for spending the samples ADAPTIVELY (successive elimination over the
top-K, more scenarios only while the leaders are inside the noise) instead of giving a
blowout race and a coin-flip race the same 3000.

**Unverified at the shipped sizes**, and worth checking before the next overnight: the
curve above is at 750 inner samples, while the shipped libraries used 3000, where argmax
noise is lower and the turn may come later.
But the shipped house-2b build shows the same rising signature at rounds 4-5, so it may
already be past its own optimum - rebuild it with `--dump-rounds` and measure per round.
If it is, the fix costs nothing: dropping 5 rounds to 3 frees 40% of the build, and
putting that into samples (3000 -> 5000 at 3 rounds) is the same overnight budget for a
policy that is better on both axes.

Two caveats before chasing it. Exactly 0 is unreachable with a finite sampled pool and a
table-lookup policy; the honest target is "small next to what matters", and +0.19 is ~11%
of the hand-to-hand SD. And a zero-exploitability field is not obviously the product: the
client's game is full of humans, which is what the mixed play style is for. Read this
number as a trust metric for the strategic advice, not as a defect.

### Opponent play styles (the "Opponent play" toggle)

Library entries store the TOP_K (10) best splits per hand with their EV gaps, not just
the winner. "Best split" (pure) always plays alts[0]. "Human mix" samples among them
weighted exp(-gap / MIX_TEMPERATURE) - a quantal-response model of real players, who land
somewhere among the near-best options rather than on the exact argmax. Near-ties barely
weaken the field, so rankings hardly move, but EVs read slightly higher vs mixed (softer)
opponents - measured +0.41 vs +0.15 on the same hand. Build rounds always use mixed play
(smoothed best-response iteration converges more stably than pure argmax chasing).
The advisor tab defaults to **pure** ("Best split"): the client's question is what to set
against opponents who set correctly.
`AdvancedTab` still defaults to mixed, where the point is a realistic full table.
Constants live in `lib/taiwaneseSolver.ts`.

### Precomputed libraries

`npm run precompute:taiwanese` (in frontend/) builds the libraries overnight and writes
compact JSONs to `public/taiwanese-libs/`; `--quick` is a 2-minute smoke test whose
output should NOT be committed (weak libraries silently cap accuracy - delete them or
run the full job before deploying). `useSelfPlayLibrary.ensure` fetches these before
falling back to an in-browser build, so shipping the files makes self-play instant for
users. The script bundles the same solver core the browser worker uses (esbuild +
worker_threads); there is exactly one implementation.

What gets built: house libraries per board count only, because pairwise scoring makes EV
exactly linear in opponent count (same argmax for any table size - this is why the house
cache key ignores N). PokerNews libraries are built at 3 opponents and reused for other
counts (approximation; winner-take-all genuinely depends on N). Whenever a library is
reused at a different table size the results panel says so, and says which of the two
cases it is; keep that disclosure honest if the sizing changes.
Full-run sizing favors INNER samples first (measured argmax stability on an unchanged
field: 55% @150, 67.5% @300, 77.5% @1200), then pool size, then rounds.

The libraries in `public/taiwanese-libs/` are the run of 2026-08-25: 348M scenarios,
3h20m wall clock on 15 threads. House 10,000 hands x 3,000 samples x 5 rounds (1.1MB
each, 360KB gzipped); PokerNews 4,000 x 1,500 x 4 (0.44MB, 150KB gzipped). Per-round
gains, house double board: 1.19, 0.30, 0.10, 0.11, 0.15 pts/deal. The rise after round 3
was originally read as harmless upward bias in the metric (it is an argmax over noisy
per-hand estimates, with a floor around 0.1 that does not shrink with more hands).
**That reading is now known to be wrong, or at least incomplete** - see "Rounds past 3
make the policy worse" below, where an external measurement shows the same rise tracking
real degradation at 750 inner samples. Treat a rising gain as a stop signal, not as
confirmation, and verify at the shipped sample size before trusting rounds 4-5. PokerNews (fewer hands, fewer samples, and a genuinely N-dependent
game) floors higher: 2.80, 0.79, 0.45, 0.41.

It is emphatically NOT a solve of all 133.8M seven-card hands, nor of the ~6.0M
suit-isomorphic classes: the library is a Monte Carlo SAMPLE that represents the opponent
field in expectation, so its size is a precision knob, not a coverage requirement.

The same principle covers the rest of the page.
`RankingsTab.tsx` prints opponent counts, draw counts and made-hand frequencies that come
back from the worker rather than being written down, and the Badugi draw modelling caveats
are stated where the results are shown.
Keep it that way.

## Other things that are easy to get wrong

- Badugi is ace-low; `src/lib/cards.ts` `RANK_IDX` is ace-high. Use `ACE_LOW_RANK` from
  `src/lib/badugi.ts`.
- The Badugi draw tables key on a keep's **rank set**, which is sound only because a keep
  has all-distinct suits and a suit permutation maps the deck onto itself. Do not extend
  that caching to anything where suits matter.
- Per repo convention, no unconditional infinite animations, and every worker gets
  terminated on unmount.
