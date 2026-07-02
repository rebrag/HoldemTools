# Course — "Think Like a Professional"

An entry-level, interactive poker course.
Sections teach both the rules of poker and the math behind winning play.

Current sections (the count is intentionally small and grows over time):

1. **The Rules of Poker** - variant-agnostic fundamentals only (deck, hand rankings, betting, showdown). Deliberately contains **no** variant-specific mechanics.
2. **Texas Hold'em** - the most popular variant in depth: hole + community cards, the betting rounds, blinds, and tricky showdown reading.
3. **Other Poker Variants** - a tour of the rest (Omaha, Stud, Draw, Short Deck, Razz, Hi-Lo, mixed games) and how new variants get invented.

Keep the layering clean: fundamentals shared by all poker live in Section 1; anything specific to one variant belongs in that variant's section.

## Core values

The course exists to make learning poker feel like **playing a game**, not reading a textbook.
Hold that bar for every section.

- **Feel like a game.**
Reward interaction, use animation and progressive reveals, and celebrate correct answers.
Prefer letting the reader *do* something over telling them a fact.
Avoid walls of text - break prose into short blocks with a colored callout or an interactive between them.
- **Every concept gets an interactive or animated example.**
Do not state a rule without giving the reader a way to see it in action or try it themselves.
When something can be simulated (a deal, a coin flip, an equity calculation), simulate it.
- **Meet a near-beginner where they are.**
Short sentences, concrete examples, plain English before jargon.
Assume the reader may be seeing a term for the first time - define it, then use it.
- **Mobile-first.**
Most users are on phones. Keep interactives usable at ~360px wide, avoid horizontal overflow,
limit dead space, and make regions either clickable in a useful way or genuinely informative.

## How the course is wired

A section is a single component in `sections/SectionN.tsx`. To add or rename one, keep **three** places in sync:

1. `sections/SectionN.tsx` - the content component.
2. `CourseSection.tsx` - imported and mapped in `getSectionContent(id)`, and titled in the `SECTIONS` array.
3. `Course.tsx` - titled + described in the `sections` array (the outline the user browses).

Other facts worth knowing:

- **Completion is quiz-driven.**
`CourseSection.tsx` wraps each section in `QuizTracker` (see `components/QuizTrackerContext.tsx`).
When every `QuizQuestion` in the section has been answered correctly, the section is marked complete.
So **every section should end with a small quiz** (2-3 `QuizQuestion`s) or it can never be completed.
- **Tier gating** lives in `CourseSection.tsx`: free users see an upsell instead of the content.
Don't put logic that must run for free users inside a section component.
- **Progress** is persisted per user via `useCourseProgress` (keyed on `user.uid`).

## Reusable building blocks

Reach for these before writing new UI:

- `@/components/CardRow` and `@/components/PlayingCard` - render cards.
Codes are `"As"`, `"Td"`, `"7c"` (rank + lowercase suit).
Note: `CardRow` **re-sorts cards descending** (`sortCardsDesc`), so use `PlayingCard` directly
when card order must be preserved (e.g. showing the low "wheel" straight `5 4 3 2 A`).
- `./components/QuizQuestion` (+ the `QuizTracker` context) - multiple-choice checks with
per-option explanations that also drive section completion.
- `@/lib/handEval.ts` - a **real** hand evaluator. `evalWinners(game, board5, hands)` returns the
winning index/indices for board games like Hold'em/Omaha (handles chops); `evalWinners5(hands)`
does the same for complete 5-card hands with no board (variant-agnostic showdowns); `handScore`
and `rank5` score a single hand. Use these to power any "which hand wins?" interactive so results
are always correct - never hand-roll an evaluator in a section.
- `@/lib/cards.ts` - `tokenize`, `buildDeck`, `sampleN`, rank/suit tables.
- `recharts` - already a dependency; use it for charts (e.g. EV-convergence line charts). See git
history for earlier coin-flip / QQ-vs-AK EV simulators that used it.

## Styling idiom

Match what the existing sections already do:

- Emerald is the primary accent (`emerald-600` buttons, `emerald-50/emerald-200` callouts).
- Prose in `text-sm text-gray-700 leading-relaxed`.
- Callout cards: `bg-<color>-50 border border-<color>-200 rounded-xl p-4`.
- Section sub-blocks separated by `border-t border-gray-200 pt-5`, each led by an
uppercase-tracked eyebrow label (`text-xs font-semibold uppercase tracking-widest text-emerald-600`).
- Animate with Tailwind transitions (`transition-all`, `duration-300`, `scale`, opacity) and
`active:scale-95` on buttons - no extra animation dependency needed.
- Local interactive components can live inside the section file (see `Section4`'s `FourTwoCalc` /
`OutsDemo`); promote to `components/` only once a second section needs them.

## Ideas backlog (valuable future additions)

Seeds for growing the course - not yet built:

- **Game-feel systems:** per-section XP, streaks, and badges; a visible progress bar / map of the
sections; confetti or a sound/haptic micro-reward on a correct answer (respect `prefers-reduced-motion`).
- **Reusable animated `Board` / `DealAnimation` component** promoted out of Section 1, so every
section can deal a flop/turn/river with the same polished animation.
- **Interactive 13x13 range/equity grid** wired to the existing solver data, letting readers paint a
range and see equity update live.
- **Practice / drill mode:** deal a random spot and ask for the best action (fold/call/raise), then
show the EV-correct answer - turns passive reading into reps.
- **Spaced repetition:** resurface quiz questions the user got wrong in earlier sections.
- **Glossary tooltips:** hover/tap any poker term (blinds, GTO, equity, out) to see a one-line definition
without leaving the page.
- **"Show your work" toggles:** every computed number (pot odds, equity) can expand to reveal the
arithmetic, reinforcing the mental math.
- **Accessibility as a feature:** honor `prefers-reduced-motion`, keep every interactive keyboard-operable,
and lean on the ARIA labels the card components already expose.
