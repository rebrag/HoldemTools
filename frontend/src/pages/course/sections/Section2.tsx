import React, { useEffect, useState } from "react";
import CardRow from "@/components/CardRow";
import PlayingCard from "@/components/PlayingCard";
import { evalWinners } from "@/lib/handEval";
import { tokenize } from "@/lib/cards";
import QuizQuestion from "../components/QuizQuestion";

/* ────────────────────────────────────────────────────────────────────────
   A card that fades + scales in when it mounts, so each new board card feels
   like it's being turned over.
   ──────────────────────────────────────────────────────────────────────── */
const RevealCard: React.FC<{ code: string; size?: "sm" | "md" | "lg" }> = ({
  code,
  size = "md",
}) => {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      className={`transition-all duration-300 ease-out ${
        shown ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-2 scale-90"
      }`}
    >
      <PlayingCard code={code} size={size} />
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────
   Deal-the-board walkthrough — reveals one street at a time.
   ──────────────────────────────────────────────────────────────────────── */
const HERO = "Ac Kh";
const FULL_BOARD = ["Ah", "7c", "2d", "Kd", "Qs"];
const STREETS = [
  { count: 0, name: "Preflop", caption: "You're dealt A♣ K♥ - a strong starting hand nicknamed \"Big Slick.\" The first betting round happens with just your two hole cards, before any community cards appear." },
  { count: 3, name: "The Flop", caption: "The first three community cards are dealt face-up at once. You now have a pair of aces (your A♣ plus the A♥). A second betting round begins." },
  { count: 4, name: "The Turn", caption: "A single fourth card is added. It pairs your king, so now you hold two pair - aces and kings. Another betting round follows." },
  { count: 5, name: "The River", caption: "The fifth and final community card lands. Your best five cards are A A K K Q: two pair. After the last betting round, it's showdown time." },
];

const DealTheBoard: React.FC = () => {
  const [step, setStep] = useState(0);
  const street = STREETS[step];
  const shownBoard = FULL_BOARD.slice(0, street.count);
  const isLast = step === STREETS.length - 1;

  return (
    <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/30 p-4 space-y-4">
      {/* Your hand */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-gray-500 w-20 shrink-0">Your cards</span>
        <CardRow cardsStr={HERO} size="sm" />
      </div>

      {/* Board */}
      <div className="flex items-start gap-3 flex-wrap">
        <span className="text-xs font-semibold text-gray-500 w-20 shrink-0 mt-2">The board</span>
        <div className="flex items-center gap-1.5 min-h-[3.5rem]">
          {shownBoard.length === 0 ? (
            <span className="text-xs text-gray-400 italic mt-2">No community cards yet…</span>
          ) : (
            shownBoard.map((c) => <RevealCard key={c} code={c} size="sm" />)
          )}
        </div>
      </div>

      {/* Caption */}
      <div className="rounded-lg bg-white border border-emerald-200 px-3 py-2.5">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 mb-1">
          {street.name}
        </p>
        <p className="text-xs text-gray-700 leading-relaxed">{street.caption}</p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {!isLast ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 active:scale-95 transition-all shadow-sm"
          >
            Deal {STREETS[step + 1].name}
          </button>
        ) : (
          <button
            onClick={() => setStep(0)}
            className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-100 transition-colors"
          >
            Deal again
          </button>
        )}
        <div className="flex items-center gap-1 ml-auto">
          {STREETS.map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i <= step ? "bg-emerald-500" : "bg-gray-200"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────
   Who-wins mini-game — the winner is decided by the real hand evaluator.
   Every spot below is a deliberately tricky Hold'em showdown.
   ──────────────────────────────────────────────────────────────────────── */
type Spot = {
  board: string;
  hands: { hole: string; label: string }[];
  lesson: string;
};

const SPOTS: Spot[] = [
  {
    board: "8h 7h 3h Ts 2c",
    hands: [
      { hole: "9c 6d", label: "Straight (ten-high)" },
      { hole: "Ah 2h", label: "Flush (ace-high)" },
    ],
    lesson: "A flush beats a straight. Even a scrappy low flush tops the prettiest straight.",
  },
  {
    board: "As Kd 7c 4h 2s",
    hands: [
      { hole: "Ah Kh", label: "Two pair (aces & kings)" },
      { hole: "Ac Qd", label: "One pair (aces)" },
    ],
    lesson: "Both players paired their ace, but two pair beats one pair - the extra king pair wins it.",
  },
  {
    board: "Ah 9d 6c 3s 2h",
    hands: [
      { hole: "Ac Kd", label: "Pair of aces, king kicker" },
      { hole: "As Qc", label: "Pair of aces, queen kicker" },
    ],
    lesson: "Identical pair of aces, so the kicker decides. A king outranks a queen, so the first player wins by a single card.",
  },
  {
    board: "8h 8d 5c 5s 2h",
    hands: [
      { hole: "Ac Kc", label: "Two pair (board), ace kicker" },
      { hole: "Qd Jd", label: "Two pair (board), queen kicker" },
    ],
    lesson: "The two pair (eights and fives) is sitting on the board - both players share it. The fifth card is the tiebreaker, and the ace beats the queen.",
  },
  {
    board: "9h 8c 7d 2s 3h",
    hands: [
      { hole: "Jd Ts", label: "Straight (jack-high)" },
      { hole: "6c 5d", label: "Straight (nine-high)" },
    ],
    lesson: "Both flopped a straight, so the higher one wins. J-10-9-8-7 beats 9-8-7-6-5.",
  },
  {
    board: "Qh 9h 4h Qs 4d",
    hands: [
      { hole: "Ah 2h", label: "Flush (ace-high)" },
      { hole: "Qc 7c", label: "Full house (queens over fours)" },
    ],
    lesson: "The board is paired (two queens, two fours). That makes a full house possible - and a full house beats even the nut flush.",
  },
  {
    board: "As Ks Qd Jc Th",
    hands: [
      { hole: "2c 2d", label: "Plays the board" },
      { hole: "3h 3s", label: "Plays the board" },
    ],
    lesson: "The A-K-Q-J-10 straight is already on the board, so both players' best hand is identical. The pot is split - a \"chop.\"",
  },
];

const WhoWinsGame: React.FC = () => {
  const [spotIdx, setSpotIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const spot = SPOTS[spotIdx];

  const board5 = tokenize(spot.board);
  const winners = revealed
    ? evalWinners(
        "texas-holdem",
        board5,
        spot.hands.map((h) => tokenize(h.hole))
      )
    : [];
  const isChop = winners.length > 1;

  const next = () => {
    setRevealed(false);
    setSpotIdx((i) => (i + 1) % SPOTS.length);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
      {/* Progress */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-400">
          Showdown {spotIdx + 1} of {SPOTS.length}
        </p>
        <div className="flex items-center gap-1">
          {SPOTS.map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full ${i === spotIdx ? "bg-emerald-500" : "bg-gray-200"}`}
            />
          ))}
        </div>
      </div>

      {/* Board */}
      <div className="text-center space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">The board</p>
        <div className="flex justify-center">
          <CardRow cardsStr={spot.board} size="sm" />
        </div>
      </div>

      {/* Two players */}
      <div className="grid grid-cols-2 gap-3">
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
              <p className="text-xs font-semibold text-gray-500">Player {i + 1}</p>
              <div className="flex justify-center">
                <CardRow cardsStr={h.hole} size="sm" />
              </div>
              {revealed && (
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-gray-700">{h.label}</p>
                  {isWinner && (
                    <p className="text-xs font-bold text-emerald-600">
                      {isChop ? "Splits the pot" : "Wins!"}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Reveal / lesson */}
      {revealed ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5">
            <p className="text-xs text-emerald-800 leading-relaxed">{spot.lesson}</p>
          </div>
          <button
            onClick={next}
            className="w-full px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-100 transition-colors"
          >
            Next showdown →
          </button>
        </div>
      ) : (
        <button
          onClick={() => setRevealed(true)}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 active:scale-95 transition-all shadow-sm"
        >
          Reveal the winner
        </button>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════ */
const Section2: React.FC = () => (
  <div className="space-y-6">
    {/* ── Intro ── */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Texas Hold'em: the world's game</h3>
      <p>
        Of all the poker variants, <strong>Texas Hold'em</strong> is by far the most popular. It's
        the game you see on TV, the one played for millions at the World Series of Poker, and the
        default on nearly every poker app. If someone says "let's play poker" without naming a
        variant, they almost always mean Hold'em.
      </p>
      <p>
        It became so popular for a simple reason: it's easy to learn but endlessly deep. Because
        five of the cards are shared by everyone, you always have a lot of information to reason
        about - and a lot of room to outplay your opponents.
      </p>
    </div>

    {/* ── The setup ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">The setup: 2 + 5 = your best 5</h3>
      <ul className="space-y-2">
        <li className="flex gap-2">
          <span className="text-emerald-600 font-bold">1.</span>
          <span>
            Each player gets <strong>2 private cards</strong>, called your{" "}
            <strong>hole cards</strong>. Only you can see them.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-emerald-600 font-bold">2.</span>
          <span>
            <strong>5 shared cards</strong>, the <strong>community cards</strong>, are dealt
            face-up in the middle for everyone to use.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-emerald-600 font-bold">3.</span>
          <span>
            You make the best <strong>5-card hand</strong> you can from those 7 cards (your 2 plus
            the 5 shared).
          </span>
        </li>
      </ul>
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Example</p>
        <div className="flex flex-wrap gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-1">Your hole cards</p>
            <CardRow cardsStr="As Kd" size="sm" />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">The 5 community cards</p>
            <CardRow cardsStr="Ah Kh 7c 2d 9s" size="sm" />
          </div>
        </div>
        <p className="text-sm text-gray-700">
          Your ace pairs the board ace and your king pairs the board king, so your best hand is{" "}
          <strong>two pair - aces and kings</strong>. The 7♣, 2♦, and 9♠ don't help, so you ignore
          them.
        </p>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-1.5">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Handy detail</p>
        <p className="text-sm text-amber-900 leading-relaxed">
          You can use <strong>two, one, or even zero</strong> of your hole cards. If the five
          community cards already make the best hand, you're "playing the board" - and so is
          everyone else, which usually means the pot gets split.
        </p>
      </div>
    </div>

    {/* ── The button and the blinds ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">The button and the blinds</h3>
      <p>
        Before any cards are dealt, two players are forced to put chips in. These forced bets are
        called the <strong>blinds</strong>:
      </p>
      <ul className="space-y-2">
        <li className="flex gap-2">
          <span className="text-emerald-600 font-bold">•</span>
          <span>
            The <strong>small blind</strong> - a small forced bet from the player just left of the
            dealer.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-emerald-600 font-bold">•</span>
          <span>
            The <strong>big blind</strong> - usually double the small blind, posted by the next
            player to the left.
          </span>
        </li>
      </ul>
      <p>
        A marker called the <strong>button</strong> (or "the dealer") shows whose turn it is to be
        in the dealer's seat. After every hand it moves one seat to the left, so the blinds rotate
        around the table and everyone pays their fair share over time.
      </p>
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
          Why blinds matter so much
        </p>
        <ul className="list-disc list-inside space-y-1.5 text-sm text-emerald-900">
          <li>
            <strong>They create something to fight for.</strong> Without blinds, everyone could fold
            forever for free and nothing would ever happen. The blinds seed a pot every single hand.
          </li>
          <li>
            <strong>They force action.</strong> Because you slowly bleed chips by paying blinds, you
            can't just wait for aces all night - you have to play.
          </li>
          <li>
            <strong>They set the unit of measurement.</strong> Nearly everything in Hold'em is
            measured in big blinds (bb): your stack, your bets, your win rate. A "100bb stack" means
            100 times the big blind.
          </li>
          <li>
            <strong>They shape position.</strong> The blinds act <em>last</em> before the flop but
            <em> first</em> on every later round - a positional disadvantage that makes those seats
            the toughest to play.
          </li>
        </ul>
      </div>
    </div>

    {/* ── The betting rounds ── */}
    <div className="border-t border-gray-200 pt-5 space-y-3">
      <h3 className="font-bold text-gray-900 text-base">The four betting rounds</h3>
      <p className="text-sm text-gray-700 leading-relaxed">
        A hand of Hold'em unfolds over four rounds of betting, with community cards revealed a few
        at a time. Walk through a full hand below - hit "Deal" to reveal each stage.
      </p>
      <DealTheBoard />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {[
          ["Preflop", "After hole cards. Action starts left of the big blind; the blinds act last."],
          ["Flop", "Three community cards at once, then a betting round. From here on, the small blind acts first."],
          ["Turn", "A fourth community card, then another betting round."],
          ["River", "The fifth and final card, one last betting round, then the showdown."],
        ].map(([name, desc]) => (
          <div key={name} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs font-bold text-emerald-700">{name}</p>
            <p className="text-xs text-gray-600 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>

    {/* ── Tricky showdowns ── */}
    <div className="border-t border-gray-200 pt-5 space-y-3">
      <h3 className="font-bold text-gray-900 text-base">Reading tricky showdowns</h3>
      <p className="text-sm text-gray-700 leading-relaxed">
        Because everyone shares the five community cards, working out who actually won can be
        sneaky. Kickers, paired boards, and hands that "play the board" all trip up beginners. Try
        each showdown below - guess the winner, then reveal the real answer (worked out by the same
        engine that runs the rest of this site).
      </p>
      <WhoWinsGame />
    </div>

    {/* ── Quiz ── */}
    <div className="border-t border-gray-200 pt-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-5">
        Check Your Understanding
      </p>
      <div className="space-y-7">
        <QuizQuestion
          question="In Texas Hold'em, how many cards make up your final hand?"
          options={[
            {
              label: "Your best 5 cards out of the 7 available",
              explanation:
                "Correct! You have 2 hole cards plus 5 community cards - 7 total - and your hand is the best 5-card combination from them.",
            },
            {
              label: "All 7 cards (2 hole + 5 community)",
              explanation:
                "No - a poker hand is always exactly 5 cards. You pick the best 5 of the 7 and ignore the other 2.",
            },
            {
              label: "Exactly your 2 hole cards plus 3 community cards",
              explanation:
                "That's an Omaha-style rule. In Hold'em you can use any mix, even zero hole cards if the board is best.",
            },
            {
              label: "Only your 2 hole cards",
              explanation:
                "Your 2 hole cards alone are rarely a full hand. You combine them with the shared community cards.",
            },
          ]}
          correctIndex={0}
        />

        <QuizQuestion
          question="Why do Texas Hold'em games use blinds?"
          options={[
            {
              label: "To seed a pot every hand and force players into action over time",
              explanation:
                "Correct! Blinds guarantee there's always something to play for and cost you chips slowly, so you can't just fold forever waiting for premium hands.",
            },
            {
              label: "To decide who deals the cards",
              explanation:
                "The button marker handles the dealer position. Blinds are forced bets that create a pot and force action.",
            },
            {
              label: "To pay the casino its cut of the pot",
              explanation:
                "The casino's cut is called the 'rake', which is separate. Blinds are forced bets between players that seed the pot.",
            },
            {
              label: "To make sure everyone has the same number of chips",
              explanation:
                "Blinds don't equalize stacks. They seed a pot each hand and pressure players to get involved rather than folding indefinitely.",
            },
          ]}
          correctIndex={0}
        />

        <QuizQuestion
          question="The board is 8♥ 8♦ 5♣ 5♠ 2♥. Player A holds A♣ K♣ and Player B holds Q♦ J♦. Who wins?"
          options={[
            {
              label: "Player A - the ace is the deciding kicker",
              explanation:
                "Correct! Both players use the board's two pair (eights and fives). The fifth card breaks the tie, and A beats Q, so Player A wins.",
            },
            {
              label: "Player B - jacks and queens make a higher two pair",
              explanation:
                "Neither player pairs the board with their hole cards. Both play the board's eights-and-fives; the highest single card is the kicker, and A beats Q. Player A wins.",
            },
            {
              label: "It's a split pot - both play the board",
              explanation:
                "Not quite. They share the two pair on the board, but each adds a different fifth card. A♣ is a higher kicker than Q♦, so Player A wins outright.",
            },
            {
              label: "Player A - two pair beats Player B's one pair",
              explanation:
                "Both actually have the same two pair (from the board). What separates them is the kicker: A beats Q, so Player A wins - but not because of a pair difference.",
            },
          ]}
          correctIndex={0}
        />
      </div>
    </div>
  </div>
);

export default Section2;
