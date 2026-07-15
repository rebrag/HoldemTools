import React, { useState } from "react";
import CardRow from "@/components/CardRow";
import QuizQuestion from "../components/QuizQuestion";

/* ────────────────────────────────────────────────────────────────────────
   Variant explorer — an accordion of the major poker variants, ordered from
   most to least popular (after Texas Hold'em, which got its own section).
   ──────────────────────────────────────────────────────────────────────── */
type Variant = {
  name: string;
  tag: string;
  facts: { k: string; v: string }[];
  blurb: string;
};

const VARIANTS: Variant[] = [
  {
    name: "Omaha (Pot-Limit Omaha)",
    tag: "#1 after Hold'em",
    facts: [
      { k: "Your cards", v: "4 private hole cards" },
      { k: "Community", v: "5 shared cards, like Hold'em" },
      { k: "The catch", v: "Use exactly 2 hole cards + exactly 3 board cards" },
      { k: "Feel", v: "Bigger hands, wilder pots" },
    ],
    blurb:
      "Omaha plays like Hold'em with double the hole cards - but you must use exactly two of them, no more, no less. That single rule makes huge hands common and trips up players fresh from Hold'em.",
  },
  {
    name: "Seven-Card Stud",
    tag: "The old king",
    facts: [
      { k: "Your cards", v: "7 cards dealt to you alone, over the hand" },
      { k: "Community", v: "None - no shared board" },
      { k: "Cards shown", v: "Some face-down, some face-up for all to see" },
      { k: "Extras", v: "An 'ante' from everyone + a 'bring-in' bet" },
    ],
    blurb:
      "Before Hold'em took over, Stud was the game. There's no shared board - each player builds from their own seven cards. Because several are dealt face-up, remembering exposed cards is a real skill.",
  },
  {
    name: "Five-Card Draw",
    tag: "The classic",
    facts: [
      { k: "Your cards", v: "5 private cards" },
      { k: "Community", v: "None" },
      { k: "The twist", v: "One 'draw' - swap unwanted cards for new ones" },
      { k: "Betting rounds", v: "Two (before and after the draw)" },
    ],
    blurb:
      "The simplest variant and the one you've seen in movies. Everyone gets five cards, throws away the ones they don't want, and draws replacements. Great for learning, light on information.",
  },
  {
    name: "Short Deck (Six Plus Hold'em)",
    tag: "New-school favorite",
    facts: [
      { k: "Deck", v: "36 cards - all 2s, 3s, 4s, 5s removed" },
      { k: "Structure", v: "Plays like Hold'em" },
      { k: "Ranking change", v: "A flush beats a full house" },
      { k: "Low straight", v: "A-6-7-8-9" },
    ],
    blurb:
      "A stripped-down deck makes big hands more common, so some rankings shift - flushes become rarer than full houses and jump ahead of them. It exploded out of high-stakes cash games in Asia.",
  },
  {
    name: "Razz",
    tag: "Upside-down",
    facts: [
      { k: "Structure", v: "Seven-Card Stud, but lowball" },
      { k: "Goal", v: "Make the LOWEST hand, not the highest" },
      { k: "Best hand", v: "A-2-3-4-5 (the 'wheel')" },
      { k: "Good news", v: "Straights and flushes don't count against you" },
    ],
    blurb:
      "Razz flips poker on its head: the worst-looking hand wins. Pairs are bad, and the nut hand is five different low cards. It's a great introduction to 'lowball' thinking.",
  },
  {
    name: "Hi-Lo Split (Omaha 8 / Stud 8)",
    tag: "Two winners",
    facts: [
      { k: "The pot", v: "Split between the best high and best low hand" },
      { k: "Low qualifier", v: "Need five cards 8-or-lower to make a low" },
      { k: "Scoop", v: "Win both halves and you take the whole pot" },
    ],
    blurb:
      "In hi-lo games the pot is divided: half to the best normal (high) hand, half to the best qualifying low. Winning both halves at once - a 'scoop' - is the goal.",
  },
  {
    name: "Mixed Games (H.O.R.S.E.)",
    tag: "All-arounder",
    facts: [
      { k: "Format", v: "Rotates through several variants" },
      { k: "H.O.R.S.E.", v: "Hold'em, Omaha 8, Razz, Stud, Stud Eight-or-better" },
      { k: "Why", v: "Rewards well-rounded players, not one-game specialists" },
    ],
    blurb:
      "Mixed games rotate the variant every so often. H.O.R.S.E. is the famous one, played for the highest stakes at the World Series. To win, you can't just be great at one game - you have to be good at all of them.",
  },
];

