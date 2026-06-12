import React, { useState } from "react";
import QuizQuestion from "../components/QuizQuestion";

/* ── Pot odds calculator ── */
interface Scenario {
  pot: number;
  call: number;
  equity: number;
  label: string;
}

const SCENARIOS: Scenario[] = [
  { pot: 60, call: 20, equity: 36, label: "Flush draw vs ⅓-pot bet" },
  { pot: 80, call: 40, equity: 24, label: "Gutshot vs ½-pot bet" },
  { pot: 100, call: 100, equity: 33, label: "OESD vs pot-size bet" },
  { pot: 50, call: 25, equity: 20, label: "Overcards vs ½-pot bet" },
];

const PotOddsCalc: React.FC = () => {
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const sc = SCENARIOS[idx];
  const required = Math.round((sc.call / (sc.call + sc.pot)) * 100);
  const profitable = sc.equity > required;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SCENARIOS.map((s, i) => (
          <button key={i} onClick={() => { setIdx(i); setRevealed(false); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              idx === i ? "bg-emerald-600 border-emerald-600 text-white" : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-emerald-50 hover:border-emerald-300"
            }`}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-1 text-sm">
        <p>Pot: <strong>${sc.pot}</strong> &nbsp;|&nbsp; Call: <strong>${sc.call}</strong> &nbsp;|&nbsp; My equity: <strong>{sc.equity}%</strong></p>
      </div>
      {!revealed ? (
        <button onClick={() => setRevealed(true)}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors">
          Calculate
        </button>
      ) : (
        <div className={`rounded-lg border px-4 py-3 space-y-2 ${profitable ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
          <p className="text-xs font-mono text-gray-700">
            Pot odds: ${sc.call} ÷ (${sc.call} + ${sc.pot}) = <strong>{required}% needed</strong>
          </p>
          <p className={`text-xs font-mono ${profitable ? "text-emerald-700" : "text-red-700"}`}>
            My equity ({sc.equity}%) {profitable ? ">" : "<"} required ({required}%) → {" "}
            <strong className="text-base">{profitable ? "CALL" : "FOLD"}</strong>
          </p>
          {profitable && (
            <p className="text-xs text-emerald-600">Profitable call: {sc.equity - required}% above break-even</p>
          )}
          {!profitable && (
            <p className="text-xs text-red-600">Losing call: {required - sc.equity}% below break-even. Implied odds could change this.</p>
          )}
        </div>
      )}
    </div>
  );
};

const Section5: React.FC = () => (
  <div className="space-y-6">

    {/* ── Pot Odds ── */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Pot Odds</h3>
      <p>
        <strong>Pot odds</strong> tell you how much equity you need to make a profitable call.
        They are the reward-to-risk ratio expressed as a percentage. If the pot odds require 25%
        equity and you have 30%, calling is profitable.
      </p>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Formula</p>
        <p className="text-center font-mono font-bold text-lg text-emerald-800 py-1">
          Required equity = call ÷ (call + pot)
        </p>
        <div className="bg-white rounded-lg border border-emerald-200 p-3 text-xs font-mono text-emerald-700 space-y-0.5">
          <p className="font-bold text-sm font-sans">Example: Pot $60, villain bets $20</p>
          <p>Call = $20 &nbsp; Total pot after call = $20 + $60 = $80</p>
          <p>Required equity = $20 ÷ $80 = 25%</p>
        </div>
      </div>

      {/* Table 5 - the must-memorize table */}
      <div className="overflow-hidden rounded-xl border border-emerald-200">
        <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
            Table 5 — Required Equity After Villain Bets (Memorize These)
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-emerald-50 border-b border-emerald-100">
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-emerald-600">Villain's Bet Size</th>
              <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-emerald-600">Equity Needed to Call</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[
              ["2× pot bet", "40%"],
              ["Pot-size bet", "33%"],
              ["⅔ pot bet", "28%"],
              ["½ pot bet", "25%"],
              ["⅓ pot bet", "20%"],
              ["¼ pot bet", "16%"],
            ].map(([size, pct]) => (
              <tr key={size as string} className="hover:bg-emerald-50">
                <td className="px-4 py-2 font-semibold text-gray-700">{size}</td>
                <td className="px-4 py-2 text-center font-bold font-mono text-emerald-700">{pct}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bg-emerald-50 border-t border-emerald-100 px-4 py-2">
          <p className="text-xs text-emerald-600">
            These six values are worth memorizing. At the table, quickly identify the bet size
            as a fraction of pot and read off the required equity.
          </p>
        </div>
      </div>

      {/* Full worked example */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Full Worked Example</p>
        <p className="text-sm text-gray-700">
          Flop: You have a flush draw (9 outs). Pot is $60. Villain bets $40 (⅔-pot bet).
          Should you call?
        </p>
        <div className="text-xs font-mono text-gray-700 bg-white border border-gray-200 rounded-lg p-3 space-y-0.5">
          <p>Step 1: Pot odds = $40 ÷ ($40 + $60) = $40 ÷ $100 = 40% needed</p>
          <p>Step 2: Equity = 9 outs × 2 = 18% (just the turn, not all-in)</p>
          <p>Step 3: 18% &lt; 40% → FOLD (unless implied odds are strong)</p>
        </div>
        <p className="text-xs text-gray-500">
          But if you were all-in (seeing turn + river): 9 × 4 = 36%. Still 36% &lt; 40% → fold or
          need implied odds. This is a marginal spot — implied odds analysis is needed.
        </p>
      </div>

      {/* EV method */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
          Alternative: EV Method for Calling
        </p>
        <p className="text-sm text-blue-900">
          Instead of comparing percentages, you can calculate the EV of the call directly:
        </p>
        <div className="text-xs font-mono text-blue-800 bg-white border border-blue-200 rounded-lg p-3 space-y-0.5">
          <p>EV = (equity × pot after call) − ((1 − equity) × call)</p>
          <p>EV = (0.36 × $100) − (0.64 × $40)</p>
          <p>EV = $36 − $25.60 = <strong>+$10.40</strong></p>
        </div>
        <p className="text-xs text-blue-700 mt-1">
          Both methods give the same answer — choose whichever is faster for you mentally.
        </p>
      </div>
    </div>

    {/* ── Implied Odds ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Implied Odds</h3>
      <p>
        Pot odds only consider the current bet. <strong>Implied odds</strong> account for the money
        you expect to win on future streets if you hit your draw. A call can be profitable even if
        the pot odds alone don't justify it — as long as you expect to win enough extra on future
        streets.
      </p>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Implied Odds — Key Factors</p>
        <ul className="list-disc list-inside space-y-1.5 text-sm text-amber-900">
          <li><strong>Villain's hand strength:</strong> the stronger villain's hand, the more they'll call when you complete your draw</li>
          <li><strong>Draw disguise:</strong> straight draws are harder to spot than flush draws; disguised draws have higher implied odds</li>
          <li><strong>Stack depth:</strong> you need deep stacks to extract value after hitting</li>
          <li><strong>Position:</strong> being in position makes it easier to control pot size and extract value</li>
          <li><strong>Reverse implied odds:</strong> some draws actually cost money when completed (e.g., nut-low straight on a flushing board)</li>
        </ul>
      </div>

      {/* Table 6 */}
      <div className="overflow-hidden rounded-xl border border-amber-200">
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
            Table 6 — Implied Odds Multipliers
          </p>
          <p className="text-xs text-amber-600 mt-0.5">
            How much total money (in calls) you need in the remaining stacks to justify calling with your draw
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-amber-50 border-b border-amber-100">
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-amber-600">Your Equity</th>
              <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-amber-600">Multiply Call By</th>
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-amber-600">Example: $20 call needs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {[
              ["~35% (flush draw, pot bet)", "2×", "$40 in remaining stacks"],
              ["~25% (flush draw, 2× pot)", "3×", "$60 in remaining stacks"],
              ["~20% (gutshot, ½-pot)", "4×", "$80 in remaining stacks"],
              ["~15% (gutshot, pot bet)", "6×", "$120 in remaining stacks"],
              ["~10% (backdoor draw)", "9×", "$180 in remaining stacks"],
            ].map(([equity, mult, ex]) => (
              <tr key={equity as string} className="hover:bg-amber-50">
                <td className="px-4 py-2 text-gray-700">{equity}</td>
                <td className="px-4 py-2 text-center font-bold font-mono text-amber-700">{mult}</td>
                <td className="px-4 py-2 text-xs text-gray-600">{ex}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bg-amber-50 border-t border-amber-100 px-4 py-2">
          <p className="text-xs text-amber-600">
            These multipliers assume you will win the full remaining stack when you hit. If you
            won't always stack villain after completing, increase the multiplier requirement.
          </p>
        </div>
      </div>
    </div>

    {/* ── Interactive ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-4">
        Pot Odds Decision Drills
      </p>
      <PotOddsCalc />
    </div>

    {/* ── Quiz ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-5">
        Check Your Understanding
      </p>
      <div className="space-y-7">
        <QuizQuestion
          question="Using Table 5, what equity do you need to call a ½-pot bet from villain?"
          options={[
            { label: "20%", explanation: "20% is the required equity for a ⅓-pot bet. A ½-pot bet requires 25%: $50 ÷ ($50 dead + $50 bet + $50 call) = $50 ÷ $200 = 25%." },
            { label: "25%", explanation: "Correct! Pot $100, villain bets $50 (½ pot). Required = call ÷ total pot = $50 ÷ ($100 + $50 + $50) = $50 ÷ $200 = 25%." },
            { label: "28%", explanation: "28% is for a ⅔-pot bet. For a ½-pot bet: pot $100, bet $50 → $50 ÷ $200 = 25%." },
            { label: "33%", explanation: "33% is for a pot-size bet. For a ½-pot bet: pot $100, bet $50 → $50 ÷ ($100 + $50 + $50) = $50 ÷ $200 = 25%." },
          ]}
          correctIndex={1}
        />

        <QuizQuestion
          question="Pot is $80, villain bets $80 (pot-size bet). You have a gutshot straight draw (4 outs) on the turn. Should you call based on pot odds alone?"
          options={[
            { label: "Yes — a pot-size bet only needs 25% equity", explanation: "A pot-size bet needs 33% equity: $80 ÷ ($80 + $80) = 33%. Gutshot on turn: 4 × 2 = 8%. Way below 33% → fold unless strong implied odds." },
            { label: "Yes — a gutshot has enough equity vs a pot bet", explanation: "Gutshot on turn: 4 × 2 = 8%. A pot-size bet requires 33%. 8% < 33% — this is a large fold based on pot odds alone." },
            { label: "No — pot-size bets need 33% equity; gutshot turn equity is only ~8%", explanation: "Correct! $80 ÷ $160 = 33% needed. Gutshot turn equity = 4 × 2 = 8%. Far below → fold or need major implied odds (4× multiplier)." },
            { label: "No — you should never call with a gutshot", explanation: "Gutshots can be profitable with good implied odds. The issue here is that the required equity (33%) far exceeds your equity (8%), not that gutshots are always bad." },
          ]}
          correctIndex={2}
        />

        <QuizQuestion
          question="You have a flush draw and call a bet. Using Table 6, if your equity is ~20% and the call is $30, how much do you need in remaining stacks to justify the call on implied odds?"
          options={[
            { label: "$60 (2× the call)", explanation: "At ~20% equity, the implied odds multiplier from Table 6 is 4×. $30 × 4 = $120." },
            { label: "$90 (3× the call)", explanation: "3× is for ~25% equity. At ~20% equity, use 4×: $30 × 4 = $120." },
            { label: "$120 (4× the call)", explanation: "Correct! Table 6: ~20% equity requires a 4× multiplier. $30 × 4 = $120 in remaining stacks needed to justify the call." },
            { label: "$180 (6× the call)", explanation: "6× is for ~15% equity. At ~20% equity, the multiplier is 4×: $30 × 4 = $120." },
          ]}
          correctIndex={2}
        />
      </div>
    </div>
  </div>
);

export default Section5;
