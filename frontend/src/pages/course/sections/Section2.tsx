import React, { useState } from "react";
import QuizQuestion from "../components/QuizQuestion";
import ChipStack from "@/components/ChipStack";

/* ── Bet-sizing drill ── */
const BET_FRACTIONS = [
  { label: "¼ pot", pct: "25%", value: 0.25 },
  { label: "⅓ pot", pct: "33%", value: 0.333 },
  { label: "½ pot", pct: "50%", value: 0.5 },
  { label: "⅔ pot", pct: "67%", value: 0.667 },
  { label: "¾ pot", pct: "75%", value: 0.75 },
  { label: "Pot", pct: "100%", value: 1.0 },
  { label: "2× pot", pct: "200%", value: 2.0 },
];

const BetSizingDrill: React.FC = () => {
  const [selected, setSelected] = useState<number | null>(null);
  const pot = 100;
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-800">
        Practice: the pot is <strong>${pot}</strong>. Click a sizing to see the exact dollar amount.
      </p>
      <div className="flex flex-wrap gap-2">
        {BET_FRACTIONS.map((f, i) => (
          <button
            key={i}
            onClick={() => setSelected(selected === i ? null : i)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              selected === i
                ? "bg-emerald-600 border-emerald-600 text-white"
                : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-emerald-50 hover:border-emerald-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {selected !== null && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-end gap-4">
          <ChipStack
            amount={Math.round(pot * BET_FRACTIONS[selected].value)}
            showBreakdown={false}
            showLabel={false}
          />
          <div>
            <p className="text-sm text-emerald-800">
              <span className="font-bold">{BET_FRACTIONS[selected].label}</span> of a ${pot} pot ={" "}
              <span className="font-bold text-lg text-emerald-700">
                ${(pot * BET_FRACTIONS[selected].value).toFixed(0)}
              </span>
            </p>
            <p className="text-xs text-emerald-600 mt-0.5 font-mono">
              ${pot} × {BET_FRACTIONS[selected].pct} = ${(pot * BET_FRACTIONS[selected].value).toFixed(0)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Pot-size raise calculator ── */
const PotRaiseCalc: React.FC = () => {
  const [pot, setPot] = useState(100);
  const [bet, setBet] = useState(50);
  const step1 = bet * 2;
  const step2 = step1 + (pot + bet);
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-gray-800">
        Pot-size raise calculator — adjust pot and villain's bet:
      </p>
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">Dead money (pot before bet): ${pot}</label>
          <input type="range" min={0} max={500} step={5} value={pot}
            onChange={(e) => setPot(Number(e.target.value))} className="w-full accent-emerald-600" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">Villain's bet: ${bet}</label>
          <input type="range" min={5} max={300} step={5} value={bet}
            onChange={(e) => setBet(Number(e.target.value))} className="w-full accent-blue-600" />
        </div>
      </div>
      <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-3">
        <p className="font-bold text-sm text-emerald-700">Two-step calculation:</p>
        <div className="flex items-end justify-around pb-3 border-b border-emerald-200">
          <div className="flex flex-col items-center gap-1">
            <ChipStack amount={pot || 5} showBreakdown={false} showLabel={false} />
            <span className="text-[10px] text-gray-500 font-medium">Dead pot</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ChipStack amount={bet} showBreakdown={false} showLabel={false} />
            <span className="text-[10px] text-gray-500 font-medium">Villain bet</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ChipStack amount={step2} showBreakdown={false} showLabel={false} />
            <span className="text-[10px] text-gray-500 font-medium">Your raise</span>
          </div>
        </div>
        <div className="font-mono text-xs text-emerald-800 space-y-1">
          <p>Step 1: call × 2 = ${bet} × 2 = <strong>${step1}</strong></p>
          <p>Step 2: ${step1} + (pot ${pot} + bet ${bet}) = ${step1} + ${pot + bet}</p>
          <p className="text-base font-bold text-emerald-700">= ${step2} total raise</p>
        </div>
      </div>
    </div>
  );
};

/* ── Hourly earn calculator ── */
const HourlyEarnCalc: React.FC = () => {
  const [handsPerHour, setHandsPerHour] = useState(100);
  const [bigBlind, setBigBlind] = useState(0.10);
  const [winRate, setWinRate] = useState(5);
  const hourly = (handsPerHour / 100) * bigBlind * winRate;
  const bbOptions = [
    { label: "NL10 ($0.10)", value: 0.10 },
    { label: "NL25 ($0.25)", value: 0.25 },
    { label: "NL50 ($0.50)", value: 0.50 },
    { label: "NL100 ($1.00)", value: 1.00 },
    { label: "NL200 ($2.00)", value: 2.00 },
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-800">
        Hourly earn calculator:
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">Hands/hour</label>
          <input type="range" min={50} max={600} step={50} value={handsPerHour}
            onChange={(e) => setHandsPerHour(Number(e.target.value))} className="w-full accent-emerald-600" />
          <p className="text-xs text-gray-500 text-center">{handsPerHour}</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">Game</label>
          <select value={bigBlind} onChange={(e) => setBigBlind(Number(e.target.value))}
            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
            {bbOptions.map(o => <option key={o.label} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">Win rate (bb/100)</label>
          <input type="range" min={-5} max={15} step={0.5} value={winRate}
            onChange={(e) => setWinRate(Number(e.target.value))} className="w-full accent-blue-600" />
          <p className="text-xs text-gray-500 text-center">{winRate}</p>
        </div>
      </div>
      <div className={`rounded-lg border px-4 py-3 text-center ${hourly > 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
        <p className="text-xs text-gray-500">Hourly earn</p>
        <p className={`text-2xl font-bold ${hourly > 0 ? "text-emerald-700" : "text-red-600"}`}>
          {hourly >= 0 ? "+" : ""}${hourly.toFixed(2)}/hr
        </p>
        <p className="text-xs text-gray-400 mt-0.5 font-mono">
          ({handsPerHour}/100) × ${bigBlind} × {winRate} = {hourly.toFixed(2)}
        </p>
      </div>
    </div>
  );
};

const Section2: React.FC = () => (
  <div className="space-y-6">

    {/* ── Part 1: Your Surroundings ── */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Your Surroundings</h3>
      <p>
        Most measurements in no-limit hold'em are based on the <strong>big blind (bb)</strong>.
        The amount of chips a player has in front of them is their <strong>stack</strong>. Stack
        sizes are described in multiples of the big blind.
      </p>

      {/* Table 1 */}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Table 1 — Common Stack Size Descriptions</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Times the BB</th>
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[["1 – 40", "Short Stack"], ["41 – 80", "Medium Stack"], ["81 – 100+", "Deep Stack"]].map(([range, desc]) => (
              <tr key={range} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-gray-700">{range}</td>
                <td className="px-4 py-2 font-semibold text-gray-800">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        The <strong>effective stack</strong> for a hand is the <em>smallest</em> stack involved.
        If you have $200 but your opponent has $50, the effective stack is $50 — that's the maximum
        that can be wagered. Always mention effective stack size when discussing a hand.
      </p>

      <p>
        Swings (upswings and downswings) are measured in <strong>buy-ins</strong>. A 7–10 buy-in
        downswing is common for professional players. Some have experienced 40 buy-in downswings.
        This leads to the concept of <strong>bankroll management</strong>. A bankroll isn't the same
        as a budget — it's for a <em>winning</em> player. General guidelines:
      </p>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Bankroll Guidelines</p>
        <ul className="list-disc list-inside space-y-1 text-sm text-amber-900">
          <li><strong>Amateur:</strong> at least 30 buy-ins for your game</li>
          <li><strong>Going pro:</strong> at least 100 buy-ins + 6–12 months of living expenses</li>
          <li>If you drop below your buy-in threshold, <strong>move down in stakes</strong></li>
          <li>"If you don't stress your bankroll, it will stress you!"</li>
        </ul>
      </div>

      <p>
        <strong>Win rates</strong> are measured in <em>bb/100</em> — big blinds won per 100 hands
        played. Note: <strong>bb</strong> (lowercase) = big blind; <strong>BB</strong> (uppercase) =
        big bet, which is <em>twice</em> the big blind (1 BB/100 = 2 bb/100).
      </p>

      {/* Table 2 */}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Table 2 — Win Rate Descriptions</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">bb/100</th>
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[["0 – 4", "Marginal winner"], ["4 – 7", "Nice win rate"], ["7+", "Crushing the game"]].map(([range, desc]) => (
              <tr key={range} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-gray-700">{range}</td>
                <td className="px-4 py-2 text-gray-800">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 italic">
        Note: Online micro-stakes games have high rake — often accounting for 10 bb/100 of your earn.
        Breaking even over 10,000 hands of micro-stakes is actually beating the game at ~10 bb/100.
      </p>
    </div>

    {/* ── Part 2: Thinking About Bets ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Thinking About Bets in No-Limit Hold'em</h3>
      <p>
        Good NLHE players <em>never</em> think about bets in absolute dollar amounts. A $100 bet
        tells you nothing on its own — if the pot is $1,000 it's tiny; if the pot is $5 it's
        enormous. Bets are always expressed as a <strong>fraction of the pot</strong>.
      </p>

      {/* Table 3 style */}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Table 3 — Bet Sizing Terminology (into a $100 pot)</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Dollar Amount</th>
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Understood As</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[["$25","¼ pot bet"],["$33","⅓ pot bet"],["$50","½ pot bet"],["$66","⅔ pot bet"],
              ["$75","¾ pot bet"],["$100","Pot bet"],["$200","2× pot bet"]].map(([amt, label]) => (
              <tr key={amt} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono font-bold text-gray-800">{amt}</td>
                <td className="px-4 py-2 text-gray-700">{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Pot-Size Raise — Two-Step Formula</p>
        <p className="text-sm text-emerald-900">
          The <strong>min-raise</strong> is simply double the villain's bet. The{" "}
          <strong>pot-size raise</strong> requires two steps:
        </p>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-emerald-900">
          <li>Take the amount you must call and <strong>double it</strong></li>
          <li>Add the result to the size of the pot <em>(including villain's bet)</em></li>
        </ol>
        <div className="bg-white rounded-lg border border-emerald-200 p-3 text-xs font-mono text-emerald-800 space-y-0.5">
          <p className="font-bold text-sm font-sans text-emerald-700">Example: Pot $100, villain bets $50</p>
          <p>Step 1: $50 × 2 = $100</p>
          <p>Step 2: $100 + ($100 + $50) = $100 + $150 = <strong>$250 total</strong></p>
        </div>
        <p className="text-xs text-emerald-600">
          Why it works: if you called $50, the pot becomes $200. To then raise pot-size ($200) you'd
          bet $200 more. $50 + $200 = $250. Both methods give the same answer.
        </p>
      </div>
    </div>

    {/* ── Part 3: Your Expectations ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Your Expectations</h3>
      <p>
        To calculate your expected earnings, you need four pieces of information:
      </p>
      <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
        <li>Hands played per hour</li>
        <li>Hours played</li>
        <li>Size of the big blind</li>
        <li>Your estimated win rate (bb/100)</li>
      </ol>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Formula</p>
        <div className="text-xs font-mono text-blue-900 space-y-0.5">
          <p>1. hands/hour × hours played = total hands</p>
          <p>2. total hands ÷ 100 = 100-hand sections</p>
          <p>3. big blind size × bb/100 = money per 100-hand section</p>
          <p>4. sections × money per section = total earnings</p>
        </div>
        <div className="bg-white rounded-lg border border-blue-200 p-3 text-xs font-mono text-blue-800 space-y-0.5 mt-2">
          <p className="font-bold text-sm font-sans text-blue-700">Example: 4 tables of NL10 online, 30 hrs/wk, 7 bb/100</p>
          <p>1. 400 × 30 = 12,000 total hands</p>
          <p>2. 12,000 ÷ 100 = 120 sections</p>
          <p>3. $0.10 × 7 = $0.70 per section</p>
          <p>4. 120 × $0.70 = <strong>$84/week</strong></p>
        </div>
        <p className="text-xs text-blue-600 mt-1">
          The take-away: micro-stakes earnings are very modest. Treat those stakes as a{" "}
          <strong>stepping stone</strong> — pay for your education cheaply before moving up.
        </p>
      </div>
    </div>

    {/* Interactives */}
    <div className="border-t border-gray-200 pt-5">
      <BetSizingDrill />
    </div>
    <div className="border-t border-gray-200 pt-5">
      <PotRaiseCalc />
    </div>
    <div className="border-t border-gray-200 pt-5">
      <HourlyEarnCalc />
    </div>

    {/* Quiz */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-5">
        Check Your Understanding
      </p>
      <div className="space-y-7">
        <QuizQuestion
          question="What is an 80BB stack in a NL25 ($0.10/$0.25) game?"
          options={[
            { label: "$10", explanation: "80BB the big blind: $0.25 × 80 = $20, not $10." },
            { label: "$20", explanation: "Correct! Big blind = $0.25. $0.25 × 80 = $20." },
            { label: "$40", explanation: "That would be 80× the $0.50 big blind in NL50. Here BB = $0.25, so 80× = $20." },
            { label: "$50", explanation: "80× the big blind: $0.25 × 80 = $20." },
          ]}
          correctIndex={1}
        />

        <QuizQuestion
          question="If you wanted a 40 buy-in bankroll for NL50 ($0.25/$0.50), how much money do you need?"
          options={[
            { label: "$1,000", explanation: "A standard buy-in at NL50 is $50 (100× the BB). $50 × 40 = $2,000." },
            { label: "$1,500", explanation: "NL50 buy-in = $50. $50 × 40 = $2,000." },
            { label: "$2,000", explanation: "Correct! NL50 standard buy-in = $50. 40 buy-ins = 40 × $50 = $2,000." },
            { label: "$2,500", explanation: "NL50 buy-in = $50 (not $62.50). $50 × 40 = $2,000." },
          ]}
          correctIndex={2}
        />

        <QuizQuestion
          question="The pot is $80 and villain bets $50. How much do you put in to make a pot-size raise?"
          options={[
            { label: "$130", explanation: "Formula: (call × 2) + (pot + bet) = ($50 × 2) + ($80 + $50) = $100 + $130 = $230." },
            { label: "$180", explanation: "Formula: ($50 × 2) + ($80 + $50) = $100 + $130 = $230." },
            { label: "$230", explanation: "Correct! Step 1: $50 × 2 = $100. Step 2: $100 + ($80 + $50) = $100 + $130 = $230." },
            { label: "$290", explanation: "Formula: ($50 × 2) + ($80 + $50) = $100 + $130 = $230, not $290." },
          ]}
          correctIndex={2}
        />
      </div>
    </div>
  </div>
);

export default Section2;