const VariantExplorer: React.FC = () => {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-1.5">
      {VARIANTS.map((variant, i) => {
        const isOpen = open === i;
        return (
          <div
            key={variant.name}
            className={`rounded-xl border transition-all duration-200 overflow-hidden ${
              isOpen
                ? "border-emerald-300 bg-emerald-50/60 shadow-sm"
                : "border-gray-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/30"
            }`}
          >
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
            >
              <span
                className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                  isOpen ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {i + 1}
              </span>
              <span className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-gray-900">{variant.name}</span>
              </span>
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-500 bg-emerald-50 rounded-full px-2 py-0.5">
                {variant.tag}
              </span>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <div
              className={`grid transition-all duration-300 ease-out ${
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <div className="px-3 pb-3 pt-0.5 space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {variant.facts.map((f) => (
                      <div
                        key={f.k}
                        className="rounded-lg bg-white border border-gray-100 px-2.5 py-1.5"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                          {f.k}
                        </p>
                        <p className="text-xs text-gray-700">{f.v}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{variant.blurb}</p>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────
   Omaha "exactly two" gotcha — the most famous beginner trap in poker.
   ──────────────────────────────────────────────────────────────────────── */
const OmahaGotcha: React.FC = () => {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
      <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
        The Omaha trap - do you have a flush?
      </p>
      <div className="flex flex-wrap gap-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Your 4 hole cards</p>
          <CardRow cardsStr="As 2h 4d 6c" size="sm" />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">The board (four spades!)</p>
          <CardRow cardsStr="Ks Qs 8s 3s 7d" size="sm" />
        </div>
      </div>
      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 active:scale-95 transition-all shadow-sm"
        >
          Reveal the answer
        </button>
      ) : (
        <div className="rounded-lg bg-white border border-blue-200 px-3 py-2.5 space-y-1.5 text-sm">
          <p className="text-blue-900">
            <strong>In Hold'em:</strong> yes! Your A♠ plus the four board spades is the nut flush.
          </p>
          <p className="text-blue-900">
            <strong>In Omaha:</strong> no flush at all. You must use <strong>exactly two</strong> of
            your own cards, and you only hold <em>one</em> spade (the A♠). One spade can't make a
            five-card flush, so your hand here is just a pair of aces.
          </p>
          <p className="text-xs text-blue-600 pt-0.5">
            This exact spot has cost beginners countless pots. In Omaha, always count how many of{" "}
            <em>your</em> cards actually play.
          </p>
        </div>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════ */
const Section3: React.FC = () => (
  <div className="space-y-6">
    {/* ── Intro ── */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Beyond Hold'em</h3>
      <p>
        Texas Hold'em is the most popular poker variant on Earth, but it's just one member of a big
        family. The good news: everything you learned in Section 1 - the deck, the hand rankings,
        betting rounds, the showdown - carries straight over. Each variant just changes{" "}
        <strong>how many cards you get</strong>, <strong>how they're dealt</strong>, and{" "}
        <strong>how you build your five</strong>.
      </p>
      <p>
        Here are the other major variants, roughly from most to least popular. Tap any one to see
        how it works.
      </p>
    </div>

    {/* ── Variant explorer ── */}
    <VariantExplorer />

    {/* ── Omaha gotcha ── */}
    <div className="border-t border-gray-200 pt-5 space-y-3">
      <h3 className="font-bold text-gray-900 text-base">A famous trap: Omaha's "exactly two"</h3>
      <p className="text-sm text-gray-700 leading-relaxed">
        Omaha's must-use-exactly-two rule catches almost everyone at first. See if you can avoid the
        trap:
      </p>
      <OmahaGotcha />
    </div>

    {/* ── New variants ── */}
    <div className="border-t border-gray-200 pt-5 space-y-3 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Poker keeps inventing itself</h3>
      <p>
        Here's the big idea to leave this section with: poker isn't really <em>one</em> game, it's a{" "}
        <strong>framework</strong>. Once you have three ingredients - a set of hand rankings, a way
        to bet in rounds, and a rule for building a hand - you can invent a brand-new variant just
        by turning the dials:
      </p>
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
          The dials you can turn
        </p>
        <ul className="list-disc list-inside space-y-1.5 text-sm text-emerald-900">
          <li><strong>How many cards</strong> each player gets (2 in Hold'em, 4 in Omaha, 7 in Stud…).</li>
          <li><strong>How they're dealt</strong> - private, face-up, shared in the middle, or drawn and swapped.</li>
          <li><strong>How many you must use</strong> to make your five.</li>
          <li><strong>Whether high or low wins</strong> - or both, split down the middle.</li>
          <li><strong>The deck itself</strong> - a full 52, a short 36, or something else entirely.</li>
        </ul>
      </div>
      <p>
        This is exactly how new games appear. Short Deck started as a private high-stakes
        experiment and became a World Series event. Home games invent house rules every weekend.
        Poker sites roll out fresh formats to keep things exciting. The framework stays the same -
        only the dials change.
      </p>
      <p className="text-gray-600">
        So once you're comfortable with the fundamentals, you're not limited to the games in this
        list. You could even design your own.
      </p>
    </div>

    {/* ── Quiz ── */}
    <div className="border-t border-gray-200 pt-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-5">
        Check Your Understanding
      </p>
      <div className="space-y-7">
        <QuizQuestion
          question="In Omaha, how many of your four hole cards must you use to make your hand?"
          options={[
            {
              label: "Exactly two - no more, no less",
              explanation:
                "Correct! Omaha forces you to use exactly two hole cards plus exactly three board cards. This is the rule that catches Hold'em players.",
            },
            {
              label: "Any number from zero to four",
              explanation:
                "That's the Hold'em rule. In Omaha you must use exactly two of your four hole cards.",
            },
            {
              label: "All four",
              explanation:
                "No - a hand is only five cards. In Omaha you use exactly two of your four hole cards, plus three from the board.",
            },
            {
              label: "At least two, but you can use more",
              explanation:
                "It's exactly two, not 'at least two.' You always combine two hole cards with three board cards.",
            },
          ]}
          correctIndex={0}
        />

        <QuizQuestion
          question="In a lowball game like Razz, which hand is the best possible?"
          options={[
            {
              label: "A-2-3-4-5, the 'wheel'",
              explanation:
                "Correct! In lowball the lowest hand wins, and A-2-3-4-5 is the lowest five different ranks you can have. Straights and flushes don't count against you in Razz.",
            },
            {
              label: "A royal flush",
              explanation:
                "That's the best HIGH hand. In a lowball game the goal is reversed - you want the lowest hand, and A-2-3-4-5 is the champion.",
            },
            {
              label: "A pair of aces",
              explanation:
                "Pairs are bad in lowball - you want unpaired low cards. The best hand is A-2-3-4-5.",
            },
            {
              label: "2-3-4-5-6",
              explanation:
                "Close, but the ace counts as low, so A-2-3-4-5 is even lower and beats 2-3-4-5-6.",
            },
          ]}
          correctIndex={0}
        />

        <QuizQuestion
          question="What makes it possible for people to keep inventing new poker variants?"
          options={[
            {
              label: "Poker is a framework - change the cards, dealing, or win condition and you have a new game",
              explanation:
                "Correct! As long as you keep hand rankings and round-based betting, you can turn dials like card count, how cards are dealt, and whether high or low wins to create endless variants.",
            },
            {
              label: "A governing body designs and approves every new variant",
              explanation:
                "There's no central authority inventing games. Anyone can create a variant by changing the rules within poker's basic framework.",
            },
            {
              label: "Only casinos are allowed to make new variants",
              explanation:
                "Not true - home games invent house rules constantly. New variants come from players and casinos alike, built on the same framework.",
            },
            {
              label: "New variants require a completely different deck each time",
              explanation:
                "Most variants use the same 52-card deck (or a trimmed version). The deck is just one of many dials you can turn - not a requirement to change.",
            },
          ]}
          correctIndex={0}
        />
      </div>
    </div>
  </div>
);

export default Section3;
