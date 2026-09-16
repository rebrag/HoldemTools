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

Splits are committed PRE-BOARD: each split's EV is its average net points over random unseen boards and random opponent hands, so the ranking answers "what should I set before seeing anything", never a hindsight pick.

Two opponent models, chosen by the "Opponent model" toggle (self-play is the default):

- **Heuristic (fast)**: opponents set their hands with `heuristicSplit`, a fixed board-independent rule.
  EVs are best-response-to-that-model numbers and average about +1 per opponent over random hands rather than zero (measured; hero playing the same heuristic averages zero).
- **Self-play**: fictitious play toward the setting equilibrium, in the worker's `solve-batch` op driven by `useSelfPlayLibrary` (in-browser) or `scripts/precompute-taiwanese.mjs` (the shipped files).
  It samples a fixed pool of hands and runs rounds: each round best-responds every hand to the field, and `mergeRound` folds that response into the hand's AVERAGED policy with linear round weights (round k enters with mass k).
  The field in round k is the average of rounds 1..k-1, played as-is; round 1 responds to the heuristic.
  The shipped policy is the final average, and solves draw opponents' hands AND settings from it (rejection sampling keeps hands card-disjoint).
  Setting is a ONE-SHOT simultaneous decision, so the game is a symmetric zero-sum game in which fictitious play converges; a policy that is a best response to itself is the equilibrium.

Do NOT replace the policy with each round's best response.
That was the dynamic until 2026-09-15 and it does not converge in general: it stalled at a measured +0.22 pts/deal of exploitability (house double board) while its per-round gains flattened at 0.10-0.15 and drifted up.
Averaging is the whole difference.

### The convergence metric is exploitability, and the page prints it

Every best-response pass prices, on the SAME scenarios as the best response (common random numbers), each hand's own current policy.
A policy against itself averages exactly zero in expectation (symmetric game), so `mean(bestEv - policyEv)` over the pass is the policy's exploitability: what a random hand's best split averages against it.
Zero is a perfect equilibrium; any positive amount is how hot the advisor's EVs run on average.
The pairing makes it precise (SE ~0.003 over 10k hands) even though each hand's EV is noisy, and `selfMeanEv` (should sit near 0) is the sanity check on the measurement.
Round k's pass therefore measures the policy after k-1 rounds; a final pass that builds nothing measures the shipped policy, so a library's `stats` runs from level 0 (the heuristic) to level = rounds.
`scripts/check-taiwanese-calibration.mjs` (`npm run check:taiwanese`) re-measures any library file the same way, and `--max` turns it into a gate.
Do NOT judge convergence by exact-split agreement (`agreePrevPct`): many splits are near-exact EV ties, so the argmax flips freely among them.
Argmax selection bias in the displayed #1 EV is negligible (0.004 pts at 2k samples, measured by re-pricing the chosen split on fresh scenarios), because all 105 splits share scenarios.

### "Should a random hand be +EV half the time?" No, and the page says why

Under symmetric self-play the MEAN over hands is zero but the MEDIAN hand is a small loser: only ~45% of hands set at their best are +EV (`selfPositivePct`).
Strong 7-card material is rare and wins big; the mass of ordinary hands lose a little to a field that contains it.
The share of random hands whose fresh best split is +EV (`bestPositivePct`) sits above that by however exploitable the policy is: 53% against the pre-fictitious-play library, whose +0.22 exploitability is what made the advisor read hot.
Both shares come from the library file and are printed on the page, never typed.

Accuracy knobs, and what each one actually controls (all measured, 1 opponent / double board).
The library build and the per-hand solve both fan out over a worker pool, so these are affordable:

- `samples` (UI "Samples") - run-to-run jitter in the displayed EV only, scaling as 1/sqrt(n).
  Measured SD of the top split's EV: 0.16 at 1k, 0.10 at 5k, about 0.04 at 20k (the default).
  Each solve also reports a per-split standard error, computed from pooled sums of squares, and the UI prints it as "±".
  The RANKING is far steadier than the number: across 10 repeat solves the #1 split never changed.
- `ENTRIES` in `useSelfPlayLibrary.ts` (1500) - the pool of distinct opponent hands.
  Opponents are drawn from it, so it sets how finely the opponent hand distribution is approximated.
  This is an accuracy CEILING, not jitter: a fixed library offsets every solve the same way, so more samples cannot lift it.
- `LEVELS` (3) - fictitious-play rounds, the knob that makes opponents genuinely stronger rather than merely measured more precisely.
  Judge it by the exploitability column the UI tabulates, and stop when it plateaus.
