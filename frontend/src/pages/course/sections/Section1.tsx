import React, { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import QuizQuestion from "../components/QuizQuestion";

/* EV per flip: 0.50 × $6 + 0.50 × (−$5) = +$0.50 */
const FLIP_EV = 0.5;

type Pt = { flip: number; ev: number; real: number };

const ChartTip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm text-xs space-y-0.5">
      <p className="font-semibold text-gray-600 mb-1">Flip {label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <strong>${p.value.toFixed(2)}</strong>
        </p>
      ))}
    </div>
  );
};

const CoinSimulator: React.FC = () => {
  const [data, setData] = useState<Pt[]>([{ flip: 0, ev: 0, real: 0 }]);
  const [profit, setProfit] = useState(0);
  const [n, setN] = useState(0);
  const [lastResult, setLastResult] = useState<"heads" | "tails" | null>(null);

  const handleFlip = () => {
    const heads = Math.random() < 0.5;
    const gain = heads ? 6 : -5;
    const newN = n + 1;
    const newProfit = profit + gain;
    setLastResult(heads ? "heads" : "tails");
    setN(newN);
    setProfit(newProfit);
    setData(prev => [
      ...prev,
      {
        flip: newN,
        ev: Math.round(newN * FLIP_EV * 100) / 100,
        real: newProfit,
      },
    ]);
  };

  const handleReset = () => {
    setData([{ flip: 0, ev: 0, real: 0 }]);
    setProfit(0);
    setN(0);
    setLastResult(null);
  };

  const evProfit = n * FLIP_EV;
  const diff = profit - evProfit;

  return (
    <div className="space-y-5 rounded-xl border border-emerald-200/60 bg-emerald-50/30 p-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-700 mb-2">
          Coin Flip Simulator — Heads +$6, Tails −$5
        </p>
        <p className="text-xs text-gray-600 leading-relaxed">
          This is a fair 50/50 coin — but because heads pays more than tails costs, every flip is
          worth{" "}
          <strong className="text-emerald-700">+$0.50 on average</strong>. Flip to watch your
          real results chase the EV line over time.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleFlip}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 active:scale-95 transition-all shadow-sm"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M12 7v5l3 3" />
          </svg>
          Flip Coin
        </button>

        {lastResult && (
          <span
            className={`inline-flex items-center px-3 py-1 rounded-lg border text-sm font-bold ${
              lastResult === "heads"
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            {lastResult === "heads" ? "Heads — +$6" : "Tails — −$5"}
          </span>
        )}

        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Flips:</span>
          <span className="font-bold text-gray-800 tabular-nums w-8">{n}</span>
        </div>

        {n > 0 && (
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-100 transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {n > 0 && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-center">
            <p className="text-emerald-600 font-semibold">EV profit</p>
            <p className="text-emerald-800 font-bold text-base tabular-nums">
              ${evProfit.toFixed(2)}
            </p>
            <p className="text-emerald-500">expected</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-center">
            <p className="text-blue-600 font-semibold">Actual profit</p>
            <p className={`font-bold text-base tabular-nums ${profit >= 0 ? "text-blue-800" : "text-red-700"}`}>
              {profit >= 0 ? "+" : ""}${profit.toFixed(2)}
            </p>
            <p className="text-blue-500">real results</p>
          </div>
          <div className={`rounded-lg border bg-white px-3 py-2 text-center ${diff >= 0 ? "border-emerald-200" : "border-red-200"}`}>
            <p className={`font-semibold ${diff >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {diff >= 0 ? "Running good" : "Running bad"}
            </p>
            <p className={`font-bold text-base tabular-nums ${diff >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {diff >= 0 ? "+" : ""}${diff.toFixed(2)}
            </p>
            <p className={`${diff >= 0 ? "text-emerald-500" : "text-red-400"}`}>vs EV</p>
          </div>
        </div>
      )}

      {data.length > 1 && (
        <div className="rounded-xl border border-gray-200 bg-white p-3 pt-4">
          <p className="text-xs font-bold text-gray-600 mb-3 text-center">
            Cumulative Profit — EV (expected) vs Actual
          </p>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="flip"
                type="number"
                domain={[0, "dataMax"]}
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${v}`}
                label={{
                  value: "$ Profit",
                  angle: -90,
                  position: "insideLeft",
                  offset: 5,
                  fontSize: 10,
                  fill: "#9ca3af",
                }}
              />
              <Tooltip content={<ChartTip />} />
              <Legend
                verticalAlign="top"
                wrapperStyle={{ fontSize: 11, paddingBottom: 6 }}
                iconType="line"
              />
              <Line
                type="monotone"
                dataKey="ev"
                name="EV (expected profit)"
                stroke="#10b981"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="real"
                name="Actual profit"
                stroke="#3b82f6"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-400 text-center mt-0">Number of flips</p>
          <p className="text-xs text-gray-400 text-center mt-1">
            {n < 20
              ? "Keep flipping — the lines converge as the sample grows."
              : n < 60
              ? "The real line is stabilizing around the EV line."
              : "Over many flips, actual results track the EV line closely."}
          </p>
        </div>
      )}
    </div>
  );
};

const Section1: React.FC = () => (
  <div className="space-y-6">
    {/* Explanation */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <p>
        Poker is a game of incomplete information. You never know exactly what cards your opponents
        hold, which means every decision is made under uncertainty. As you play more, you'll certianly
        get better at having an idea of what hands people are playing, but overall, this should be the cherry on top,
        not the cake itself. Having some <em> simple</em> math in your back pocket can seriously help a lot.
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
            <strong>Make the best mathematical decisions</strong>
          </li>
        </ol>
      </div>

      <p>
        The idea of winning poker in the long run is that you'll attempt to get into situations over and
        over where you're the one with the equity lead on average. About an equal amount of the time you'll win
        with your AA vs their KK as the time they have KK and you have AA. The real edge/skill in the game is in the
        <em>medium-strength hands</em> - that's the difficult part of playing the game. Having some fundamental math
        in your back pocket will leave you in a situation where you're not second guessing your feelings, though
        admittedly, there are going to be times where the decision is fairly close. With some basic math,
        you don't have to beat yourself up too much for bad decisions, because you know in the long run your decision
        was at least <em>decent</em>. A goal of yours should be to play in games where you SEE OTHERS making 
        clearly bad mathematical decisions (for example straddling, calling preflop instead of 3betting hands like AK,
        or raising/playing 70% of hands).
      </p>

      <p>
        Consider a simple analogy: imagine a fair coin — exactly 50/50. Heads, you win $6. Tails,
        you lose $5. Should you flip? Most people shrug. But math gives you a clear answer: half
        the time you win $6, half the time you lose $5, so on average each flip earns you $0.50.
        You should always flip, even though you'll lose half the time. Poker can work the same way —
        you won't win every hand, but making the right decision every time adds up.
      </p>

      <p>
        The good news: the math in poker isn't complicated. You won't need algebra or calculus.
        Most of it comes down to basic addition, subtraction, multiplication, and division.
      </p>

      <p>
        A player who makes <em>worse</em> assumptions but <em>better</em> decisions can still
        outperform a player who has <em>better</em> assumptions but makes <em>worse</em> decisions.
        Both keys matter, and they work together. The goal of this course is to sharpen both.
      </p>
    </div>

    {/* Coin Simulator */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-3">
        See It For Yourself — The Coin Flip
      </p>
      <p className="text-sm text-gray-600 mb-4 leading-relaxed">
        The chart below shows the key lesson: in the short run, real results bounce around wildly.
        In the long run, they converge toward the expected profit line. This is exactly what happens
        at the poker table — individual hands are noisy, but the math wins over time.
      </p>
      <CoinSimulator />
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
