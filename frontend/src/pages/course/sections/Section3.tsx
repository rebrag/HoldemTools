import React, { useState } from "react";
import QuizQuestion from "../components/QuizQuestion";

/* ── Conversion Table ── */
const CONVERSIONS = [
  { frac: "1/2", pct: "50%", ratio: "1:1" },
  { frac: "1/3", pct: "33.3%", ratio: "2:1" },
  { frac: "1/4", pct: "25%", ratio: "3:1" },
  { frac: "1/5", pct: "20%", ratio: "4:1" },
  { frac: "1/6", pct: "16.7%", ratio: "5:1" },
  { frac: "2/5", pct: "40%", ratio: "3:2" },
];

const ConversionTable: React.FC = () => (
  <div className="overflow-hidden rounded-xl border border-gray-200">
    <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Fraction ↔ Percentage ↔ Ratio Conversions</p>
    </div>
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-100">
          <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Fraction</th>
          <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Percentage</th>
          <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Ratio (against:for)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {CONVERSIONS.map(({ frac, pct, ratio }) => (
          <tr key={frac} className="hover:bg-gray-50">
            <td className="text-center px-4 py-2 font-mono font-semibold text-gray-800">{frac}</td>
            <td className="text-center px-4 py-2 font-mono text-emerald-700 font-semibold">{pct}</td>
            <td className="text-center px-4 py-2 font-mono text-blue-700 font-semibold">{ratio}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/* ── EV Step-by-step workthrough ── */
const EV_STEPS = [
  {
    label: "Step 1 — Identify each outcome and its probability",
    content: [
      "Outcome A: bluff succeeds (villain folds) — probability 60%",
      "Outcome B: bluff fails (villain calls / raises) — probability 40%",
    ],
    bg: "bg-blue-50 border-blue-200 text-blue-800",
  },
  {
    label: "Step 2 — Multiply probability × result for each outcome",
    content: [
      "Outcome A: 0.60 × +$60 (win the pot) = +$36",
      "Outcome B: 0.40 × −$40 (lose your bet) = −$16",
    ],
    bg: "bg-amber-50 border-amber-200 text-amber-800",
  },
  {
    label: "Step 3 — Sum all results to get EV",
    content: [
      "+$36 + (−$16) = +$20",
      "EV of this bluff = +$20 per attempt.",
    ],
    bg: "bg-emerald-50 border-emerald-200 text-emerald-800",
  },
];

const EVWorkthrough: React.FC = () => {
  const [reveal, setReveal] = useState(0);
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-gray-600">
        Scenario: Pot is $60. You bet $40 as a bluff. Villain folds 60% of the time.
        Click to reveal each step.
      </p>
      {EV_STEPS.slice(0, reveal + 1).map((step, i) => (
        <div key={i} className={`rounded-lg border px-4 py-3 space-y-1.5 ${step.bg}`}>
          <p className="text-xs font-bold">{step.label}</p>
          {step.content.map((line, j) => (
            <p key={j} className="text-sm font-mono">{line}</p>
          ))}
        </div>
      ))}
      {reveal < EV_STEPS.length - 1 ? (
        <button
          onClick={() => setReveal(reveal + 1)}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          Reveal Step {reveal + 2}
        </button>
      ) : (
        <button
          onClick={() => setReveal(0)}
          className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          Reset
        </button>
      )}
    </div>
  );
};

const Section3: React.FC = () => (
  <div className="space-y-6">

    {/* ── Fractions, Percentages, Ratios ── */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Fractions, Percentages and Ratios</h3>
      <p>
        Probability can be expressed in three ways, and poker players need to convert between all
        three fluently. Each representation is just a different language for the same underlying
        number.
      </p>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">The Three Forms</p>
        <div className="space-y-2 text-sm text-blue-900">
          <div className="bg-white rounded-lg border border-blue-200 p-3">
            <p className="font-semibold">Fraction</p>
            <p className="text-xs text-blue-700 mt-0.5">
              numerator / denominator. The numerator is favorable outcomes; denominator is total
              outcomes. <code>1/4</code> means 1 success in 4 tries.
            </p>
          </div>
          <div className="bg-white rounded-lg border border-blue-200 p-3">
            <p className="font-semibold">Percentage</p>
            <p className="text-xs text-blue-700 mt-0.5">
              Convert from fraction: divide top by bottom, then multiply by 100.{" "}
              <code>1/4 = 0.25 = 25%</code>. Shortcut: divide, then shift decimal 2 places right.
            </p>
          </div>
          <div className="bg-white rounded-lg border border-blue-200 p-3">
            <p className="font-semibold">Ratio (against : for)</p>
            <p className="text-xs text-blue-700 mt-0.5">
              "Losing outcomes : winning outcomes." Fraction <code>1/4</code> → losses = 4 − 1 = 3 → ratio{" "}
              <code>3:1</code>. To convert back: ratio <code>m:n</code> → fraction{" "}
              <code>n / (m + n)</code>.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
          The Doors Warning — 5:1 ≠ 1/5
        </p>
        <p className="text-sm text-amber-900">
          The Doors song "Five to One" (5:1 ratio) does <em>not</em> mean a 1/5 probability. A
          5:1 ratio means 5 losses for every 1 win, so the fraction is{" "}
          <strong>1/(5+1) = 1/6 ≈ 16.7%</strong>. This is one of the most common conversion errors
          in poker. Always use the formula: ratio <code>m:n → n/(m+n)</code>.
        </p>
      </div>

      <ConversionTable />
    </div>

    {/* ── EV ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Expectation Value (EV)</h3>
      <p>
        <strong>Expectation value</strong> is the average result of a decision repeated thousands
        of times. A decision is <strong>+EV</strong> if it makes money on average and{" "}
        <strong>−EV</strong> if it loses money. EV is not about any single hand — you can make the
        mathematically correct decision and still lose that particular pot. The math guarantees
        profit only over a large sample.
      </p>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Three Steps to Calculate EV</p>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-emerald-900">
          <li>Identify <strong>each possible outcome</strong> and its probability (must total 100%)</li>
          <li>For each outcome: <strong>probability × result</strong> (+ for wins, − for losses)</li>
          <li><strong>Sum all results</strong> to get overall EV</li>
        </ol>
        <p className="text-xs text-emerald-700">
          Formula shorthand: <code>EV = Σ (P × R)</code> — sum of probability times result for all outcomes.
        </p>
      </div>

      {/* Coin flip */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Example: Coin Flip</p>
        <p className="text-sm text-gray-700">Heads → lose $10. Tails → win $15. Should you play?</p>
        <div className="text-xs font-mono text-gray-700 bg-white border border-gray-200 rounded-lg p-3 space-y-0.5">
          <p>Step 1: heads (50%), tails (50%)</p>
          <p>Step 2: 0.50 × (−$10) = −$5 &nbsp;&nbsp; | &nbsp;&nbsp; 0.50 × (+$15) = +$7.50</p>
          <p>Step 3: −$5 + $7.50 = <strong>+$2.50</strong></p>
        </div>
        <p className="text-xs text-gray-500">EV = +$2.50 per flip. Yes — always play this game.</p>
      </div>

      {/* Die example */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Example: Rolling a Die</p>
        <p className="text-sm text-gray-700">
          Roll 1 or 2 → win $3. Anything else → lose $1. EV?
        </p>
        <div className="text-xs font-mono text-gray-700 bg-white border border-gray-200 rounded-lg p-3 space-y-0.5">
          <p>Step 1: Win = 2/6 = 1/3 &nbsp;&nbsp;|&nbsp;&nbsp; Lose = 4/6 = 2/3</p>
          <p>Step 2: (1/3) × +$3 = +$1.00 &nbsp;&nbsp;|&nbsp;&nbsp; (2/3) × −$1 = −$0.67</p>
          <p>Step 3: +$1.00 − $0.67 = <strong>+$0.33</strong></p>
        </div>
        <p className="text-xs text-gray-500">EV = +$0.33 per roll. Positive — play.</p>
      </div>

      {/* Negative EV */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Example: Card Draw (Negative EV)</p>
        <p className="text-sm text-gray-700">
          Draw from a full deck. Ace → win $10; any other card → lose $1. EV?
        </p>
        <div className="text-xs font-mono text-gray-700 bg-white border border-gray-200 rounded-lg p-3 space-y-0.5">
          <p>Step 1: Win = 4/52 = 1/13 &nbsp;&nbsp;|&nbsp;&nbsp; Lose = 48/52 = 12/13</p>
          <p>Step 2: (1/13) × $10 = +$0.77 &nbsp;&nbsp;|&nbsp;&nbsp; (12/13) × (−$1) = −$0.92</p>
          <p>Step 3: +$0.77 − $0.92 = <strong>−$0.15</strong></p>
        </div>
        <p className="text-xs text-gray-500">EV = −$0.15 per draw. Negative — don't play.</p>
      </div>
    </div>

    {/* ── Interactive ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-4">
        Interactive — Step-By-Step EV Calculation
      </p>
      <EVWorkthrough />
    </div>

    {/* ── Quiz ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-5">
        Check Your Understanding
      </p>
      <div className="space-y-7">
        <QuizQuestion
          question="Convert the ratio 4:1 to a fraction and then to a percentage."
          options={[
            { label: "Fraction: 1/4, Percentage: 25%", explanation: "Close — but ratio 4:1 means 4 losses for every 1 win. Fraction = 1/(4+1) = 1/5 = 20%, not 1/4." },
            { label: "Fraction: 1/5, Percentage: 20%", explanation: "Correct! Ratio m:n → fraction n/(m+n). So 4:1 → 1/(4+1) = 1/5 = 20%." },
            { label: "Fraction: 4/5, Percentage: 80%", explanation: "4/5 (80%) represents the probability of LOSING (4 in 5 outcomes). The WIN probability is 1/5 = 20%." },
            { label: "Fraction: 1/4, Percentage: 33%", explanation: "1/4 = 25%, not 33%. Ratio 4:1 → 1/5 = 20%. Watch for The Doors trap!" },
          ]}
          correctIndex={1}
        />

        <QuizQuestion
          question="You roll one die. Rolling a 6 wins you $4. Anything else loses $1. What is the EV per roll?"
          options={[
            { label: "+$0.50", explanation: "EV = (1/6 × $4) + (5/6 × −$1) = $0.667 − $0.833 = −$0.17." },
            { label: "+$0.17", explanation: "EV = (1/6 × $4) + (5/6 × −$1) = $0.667 − $0.833 = −$0.17 (negative EV)." },
            { label: "−$0.17", explanation: "Correct! (1/6 × $4) + (5/6 × −$1) = $0.667 − $0.833 = −$0.167. Negative EV — don't play." },
            { label: "+$0.33", explanation: "EV = (1/6 × $4) + (5/6 × −$1) = $0.67 − $0.83 = −$0.17." },
          ]}
          correctIndex={2}
        />

        <QuizQuestion
          question="You call a river bet. 40% of the time villain is bluffing (you win the $200 pot). 60% of the time villain has it (you lose your $60 call). What is the EV of calling?"
          options={[
            { label: "+$16", explanation: "EV = (0.40 × +$200) + (0.60 × −$60) = $80 − $36 = +$44." },
            { label: "+$44", explanation: "Correct! EV = (0.40 × $200) + (0.60 × −$60) = $80 − $36 = +$44. Call is clearly profitable." },
            { label: "−$16", explanation: "EV = (0.40 × $200) + (0.60 × −$60) = $80 − $36 = +$44. Positive EV." },
            { label: "+$28", explanation: "EV = (0.40 × $200) + (0.60 × −$60) = $80 − $36 = +$44." },
          ]}
          correctIndex={1}
        />
      </div>
    </div>
  </div>
);

export default Section3;
