import React, { useState } from "react";
import QuizQuestion from "../components/QuizQuestion";
import ChipStack from "@/components/ChipStack";

/* ── Bluff calc ── */
const BluffCalc: React.FC = () => {
  const [pot, setPot] = useState(60);
  const [bet, setBet] = useState(60);
  const breakEven = Math.round((bet / (bet + pot)) * 100);
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-gray-800">Bluff break-even calculator:</p>
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">Pot size: ${pot}</label>
          <input type="range" min={10} max={300} step={5} value={pot}
            onChange={(e) => setPot(Number(e.target.value))} className="w-full accent-emerald-600" />
        </div>
        <div className="space-y-1">
          <div className="flex justify-between">
            <label className="text-xs font-semibold text-gray-600">Bet: ${bet}</label>
            <span className="text-xs text-gray-400">({Math.round((bet / pot) * 100)}% of pot)</span>
          </div>
          <input type="range" min={5} max={400} step={5} value={bet}
            onChange={(e) => setBet(Number(e.target.value))} className="w-full accent-blue-600" />
        </div>
      </div>
      <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-3">
        <div className="flex items-end justify-around pb-3 border-b border-emerald-200">
          <div className="flex flex-col items-center gap-1">
            <ChipStack amount={pot} showBreakdown={false} showLabel={false} />
            <span className="text-[10px] text-gray-500 font-medium">Pot</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ChipStack amount={bet} showBreakdown={false} showLabel={false} />
            <span className="text-[10px] text-gray-500 font-medium">Your bluff</span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-emerald-700">Break-even fold %</span>
          <span className="text-2xl font-bold text-emerald-700">{breakEven}%</span>
        </div>
        <p className="text-xs font-mono text-emerald-600">${bet} ÷ (${bet} + ${pot}) = {breakEven}%</p>
        <p className="text-xs text-emerald-600">
          Villain must fold {">"}  {breakEven}% for this bluff to be immediately profitable.
          {breakEven > 60 && " This is a large bluff — ensure you have fold equity."}
          {breakEven < 35 && " Low break-even — this bet can be profitable even if villain folds rarely."}
        </p>
      </div>
    </div>
  );
};

/* ── Semi-bluff shortcut ── */
const SemiBluffCalc: React.FC = () => {
  const [pot, setPot] = useState(80);
  const [shove, setShove] = useState(80);
  const [equity, setEquity] = useState(35);
  const totalPot = pot + shove;
  const winWhenCalled = (equity / 100) * (totalPot + shove);
  const loseWhenCalled = shove;
  const breakEvenFold = Math.round((shove / totalPot) * 100);
  const ev = ((breakEvenFold / 100) * pot) + ((1 - breakEvenFold / 100) * (winWhenCalled - loseWhenCalled));
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-gray-800">Semi-bluff shove analysis:</p>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">Current pot: ${pot}</label>
          <input type="range" min={10} max={200} step={10} value={pot}
            onChange={(e) => setPot(Number(e.target.value))} className="w-full accent-emerald-600" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">Shove amount: ${shove}</label>
          <input type="range" min={10} max={400} step={10} value={shove}
            onChange={(e) => setShove(Number(e.target.value))} className="w-full accent-blue-600" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">My equity: {equity}%</label>
          <input type="range" min={5} max={55} step={1} value={equity}
            onChange={(e) => setEquity(Number(e.target.value))} className="w-full accent-amber-600" />
        </div>
      </div>
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 space-y-3">
        <div className="flex items-end justify-around pb-3 border-b border-blue-200">
          <div className="flex flex-col items-center gap-1">
            <ChipStack amount={pot} showBreakdown={false} showLabel={false} />
            <span className="text-[10px] text-gray-500 font-medium">Pot</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ChipStack amount={shove} showBreakdown={false} showLabel={false} />
            <span className="text-[10px] text-gray-500 font-medium">Your shove</span>
          </div>
        </div>
        <div className="text-xs font-mono text-blue-800 space-y-1">
          <p className="font-bold text-sm font-sans text-blue-700">Three-Step Shortcut</p>
          <p>1. Total pot after shove: ${pot} + ${shove} + ${shove} = ${totalPot + shove}</p>
          <p>2. Win when called: {equity}% × ${totalPot + shove} = ${winWhenCalled.toFixed(0)}</p>
          <p>3. Break-even fold: ${shove} ÷ ${totalPot} = {breakEvenFold}%</p>
          <p className={`text-base font-bold ${ev > 0 ? "text-emerald-700" : "text-red-600"}`}>
            Approx EV: {ev > 0 ? "+" : ""}{ev.toFixed(0)}
          </p>
        </div>
      </div>
    </div>
  );
};

