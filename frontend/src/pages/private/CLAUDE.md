# /private - client tools

Pro-tier page (`useCurrentTier().isPro`) holding two tools built for a paying client.
Routable but deliberately absent from `NavBar`, the same way `/equity` is.
All compute is client side, in workers, with no backend involved.

| File | Role |
|---|---|
| `PrivatePage.tsx` | Tier gate and the tab switcher |
| `RankingsTab.tsx` | Top X% hand rankings: hold'em, Badugi, Badugi with 1-3 draws |
| `TaiwaneseTab.tsx` | Taiwanese hand-setting advisor |
| `ScoringExplainer.tsx` | On-page readout of how Taiwanese scoring is configured |
| `taiwaneseScoring.ts` | Derives that readout from the scoring code |
| `ScoringVerifier.tsx` | Score checker: enter a real deal, see per-player points from the same code |
| `protocol.ts` | Worker message types, shared with `src/workers/` |
| `useRankingsSim.ts`, `useTaiwaneseSolve.ts` | One worker per run, terminated on cancel, re-run and unmount |

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
