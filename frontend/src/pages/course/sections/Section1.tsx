import React, { useState } from "react";
import CardRow from "@/components/CardRow";
import PlayingCard from "@/components/PlayingCard";
import { evalWinners5 } from "@/lib/handEval";
import { tokenize } from "@/lib/cards";
import QuizQuestion from "../components/QuizQuestion";

/* ────────────────────────────────────────────────────────────────────────
   Hand-ranking ladder — click a rank to expand a real example.
   These "standard high" rankings are shared by nearly every poker variant.
   ──────────────────────────────────────────────────────────────────────── */
type Rank = { name: string; nick?: string; example: string; blurb: string };

const RANKINGS: Rank[] = [
  { name: "Royal Flush", example: "As Ks Qs Js Ts", blurb: "The best hand there is: A-K-Q-J-10, all the same suit. Almost never happens." },
  { name: "Straight Flush", example: "9h 8h 7h 6h 5h", blurb: "Five cards in a row, all the same suit." },
  { name: "Four of a Kind", nick: "Quads", example: "Kc Kd Kh Ks 3c", blurb: "All four cards of one rank." },
  { name: "Full House", nick: "Boat", example: "Qc Qd Qh 8s 8c", blurb: "Three of one rank plus a pair. This one is 'queens full of eights'." },
  { name: "Flush", example: "Ah Jh 8h 5h 2h", blurb: "Five cards of the same suit, in any order." },
  { name: "Straight", example: "Ts 9d 8c 7h 6s", blurb: "Five cards in a row of mixed suits." },
  { name: "Three of a Kind", nick: "Trips / Set", example: "7c 7d 7h Ks 2c", blurb: "Three cards of the same rank." },
  { name: "Two Pair", example: "As Ad 9c 9h 4s", blurb: "Two different pairs at once." },
  { name: "One Pair", example: "Jc Jd As 8h 3c", blurb: "Just two cards that match in rank." },
  { name: "High Card", example: "Ah Kd 9c 6s 2h", blurb: "Nothing matches. Your single highest card decides it." },
];