const Section7: React.FC = () => (
  <div className="space-y-6">

    {/* ── Bluffing ── */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Bluffing</h3>
      <p>
        Aggression is not just a style — it's mathematically justified. Every bet has two ways to
        win: (1) villain folds immediately, or (2) your hand is best at showdown. Understanding
        both paths is essential to aggressive play.
      </p>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Bluffing Formula</p>
        <p className="text-sm text-emerald-900">
          For a pure bluff to be immediately profitable, villain must fold at least this often:
        </p>
        <p className="text-center font-mono font-bold text-lg text-emerald-800 py-1 bg-white rounded-lg border border-emerald-200">
          Break-even fold % = bet ÷ (bet + pot)
        </p>
        <p className="text-xs text-emerald-700">
          This is identical to the pot-odds formula — just from the bettor's perspective instead
          of the caller's. Bet to win the pot; fold equity must exceed the break-even threshold.
        </p>
      </div>

      {/* Table 8 */}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Table 8 — Reward:Risk Ratios and Required Fold Percentages</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Situation</th>
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Reward : Risk</th>
              <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Break-even fold</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[
              ["Pot-size raise (risking x to win 0.5x)", "0.5x : x", "67%"],
              ["½-pot raise (risking x to win 0.8x)", "0.8x : x", "55%"],
              ["Pot-size bet (risking x to win x)", "x : x", "50%"],
              ["Calling ⅔-pot bet (risking x to win 1.5x)", "1.5x : x", "40%"],
              ["Calling ½-pot bet (risking x to win 2x)", "2x : x", "33%"],
              ["Calling ⅓-pot bet (risking x to win 3x)", "3x : x", "25%"],
            ].map(([sit, ratio, fold]) => (
              <tr key={sit as string} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-xs text-gray-700">{sit}</td>
                <td className="px-4 py-2 font-mono text-gray-600">{ratio}</td>
                <td className="px-4 py-2 text-center font-bold font-mono text-emerald-700">{fold}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bg-gray-50 border-t border-gray-100 px-4 py-2">
          <p className="text-xs text-gray-500">
            The reward:risk ratio directly determines the required fold percentage. Higher reward (larger pot) = lower fold needed; higher risk (larger bet) = more folds needed.
          </p>
        </div>
      </div>
    </div>

    {/* ── Semi-bluffing ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Semi-Bluffing</h3>
      <p>
        A <strong>semi-bluff</strong> bets or raises with a drawing hand — one that has fold
        equity <em>and</em> showdown equity if called. Two ways to win makes semi-bluffs
        considerably more powerful than pure bluffs.
      </p>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Three Key Variables for Semi-Bluff Decisions</p>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-blue-900">
          <li><strong>Pot vs. stack size</strong> — how much of the remaining money are you risking?</li>
          <li><strong>Fold frequency</strong> — how often will villain fold vs. continue?</li>
          <li><strong>Showdown equity</strong> — what is your equity when called?</li>
        </ol>
        <p className="text-xs text-blue-700">
          A semi-bluff can be profitable even when villain calls often — because showdown equity
          wins a portion of called pots. This is what separates semi-bluffs from pure bluffs.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Semi-Bluff Shortcut (3 Steps for Shoves)</p>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-blue-900">
          <li>Calculate total pot after shove (dead money + shove + call)</li>
          <li>Multiply your equity by that total pot = expected win when called</li>
          <li>Compare to your shove amount to determine reward:risk</li>
        </ol>
        <div className="bg-white rounded-lg border border-blue-200 p-3 text-xs font-mono text-blue-700 space-y-0.5">
          <p className="font-bold text-sm font-sans">Example: Pot $80, shove $80, equity 35%</p>
          <p>Total pot: $80 + $80 + $80 = $240</p>
          <p>Win when called: 35% × $240 = $84</p>
          <p>Risk: $80 | Net from call: +$4 (slightly +EV even if called)</p>
          <p>Plus fold equity: whenever villain folds, win $80 immediately</p>
        </div>
      </div>
    </div>

    {/* ── Value Betting ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Value Betting</h3>
      <p>
        A <strong>value bet</strong> is a bet made because you want to be called. The decision rule
        is simple: bet for value when <em>more than 50% of villain's calling range is worse</em>{" "}
        than your hand.
      </p>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Value Bet Rules</p>
        <div className="space-y-2 text-sm text-amber-900">
          <div className="bg-white rounded-lg border border-amber-200 p-3">
            <p className="font-semibold">The 50% Rule</p>
            <p className="text-xs text-amber-700 mt-0.5">
              If {">"} 50% of hands that call you are worse, bet. If {"<"} 50% are worse, check or bet
              smaller to induce bluffs. Checking isn't passive — it denies villain a bet-fold
              and keeps weaker hands in.
            </p>
          </div>
          <div className="bg-white rounded-lg border border-amber-200 p-3">
            <p className="font-semibold">River Value vs. Check/Call</p>
            <p className="text-xs text-amber-700 mt-0.5">
              On the river, you must choose: bet for value (want calls from worse), check-call
              (expect villain to bluff), or check-fold. The 50% rule determines whether to lead.
              Against tight players who only bet strong hands, check-call is often better.
            </p>
          </div>
          <div className="bg-white rounded-lg border border-amber-200 p-3">
            <p className="font-semibold">Thin Value Bets</p>
            <p className="text-xs text-amber-700 mt-0.5">
              A "thin" value bet is one where the calling range is close to 50/50 better/worse.
              These are still correct if the math supports it, but sizing should be smaller to
              minimize losses to better hands and maximize calls from worse.
            </p>
          </div>
        </div>
      </div>
    </div>

    {/* ── Interactives ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-4">
        Bluff Break-Even Calculator
      </p>
      <BluffCalc />
    </div>

    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-4">
        Semi-Bluff Shove Analyzer
      </p>
      <SemiBluffCalc />
    </div>

    {/* ── Quiz ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-5">
        Check Your Understanding
      </p>
      <div className="space-y-7">
        <QuizQuestion
          question="Pot is $60. You bluff $60 (pot-size bet). What is the minimum fold percentage for this bluff to be immediately profitable?"
          options={[
            { label: "40%", explanation: "Break-even fold % = bet ÷ (bet + pot) = $60 ÷ $120 = 50%. Not 40%." },
            { label: "50%", explanation: "Correct! $60 ÷ ($60 + $60) = 50%. A pot-size bluff breaks even when villain folds half the time." },
            { label: "60%", explanation: "Break-even = $60 ÷ $120 = 50%, not 60%." },
            { label: "67%", explanation: "67% is needed for a pot-size raise (risking to win ½ pot). A pot-size bet break-even is 50%." },
          ]}
          correctIndex={1}
        />

        <QuizQuestion
          question="You have a flush draw (9 outs, ~36% equity) and go all-in for $100 into a $100 pot. Is this semi-bluff +EV even if villain always calls?"
          options={[
            { label: "No — if villain always calls you need 50% equity to break even", explanation: "Break-even for a pot-size bet when called = 50% equity. With 36%, this is -EV if villain never folds. But fold equity makes it +EV overall if villain sometimes folds." },
            { label: "Yes — 36% equity makes any all-in profitable", explanation: "36% equity when called = EV: (0.36 × $300) - (0.64 × $100) = $108 - $64 = +$44. Wait, that's actually positive! Pot $100 + shove $100 + call $100 = $300. 36% × $300 = $108 > $100 risk." },
            { label: "Yes — 36% × $300 total pot = $108 return vs $100 risk (slightly +EV if called)", explanation: "Correct! Total pot = $300. 36% × $300 = $108 > $100 invested. Even without fold equity this call returns +$8 on average. Add fold equity and it's clearly +EV." },
            { label: "No — semi-bluffs are only +EV when villain sometimes folds", explanation: "This specific semi-bluff is actually slightly +EV even if called: 36% × $300 = $108 > $100. That's the power of the semi-bluff." },
          ]}
          correctIndex={2}
        />

        <QuizQuestion
          question="On the river, you have top pair. You estimate villain calls with 65% worse hands and 35% better hands. Should you bet for value?"
          options={[
            { label: "No — 35% of calls beat you, so risk is too high", explanation: "65% of calling hands are worse than yours — well above the 50% threshold. Betting is clearly correct for value." },
            { label: "Yes — 65% of calling hands are worse than yours; the 50% rule says bet", explanation: "Correct! More than 50% of hands that call are worse → value bet is profitable on average. 65% > 50% threshold." },
            { label: "Only if you have top pair top kicker", explanation: "The 50% rule doesn't depend on hand strength in isolation — it depends on what villain's calling range looks like. 65% worse hands = clear value bet regardless of kicker." },
            { label: "Depends on pot size", explanation: "The value bet decision (bet vs check) is driven by the 50% rule, not pot size. Pot size influences sizing, not whether to bet." },
          ]}
          correctIndex={1}
        />
      </div>
    </div>
  </div>
);

export default Section7;
