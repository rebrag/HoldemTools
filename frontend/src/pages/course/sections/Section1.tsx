import React from "react";
import QuizQuestion from "../components/QuizQuestion";

const Section1: React.FC = () => (
  <div className="space-y-6">
    {/* Explanation */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <p>
        Poker is a game of incomplete information. You never know exactly what cards your opponents
        hold, which means every decision is made under uncertainty. Most players try to overcome
        this with "feel" — instinct, experience, and reading tells. But feel is unreliable.
        Math is not.
      </p>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
          The Two Keys to Making Money
        </p>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-emerald-900">
          <li>
            <strong>Make accurate assumptions</strong> about your opponent's cards and tendencies
          </li>
          <li>
            <strong>Make the best decision</strong> given those assumptions
          </li>
        </ol>
      </div>

      <p>
        If you knew with certainty what your opponent held, making the right decision would be
        trivial — just fold the worse hand or call with the better one. The difficulty is step one:
        building <em>accurate</em> assumptions. This is where math earns its place.
      </p>

      <p>
        Consider a simple analogy: a coin that lands heads 60% of the time. If you know this fact
        (an accurate assumption), math immediately tells you to always bet on heads. You'll lose
        40% of flips, but you'll profit in the long run. Poker works the same way — you won't win
        every hand, but accurate assumptions + correct decisions = long-run profit.
      </p>

      <p>
        A player who makes <em>worse</em> assumptions but <em>better</em> decisions can still
        outperform a player who has <em>better</em> assumptions but makes <em>worse</em> decisions.
        Both keys matter, and they work together. The goal of this course is to sharpen both.
      </p>
    </div>

    {/* Quiz */}
    <div className="border-t border-gray-200 pt-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-5">
        Check Your Understanding
      </p>
      <div className="space-y-7">
        <QuizQuestion
          question="What are the two keys to consistently making money at poker?"
          options={[
            {
              label: "Bluffing often and playing aggressively",
              explanation:
                "Aggression is a useful tool, but without accurate assumptions it becomes reckless. Mindless aggression doesn't define a winning framework.",
            },
            {
              label: "Making accurate assumptions and choosing the highest-EV decision",
              explanation:
                "Exactly. Accurate assumptions let you model the situation correctly; choosing the highest-EV option ensures you exploit it optimally. These two keys underpin every profitable poker decision.",
            },
            {
              label: "Playing tight preflop and value betting rivers",
              explanation:
                "These are good tactics in many spots, but they don't define the underlying framework for all profitable decisions across all streets and situations.",
            },
            {
              label: "Reading physical tells and having strong instincts",
              explanation:
                "Tells exist, but they're unreliable and impossible to quantify. Math provides a repeatable, scalable foundation that doesn't depend on live reads.",
            },
          ]}
          correctIndex={1}
        />

        <QuizQuestion
          question="You bluff $30 into a $30 pot. You estimate your opponent folds 70% of the time. What is the EV of this bluff?"
          options={[
            {
              label: "$3",
              explanation:
                "EV = (fold% × amount won) + (call% × amount lost) = (0.70 × $30) + (0.30 × −$30) = $21 − $9 = +$12.",
            },
            {
              label: "$12",
              explanation:
                "Correct! EV = (0.70 × $30) + (0.30 × −$30) = $21 − $9 = +$12. A clear positive-EV bluff.",
            },
            {
              label: "$21",
              explanation:
                "That's only the winning portion. You also lose $30 when called 30% of the time: (0.30 × −$30) = −$9. Net EV = $21 − $9 = +$12.",
            },
            {
              label: "−$9",
              explanation:
                "That's only the losing portion. You also win $30 when they fold 70% of the time: (0.70 × $30) = +$21. Net EV = $21 − $9 = +$12.",
            },
          ]}
          correctIndex={1}
        />

        <QuizQuestion
          question="A player always makes accurate assumptions and picks the highest-EV decision. Will they always win each individual hand?"
          options={[
            {
              label: "No — correct decisions guarantee long-run profit, not individual hand outcomes",
              explanation:
                "Exactly. Variance is unavoidable: even a mathematically perfect call loses when the opponent hits their 20% draw. What math guarantees is profit over a large enough sample — not on any single hand.",
            },
            {
              label: "Yes — correct decisions always produce winning outcomes",
              explanation:
                "Not true. Even the best decision loses to bad luck in the short run. The math guarantees long-run expectation, not individual results.",
            },
            {
              label: "Only if they have the best hand going in",
              explanation:
                "Having the best hand and making the best decision are separate things. A mathematically correct fold is still a losing hand, and a correct call with the best hand can still lose to a draw.",
            },
            {
              label: "Only in cash games, not tournaments",
              explanation:
                "EV applies in both formats. Tournaments add ICM complexity (chip EV ≠ dollar EV), but the fundamental framework of accurate assumptions + best decisions holds in all forms of poker.",
            },
          ]}
          correctIndex={0}
        />
      </div>
    </div>
  </div>
);

export default Section1;