const HandRankLadder: React.FC = () => {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-1.5">
      {RANKINGS.map((r, i) => {
        const isOpen = open === i;
        return (
          <div
            key={r.name}
            className={`rounded-xl border transition-all duration-200 overflow-hidden ${
              isOpen
                ? "border-emerald-300 bg-emerald-50/60 shadow-sm scale-[1.01]"
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
                <span className="text-sm font-semibold text-gray-900">{r.name}</span>
                {r.nick && (
                  <span className="ml-2 text-xs text-gray-400">"{r.nick}"</span>
                )}
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
                <div className="px-3 pb-3 pt-0.5 space-y-2">
                  <CardRow cardsStr={r.example} size="sm" />
                  <p className="text-xs text-gray-600 leading-relaxed">{r.blurb}</p>
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-gray-400 pt-1 text-center">
        Higher on the list beats everything below it.
      </p>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────
   Five-card showdown — two finished 5-card hands, which wins? Variant-neutral:
   it's purely about the shared hand rankings. The real evaluator decides.
   ──────────────────────────────────────────────────────────────────────── */
type FiveSpot = {
  hands: { cards: string; label: string }[];
  lesson: string;
};

const FIVE_SPOTS: FiveSpot[] = [
  {
    hands: [
      { cards: "Ah Qh 8h 5h 2h", label: "Flush" },
      { cards: "9c 8d 7h 6s 5c", label: "Straight" },
    ],
    lesson: "A flush beats a straight - five of one suit is rarer than five in a row.",
  },
  {
    hands: [
      { cards: "Kh Kd Ks 4c 4h", label: "Full house" },
      { cards: "As Js 8s 5s 2s", label: "Flush" },
    ],
    lesson: "A full house beats a flush, even an ace-high one. Trips-plus-a-pair is the rarer shape.",
  },
  {
    hands: [
      { cards: "7c 7d 7h Ks 2c", label: "Three of a kind" },
      { cards: "As Ad 9c 9h 4s", label: "Two pair" },
    ],
    lesson: "Three of a kind beats two pair - don't let the two aces fool you.",
  },
  {
    hands: [
      { cards: "As Ah Kd Kc Qs", label: "Two pair (A & K), Q kicker" },
      { cards: "Ac Ad Kh Ks 9c", label: "Two pair (A & K), 9 kicker" },
    ],
    lesson: "Same two pair! The fifth card - the 'kicker' - breaks the tie. Queen beats nine.",
  },
];

const FiveCardShowdown: React.FC = () => {
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const spot = FIVE_SPOTS[idx];
  const winners = revealed ? evalWinners5(spot.hands.map((h) => tokenize(h.cards))) : [];

  const next = () => {
    setRevealed(false);
    setIdx((i) => (i + 1) % FIVE_SPOTS.length);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {spot.hands.map((h, i) => {
          const isWinner = winners.includes(i);
          return (
            <div
              key={i}
              className={`rounded-xl border p-3 text-center space-y-2 transition-all duration-300 ${
                !revealed
                  ? "border-gray-200 bg-gray-50"
                  : isWinner
                  ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-300 scale-[1.02]"
                  : "border-gray-200 bg-gray-50 opacity-60"
              }`}
            >
              <p className="text-xs font-semibold text-gray-500">Hand {i + 1}</p>
              <div className="flex justify-center">
                <CardRow cardsStr={h.cards} size="sm" />
              </div>
              {revealed && (
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-gray-700">{h.label}</p>
                  {isWinner && <p className="text-xs font-bold text-emerald-600">Wins!</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {revealed ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5">
            <p className="text-xs text-emerald-800 leading-relaxed">{spot.lesson}</p>
          </div>
          <button
            onClick={next}
            className="w-full px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-100 transition-colors"
          >
            Next matchup →
          </button>
        </div>
      ) : (
        <button
          onClick={() => setRevealed(true)}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 active:scale-95 transition-all shadow-sm"
        >
          Which hand wins?
        </button>
      )}
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────
   Small helper: a single betting-action definition row.
   ──────────────────────────────────────────────────────────────────────── */
const ActionRow: React.FC<{ term: string; def: string; example: string }> = ({
  term,
  def,
  example,
}) => (
  <div className="flex gap-3 px-3 py-2.5 border-b border-gray-100 last:border-0">
    <span className="shrink-0 w-16 text-sm font-bold text-emerald-700">{term}</span>
    <span className="flex-1 min-w-0">
      <span className="text-sm text-gray-700">{def}</span>
      <span className="block text-xs text-gray-400 mt-0.5 italic">{example}</span>
    </span>
  </div>
);

/* ════════════════════════════════════════════════════════════════════════ */
const Section1: React.FC = () => (
  <div className="space-y-6">
    {/* ── What is poker? ── */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">What is poker, really?</h3>
      <p>
        Poker is a family of card games where players bet chips (which stand in for money) on who
        has the best hand. Here's the twist that makes it fun: you can't see anyone else's cards,
        and they can't see yours. Every decision is a bit of a guess.
      </p>
      <p>
        There are many <em>variants</em> of poker, and they can look pretty different. But almost
        all of them share the same skeleton, and that's what this first section is about - the parts
        that never change. There are two ways to win the chips in the middle of the table, called
        the <strong>pot</strong>:
      </p>
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
          The Two Ways to Win a Hand
        </p>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-emerald-900">
          <li>
            <strong>Have the best hand</strong> when everyone shows their cards at the end.
          </li>
          <li>
            <strong>Be the last player standing</strong> because everyone else gave up (folded).
          </li>
        </ol>
      </div>
      <p>
        That second way is important: you don't always need the best cards. If you can convince
        everyone else to quit, it doesn't matter what you were holding. Think of it like a
        schoolyard bet - "I bet you a dollar my hand is better." If the other kid backs down, you
        win the dollar without ever flipping your cards over.
      </p>
    </div>

    {/* ── The deck ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">The deck: 52 cards</h3>
      <p>
        Most poker games use one standard deck. That's <strong>52 cards</strong>, split into{" "}
        <strong>4 suits</strong> with <strong>13 cards</strong> each:
      </p>
      <div className="flex justify-center gap-2 py-1">
        {["As", "Kh", "Qd", "Jc"].map((c) => (
          <PlayingCard key={c} code={c} size="sm" />
        ))}
      </div>
      <p className="text-xs text-gray-500 text-center -mt-1">
        Spades ♠, Hearts ♥, Diamonds ♦, and Clubs ♣ - all four suits are worth exactly the same.
      </p>
      <p>
        Within each suit, the cards run from the lowest, a <strong>2</strong>, up through 10, then
        the picture cards - Jack, Queen, King - and finally the highest card, the{" "}
        <strong>Ace</strong>. So the order from weakest to strongest is:
      </p>
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-center font-mono text-sm text-gray-700">
        2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 · J · Q · K · A
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">One quirk</p>
        <p className="text-sm text-amber-900">
          The Ace is usually the <em>highest</em> card, but it can also act as the lowest to make
          the smallest straight, called the "wheel": A-2-3-4-5.
        </p>
        <div className="flex gap-1.5 pt-1">
          {["5c", "4d", "3h", "2s", "Ac"].map((c) => (
            <PlayingCard key={c} code={c} size="sm" />
          ))}
        </div>
      </div>
    </div>

    {/* ── Hand rankings ── */}
    <div className="border-t border-gray-200 pt-5 space-y-3">
      <h3 className="font-bold text-gray-900 text-base">Which hands beat which?</h3>
      <p className="text-sm text-gray-700 leading-relaxed">
        A poker hand is always <strong>exactly 5 cards</strong>, and every hand fits into one of 10
        categories. The rarer a hand is, the more it's worth. This ranking is the same in almost
        every version of poker, so learning it once pays off forever. Tap any rank below to see a
        real example - they run from strongest at the top to weakest at the bottom.
      </p>
      <HandRankLadder />
      <p className="text-xs text-gray-500 leading-relaxed">
        (A few "lowball" variants flip this upside-down, where the <em>lowest</em> hand wins - more
        on those later. Unless a game says otherwise, assume these standard rankings.)
      </p>
    </div>

    {/* ── Five-card showdown ── */}
    <div className="border-t border-gray-200 pt-5 space-y-3">
      <h3 className="font-bold text-gray-900 text-base">Put it to the test</h3>
      <p className="text-sm text-gray-700 leading-relaxed">
        Here are two finished 5-card hands. Using the rankings above, decide which one wins before
        you reveal the answer - the computer works out the real result.
      </p>
      <FiveCardShowdown />
    </div>

    {/* ── Betting ── */}
    <div className="border-t border-gray-200 pt-5 space-y-3">
      <h3 className="font-bold text-gray-900 text-base">Betting: how the pot grows</h3>
      <p className="text-sm text-gray-700 leading-relaxed">
        Poker is played in <strong>betting rounds</strong>. Between rounds, more information comes
        out (new cards are dealt or revealed), and players get another chance to put chips in or
        get out. When the action reaches you, you always pick from a small set of options - which
        ones are available depends on whether anyone has bet yet.
      </p>
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <ActionRow
          term="Fold"
          def="Give up your hand and throw your cards away. You can't win the pot, but you don't lose any more chips."
          example="You have 7♦ 2♣ and someone bets big - just fold."
        />
        <ActionRow
          term="Check"
          def="Pass the action along without betting. Only allowed if nobody has bet yet this round."
          example="Nobody has bet, and you'd like to see the next card for free."
        />
        <ActionRow
          term="Call"
          def="Match the amount someone else bet so you can stay in the hand."
          example="A player bets $5, you put in $5 to keep playing."
        />
        <ActionRow
          term="Bet"
          def="Put chips in when no one else has yet, making others pay to continue."
          example="You like your hand, so you bet $5 into the pot."
        />
        <ActionRow
          term="Raise"
          def="Someone already bet - you increase the amount, forcing them to match your bigger number or fold."
          example="They bet $5, you make it $15."
        />
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-1.5">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">The showdown</p>
        <p className="text-sm text-blue-900 leading-relaxed">
          If two or more players make it through the final betting round without folding, everyone
          left reveals their cards. This is the <strong>showdown</strong>, and the best 5-card hand
          wins the pot. If everyone else folds before then, the last player standing wins - no need
          to show anything.
        </p>
      </div>
    </div>

    {/* ── Many variants ── */}
    <div className="border-t border-gray-200 pt-5 space-y-3 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">One game, many flavors</h3>
      <p>
        Everything above is shared by nearly every poker game: the deck, the hand rankings, betting
        rounds, and the showdown. What actually <em>changes</em> from one variant to another is
        usually just three things:
      </p>
      <ul className="space-y-1.5">
        <li className="flex gap-2"><span className="text-emerald-600 font-bold">•</span><span><strong>How many cards you get</strong> and how many you keep.</span></li>
        <li className="flex gap-2"><span className="text-emerald-600 font-bold">•</span><span><strong>How the cards are dealt</strong> - face-down and private, face-up for all to see, or shared in the middle.</span></li>
        <li className="flex gap-2"><span className="text-emerald-600 font-bold">•</span><span><strong>How you build your 5-card hand</strong> from what you're given.</span></li>
      </ul>
      <p>
        In the next section we'll dive deep into the most popular variant in the world -{" "}
        <strong>Texas Hold'em</strong>. After that, we'll tour the rest of the poker world and see
        how new variants get invented.
      </p>
    </div>

    {/* ── Quiz ── */}
    <div className="border-t border-gray-200 pt-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-5">
        Check Your Understanding
      </p>
      <div className="space-y-7">
        <QuizQuestion
          question="What are the two ways to win the pot in a hand of poker?"
          options={[
            {
              label: "Have the best hand at showdown, or make everyone else fold",
              explanation:
                "Correct! You either show down the best 5-card hand, or you're the last player left because everyone else gave up.",
            },
            {
              label: "Have the best hand, or bluff on the river",
              explanation:
                "A bluff is one way to make people fold, but it's not a separate way to win. The two ways are: best hand at showdown, or everyone else folds.",
            },
            {
              label: "Bet the most chips, or have the most chips",
              explanation:
                "Betting a lot doesn't win a pot by itself. You win by having the best hand at showdown, or by getting everyone else to fold.",
            },
            {
              label: "Get four of a kind, or a flush",
              explanation:
                "Those are strong hands, but you don't need any particular hand. You win with the best hand at showdown, or when everyone else folds.",
            },
          ]}
          correctIndex={0}
        />

        <QuizQuestion
          question="You have a flush and your opponent has a straight. Who wins?"
          options={[
            {
              label: "The flush wins",
              explanation:
                "Correct! A flush (5 cards of one suit) is rarer than a straight (5 in a row), so it ranks higher and wins.",
            },
            {
              label: "The straight wins",
              explanation:
                "Not quite. A straight is easier to make than a flush, so it's worth less. The flush beats it.",
            },
            {
              label: "It depends on the suits",
              explanation:
                "No - all four suits are equal in poker. A flush always beats a straight regardless of which suit it is.",
            },
            {
              label: "They split the pot",
              explanation:
                "No - a flush and a straight are different categories with a clear winner. The flush is higher, so it takes the whole pot.",
            },
          ]}
          correctIndex={0}
        />

        <QuizQuestion
          question="A player bets $10. You want to stay in the hand but not put in more than you have to. What action matches $10 exactly?"
          options={[
            {
              label: "Call",
              explanation:
                "Correct! Calling means matching the current bet exactly - here, putting in $10 to keep playing.",
            },
            {
              label: "Raise",
              explanation:
                "A raise means putting in more than $10 to increase the bet. You'd only do that if you wanted to apply pressure.",
            },
            {
              label: "Check",
              explanation:
                "You can't check once someone has bet - checking is only for passing when there's no bet to match.",
            },
            {
              label: "Fold",
              explanation:
                "Folding gives up your hand entirely. You wanted to stay in, so calling the $10 is the right move.",
            },
          ]}
          correctIndex={0}
        />
      </div>
    </div>
  </div>
);

export default Section1;