- `INNER_SAMPLES` (300) - scenarios per hand inside a build round.
  Only has to be good enough to pick each hand's best split.
- `CALIBRATION_HANDS` (300) - the slice the final measuring pass best-responds with; it changes nothing, it only prices the finished policy.

Build cost is ENTRIES * LEVELS * INNER_SAMPLES scenarios plus the measuring pass (1.44M at these settings, about 85s over 6 workers, cached per settings for the session).
A solve at 20k samples is ~1.2s.
Changing opponent count, board count, or royalties is a different cache key and rebuilds.

### Opponent play styles (the "Opponent play" toggle)

Library entries store two things per hand: `policy`, the averaged self-play setting (a few atoms with play probabilities, since fictitious play mixes where a hand's settings tie), and `alts`, the TOP_K (10) best splits of its latest best response with their EV gaps.
"Best split" (`mixing: "pure"`) samples `policy`: opponents set as the equilibrium approximation does.
"Human mix" samples among `alts` weighted exp(-gap / MIX_TEMPERATURE) - a quantal-response model of real players, who land somewhere among the near-best options rather than on the exact argmax.
It is a deliberately softer field: a best split averages more against it (measured +0.39 vs +0.22 against the pre-2026-09-15 library), and rankings hardly move.
Build rounds field the averaged policy itself; softness is a display-time choice only.
The advisor tab defaults to "Best split": the client's question is what to set against opponents who set correctly.
`AdvancedTab` still defaults to mixed, where the point is a realistic full table.
Constants live in `lib/taiwaneseSolver.ts`.

### Precomputed libraries

`npm run precompute:taiwanese` (in frontend/) builds the libraries overnight and writes compact JSONs (`LibraryFile` v2) to `public/taiwanese-libs/`.
`--quick` is a 2-minute smoke test and `--mid` a minutes-long single-library experiment; give either `--out <dir>` so their output never lands in `public/` (weak libraries silently cap accuracy).
`--dynamic replace` rebuilds with the old replacement dynamic for comparison only.
`useSelfPlayLibrary.ensure` fetches the files before falling back to an in-browser build, so shipping them makes self-play instant for users, and it still decodes a v1 file (final best response as a pure policy, final policy unmeasured) so an old file on disk keeps working mid-run.
The script bundles the same solver core the browser worker uses (esbuild + worker_threads, `scripts/taiwanese-lib.mjs`); there is exactly one implementation, and the check script measures with it too.

What gets built: house libraries per board count only, because pairwise scoring makes EV exactly linear in opponent count (same argmax for any table size - this is why the house cache key ignores N).
PokerNews libraries are built at 3 opponents and reused for other counts (approximation; winner-take-all genuinely depends on N).
Whenever a library is reused at a different table size the results panel says so, and says which of the two cases it is; keep that disclosure honest if the sizing changes.
Full-run sizing favors INNER samples first (measured argmax stability on an unchanged field: 55% @150, 67.5% @300, 77.5% @1200), then pool size, then rounds.

The libraries in `public/taiwanese-libs/` are the run of 2026-09-16: 3h45m wall clock on 15 threads.
House 10,000 hands x 2,000 samples x 7 rounds plus a 2,000-hand measuring pass (1.4MB each); PokerNews 4,000 x 1,500 x 5 (0.5MB).
Exploitability of the policy after each round, then the shipped policy (pts/deal, per opponent):

- house-2b: 1.22, 0.38, 0.19, 0.12, 0.09, 0.07, 0.06, shipped 0.053. Self-play +EV 47.8%, random-hand best split +EV 49.1%.
- house-1b: 1.34, 0.32, 0.15, 0.10, 0.08, 0.06, 0.055, shipped 0.050. Self-play +EV 52.6%, best split +EV 54.3% (the single board is less skewed).
- pokernews-2b: 2.80, 0.86, 0.33, 0.20, 0.14, shipped 0.116. Self-play +EV 43.2%, best split +EV 45.1%.
- pokernews-1b: 1.52, 0.48, 0.20, 0.13, 0.11, shipped 0.091. Self-play +EV 44.0%, best split +EV 47.1%.

Every curve falls monotonically, which is what fictitious play is for; the previous build (replacement dynamic, 2026-08-25) shipped house-2b at a measured 0.22 and PokerNews floored at ~0.4.
Rounds are still the lever if more accuracy is wanted: the curves have not flattened, and a round costs ~14 minutes for a house library.

It is emphatically NOT a solve of all 133.8M seven-card hands, nor of the ~6.0M suit-isomorphic classes: the library is a Monte Carlo SAMPLE that represents the opponent field in expectation, so its size is a precision knob, not a coverage requirement.

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
