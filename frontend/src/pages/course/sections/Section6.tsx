import React, { useState } from "react";
import QuizQuestion from "../components/QuizQuestion";

/* ── Combos clickable table ── */
const HAND_COMBOS = [
  { hand: "AA (no board cards)", combos: 6, note: "C(4,2) = 6 ways to pair 2 aces from 4 available. Formula: sum down (3+2+1=6)." },
  { hand: "AA (one ace on board)", combos: 3, note: "3 aces remain. C(3,2) = 3 combinations." },
  { hand: "AA (two aces on board)", combos: 1, note: "2 aces remain. C(2,2) = 1 combination." },
  { hand: "AKs (no board cards)", combos: 4, note: "4 suits → 4 suited combos (A♠K♠, A♥K♥, A♦K♦, A♣K♣)." },
  { hand: "AKo (no board cards)", combos: 12, note: "4 × 4 = 16 total AK combos minus 4 suited = 12 offsuit combos." },
  { hand: "AK all (no board cards)", combos: 16, note: "4 suits × 4 suits = 16 total combinations of any AK." },
];

const CombosTable: React.FC = () => {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-800">Click a hand to see the combo count and explanation:</p>
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Hand</th>
              <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Combos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {HAND_COMBOS.map((row, i) => (
              <tr key={i} onClick={() => setSelected(selected === i ? null : i)}
                className={`cursor-pointer transition-colors ${selected === i ? "bg-emerald-50" : "hover:bg-gray-50"}`}>
                <td className="px-4 py-2 font-medium text-gray-800">{row.hand}</td>
                <td className="px-4 py-2 text-center font-bold font-mono text-emerald-700">{row.combos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected !== null && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm text-emerald-800">{HAND_COMBOS[selected].note}</p>
        </div>
      )}
    </div>
  );
};

/* ── MS Method demo ── */
const MSMethodDemo: React.FC = () => {
  const [step, setStep] = useState(0);
  const steps = [
    { label: "Set up the mental slider", text: "Imagine a slider between two reference points you know well. For AK vs a top-pair hand: you know AK has ~29% equity when behind (two overcards). You know AK has ~70% equity against a gutshot draw." },
    { label: "Identify bounds", text: "Lower bound: ~29% (AK vs set). Upper bound: ~70% (AK vs complete air). Our scenario (AK on K-T-4 board vs villain's range) lies somewhere between these." },
    { label: "Slide to the answer", text: "If villain's range is 60% strong hands and 40% draws/air: mentally slide to ~40-45% equity. Exact answer is ~43% — very close without any calculation." },
  ];
  return (
    <div className="space-y-3">
      {steps.slice(0, step + 1).map((s, i) => (
        <div key={i} className={`rounded-lg border px-4 py-3 space-y-1 ${
          i === 0 ? "bg-blue-50 border-blue-200 text-blue-800" :
          i === 1 ? "bg-amber-50 border-amber-200 text-amber-800" :
          "bg-emerald-50 border-emerald-200 text-emerald-800"
        }`}>
          <p className="text-xs font-bold">{s.label}</p>
          <p className="text-sm">{s.text}</p>
        </div>
      ))}
      {step < steps.length - 1 ? (
        <button onClick={() => setStep(step + 1)}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors">
          Next Step
        </button>
      ) : (
        <button onClick={() => setStep(0)}
          className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors">
          Reset
        </button>
      )}
    </div>
  );
};

const Section6: React.FC = () => (
  <div className="space-y-6">

    {/* ── Combinations ── */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Combinations (Combos)</h3>
      <p>
        Every hand has a certain number of <strong>combinations</strong> — specific card pairings
        that make it up. Knowing combo counts lets you weigh how likely a villain's range is made
        up of strong vs weak hands.
      </p>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Three Categories of Starting Hands</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Pocket Pairs", count: "6 combos", sub: "(e.g., AA, KK)", detail: "C(4,2) = 6. Shortcut: sum integers downward (3+2+1=6)." },
            { label: "Suited Hands", count: "4 combos", sub: "(e.g., AKs)", detail: "One per suit. Only 4 suits → 4 suited combos." },
            { label: "Offsuit Hands", count: "12 combos", sub: "(e.g., AKo)", detail: "4 suits × 4 suits = 16 total, minus 4 suited = 12 offsuit." },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-lg border border-emerald-200 p-3 text-center">
              <p className="text-xs font-bold text-gray-700">{c.label}</p>
              <p className="text-2xl font-bold text-emerald-700 font-mono">{c.count}</p>
              <p className="text-xs text-gray-500">{c.sub}</p>
              <p className="text-xs text-gray-400 mt-1 leading-tight">{c.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Board card removal */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Board Card Removal</p>
        <p className="text-sm text-blue-900">
          When a card appears on the board, it's removed from the deck. This reduces the number of
          possible combos for any hand that includes that rank or suit.
        </p>
        <div className="space-y-1.5 text-xs text-blue-800 font-mono bg-white border border-blue-200 rounded-lg p-3">
          <p>AA normally: 6 combos (C(4,2) = 6)</p>
          <p>AA after one ace on board: C(3,2) = 3 combos</p>
          <p>AA after two aces on board: C(2,2) = 1 combo</p>
          <p className="mt-1">AKo normally: 12 combos (4×4 minus 4 suited = 12)</p>
          <p>AKo after A♠ on board: 3×4 = 12 → minus 3 suited = 9 combos</p>
          <p>AKo after A♠ and K♥ on board: 3×3 = 9 → minus 2 suited = 7 combos</p>
        </div>
        <p className="text-xs text-blue-700">
          This is why the same hand can have different weights depending on board texture.
          AA is 6× more likely than an empty range weight, but only 3× as likely after an ace flop.
        </p>
      </div>

      {/* Table 7 - suited holdings */}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Table 7 — Suited Holdings: Board Removal Effect</p>
          <p className="text-xs text-gray-500 mt-0.5">Cards of the relevant suit exposed → possible combinations of that suited holding</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Cards of suit exposed</th>
              <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Remaining combos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[["0","4"],["1","3"],["2","2"],["3","1"],["4","0"]].map(([exposed, combos]) => (
              <tr key={exposed} className="hover:bg-gray-50">
                <td className="text-center px-4 py-2 text-gray-700">{exposed}</td>
                <td className="text-center px-4 py-2 font-bold font-mono text-emerald-700">{combos}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bg-gray-50 border-t border-gray-100 px-4 py-2">
          <p className="text-xs text-gray-500">Example: If you see 2 hearts on board, villain can only hold 2 combos of any specific suited-hearts hand.</p>
        </div>
      </div>
    </div>

    {/* ── Equity vs Range ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Equity vs. a Range</h3>
      <p>
        Villain doesn't have just one hand — they have a <strong>range</strong> of possible hands.
        Your real equity is not against a single hand, but against the distribution of all hands
        in their range.
      </p>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
          Four-Step Equity vs. Range Method
        </p>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-emerald-900">
          <li>Determine your <strong>equity against each specific hand</strong> in villain's range</li>
          <li>Multiply each equity by the <strong>number of combos</strong> of that hand</li>
          <li><strong>Sum</strong> all of those (equity × combos) products</li>
          <li>Divide by the <strong>total number of combos</strong> in the range</li>
        </ol>
        <div className="bg-white rounded-lg border border-emerald-200 p-3 text-xs font-mono text-emerald-700 space-y-0.5">
          <p className="font-bold text-sm font-sans">Example: Your AK vs villain's QQ+, AQ+</p>
          <p>AK vs AA (6 combos): 32% equity → 6 × 32 = 192</p>
          <p>AK vs KK (6 combos): 32% equity → 6 × 32 = 192</p>
          <p>AK vs QQ (6 combos): 44% equity → 6 × 44 = 264</p>
          <p>AK vs AQs (4 combos): 74% equity → 4 × 74 = 296</p>
          <p>AK vs AQo (12 combos): 74% equity → 12 × 74 = 888</p>
          <p className="mt-1">Total: 192+192+264+296+888 = 1832</p>
          <p>Combos: 6+6+6+4+12 = 34</p>
          <p>Avg equity = 1832 ÷ 34 = <strong>~54%</strong></p>
        </div>
      </div>

      {/* MS Method */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">The Mental Slider (MS Method)</p>
        <p className="text-sm text-blue-900">
          The four-step method is precise but slow at the table. The{" "}
          <strong>Mental Slider</strong> is a fast approximation: mentally picture a slider
          between two known equity reference points, then estimate where your actual situation
          falls based on how strong or weak the range is.
        </p>
        <p className="text-sm text-blue-800">
          Example anchors: "I'm about 30% vs a set" and "I'm about 50% vs top pair." If villain's
          range is half sets and half top pair, my equity is roughly 40% (halfway between).
        </p>
      </div>

      {/* Which Bucks */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Which Bucks? (Sklansky, G-Bucks, and Reciprocal)</p>
        <div className="space-y-2.5 text-sm text-amber-900">
          <div>
            <p className="font-semibold">Real Bucks</p>
            <p className="text-xs text-amber-700">
              Actual money won or lost. A useful bottom-line measure for results, but tells you
              nothing about whether your decisions were correct.
            </p>
          </div>
          <div>
            <p className="font-semibold">Sklansky Bucks (S-Bucks)</p>
            <p className="text-xs text-amber-700">
              What you <em>should</em> have won based on your equity at the time money went in.
              If you got all-in with 70% equity for a $100 pot, you "won" $70 in S-Bucks
              regardless of the actual outcome. Measures decision quality.
            </p>
          </div>
          <div>
            <p className="font-semibold">G-Bucks</p>
            <p className="text-xs text-amber-700">
              Sklansky Bucks calculated against villain's <em>entire range</em>, not just the
              specific hand they had. More accurate than S-Bucks for measuring decision quality
              because your opponent's hand is unknown when you decide.
            </p>
          </div>
          <div>
            <p className="font-semibold">Reciprocal Bucks</p>
            <p className="text-xs text-amber-700">
              Measures how much your opponent's G-Bucks suffer from your play. If your bet
              causes villain to make a mistake, you gain Reciprocal Bucks even if your hand
              doesn't win. Used to evaluate deceptive plays and traps.
            </p>
          </div>
        </div>
      </div>
    </div>

    {/* ── Interactives ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-4">
        Combo Counter
      </p>
      <CombosTable />
    </div>

    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-4">
        Mental Slider Walkthrough
      </p>
      <MSMethodDemo />
    </div>

    {/* ── Quiz ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-5">
        Check Your Understanding
      </p>
      <div className="space-y-7">
        <QuizQuestion
          question="How many combinations of JJ are possible when no jacks have appeared on the board?"
          options={[
            { label: "4 combos", explanation: "4 combos is the count for a suited holding (like AKs). For a pocket pair, C(4,2) = 6 combos." },
            { label: "6 combos", explanation: "Correct! C(4,2) = 4!/(2!×2!) = 6. Or use the sum shortcut: 3+2+1 = 6." },
            { label: "8 combos", explanation: "There are 4 jacks in the deck. C(4,2) = 6 ways to make JJ, not 8." },
            { label: "12 combos", explanation: "12 is the count for an offsuit holding like JTo. Pocket pairs have C(4,2) = 6 combos." },
          ]}
          correctIndex={1}
        />

        <QuizQuestion
          question="Villain 3-bets and you put them on QQ+, AKs. After an ace falls on the flop, how many AA combos remain?"
          options={[
            { label: "6 combos", explanation: "One ace is now visible on the board. With 3 aces remaining: C(3,2) = 3 combos, not 6." },
            { label: "4 combos", explanation: "One ace is on the board, leaving 3 aces. C(3,2) = 3 combos." },
            { label: "3 combos", explanation: "Correct! One ace removed by the board. 3 aces remain. C(3,2) = 3 ways to hold AA." },
            { label: "2 combos", explanation: "Only one ace is on the board (not two). 3 aces remain → C(3,2) = 3 combos." },
          ]}
          correctIndex={2}
        />

        <QuizQuestion
          question="Which method gives the most accurate picture of how profitable your decision was against an opponent's unknown range?"
          options={[
            { label: "Real Bucks — actual money won determines decision quality", explanation: "Real Bucks measure outcomes, not decisions. You can win with a terrible decision (bad call) or lose with a perfect one. Outcomes = results; G-Bucks = decision quality." },
            { label: "Sklansky Bucks — equity × pot at the moment of all-in", explanation: "S-Bucks are better than real bucks, but they measure equity vs the specific hand villain had. G-Bucks use villain's entire range — more accurate for decision quality." },
            { label: "G-Bucks — equity vs villain's full range × pot", explanation: "Correct! G-Bucks measure your equity against villain's entire range, not just the hand they happened to hold. This is the truest measure of whether your decision was correct." },
            { label: "Reciprocal Bucks — how badly you made villain play", explanation: "Reciprocal Bucks measure the mistakes your play induced in villain, not your own decision quality. G-Bucks is the measure of how good your decision was." },
          ]}
          correctIndex={2}
        />
      </div>
    </div>
  </div>
);

export default Section6;
