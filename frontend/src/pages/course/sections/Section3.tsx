import React, { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import CardRow from "@/components/CardRow";
import QuizQuestion from "../components/QuizQuestion";

/* ═══════════════════════════════════════════════════════════
   HAND EVALUATOR  (module-level — runs in main thread)
   ═══════════════════════════════════════════════════════════ */
const RANK_VAL: Record<string, number> = {
  A: 14, K: 13, Q: 12, J: 11, T: 10,
  "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2,
};
type HCard = { rank: number; suit: string };
const pc = (s: string): HCard => ({ rank: RANK_VAL[s[0]], suit: s[1] });

/** Evaluate a 5-card hand. Returns [category, ...tiebreakers], higher = better.
 *  8=SF  7=Quads  6=FH  5=Flush  4=Straight  3=Trips  2=TwoPair  1=Pair  0=High */
function evalFive(cs: HCard[]): number[] {
  const r = cs.map(c => c.rank).sort((a, b) => b - a);
  const flush = cs.every(c => c.suit === cs[0].suit);
  const u = [...new Set(r)];
  let sh = -1;
  if (u.length === 5) {
    if (u[0] - u[4] === 4) sh = u[0];                          // normal straight
    else if (u[0] === 14 && u[1] === 5) sh = 5;                // wheel A-2-3-4-5
  }
  const cnt: Record<number, number> = {};
  r.forEach(x => { cnt[x] = (cnt[x] || 0) + 1; });
  const g = Object.entries(cnt)
    .map(([x, c]) => [+x, c] as [number, number])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const [g0r, g0c] = g[0];
  const g1c = g[1]?.[1] ?? 0, g1r = g[1]?.[0] ?? 0;
  if (flush && sh > 0) return [8, sh];
  if (g0c === 4) return [7, g0r, g1r];
  if (g0c === 3 && g1c >= 2) return [6, g0r, g1r];
  if (flush) return [5, ...r];
  if (sh > 0) return [4, sh];
  if (g0c === 3) return [3, g0r, ...g.slice(1).map(x => x[0])];
  if (g0c === 2 && g1c === 2) return [2, g0r, g1r, g.find(x => x[1] === 1)?.[0] ?? 0];
  if (g0c === 2) return [1, g0r, ...g.slice(1).map(x => x[0])];
  return [0, ...r];
}

function cmpVal(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Best 5-card hand from 7 cards (try all C(7,2)=21 five-card subsets). */
function best7(boardStrs: string[], holeStrs: string[]): number[] {
  const all = [...boardStrs, ...holeStrs].map(pc);
  let best: number[] = [-1];
  for (let i = 0; i < 7; i++)
    for (let j = i + 1; j < 7; j++) {
      const v = evalFive(all.filter((_, k) => k !== i && k !== j));
      if (cmpVal(v, best) > 0) best = v;
    }
  return best;
}

/* Fixed hole cards */
const AK_HOLE = ["As", "Kd"];
const QQ_HOLE = ["Qh", "Qc"];

/* Available deck: 52 cards minus the 4 hole cards */
const _USED = new Set([...AK_HOLE, ...QQ_HOLE]);
const AVAIL = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"]
  .flatMap(r => ["s","h","d","c"].map(s => r + s))
  .filter(c => !_USED.has(c));  // 48 cards

function dealBoard(): string[] {
  const d = [...AVAIL];
  for (let i = 0; i < 5; i++) {
    const j = i + Math.floor(Math.random() * (d.length - i));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d.slice(0, 5);
}

/** Returns 1 if QQ wins, -1 if AK wins, 0 if split. */
function outcome(board: string[]): 1 | -1 | 0 {
  const d = cmpVal(best7(board, QQ_HOLE), best7(board, AK_HOLE));
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

/* QQ's true equity vs AKo with these exact cards (~56.3%) */
const QQ_EV = 0.563;
/* Expected $ profit per deal for QQ in a $100 all-in (win +$100, lose -$100) */
const QQ_EV_PROFIT = (QQ_EV * 2 - 1) * 100; // ≈ +$12.60

/* ═══════════════════════════════════════════════════════════
   CHART TYPES & TOOLTIP
   ═══════════════════════════════════════════════════════════ */
type Pt = { deal: number; ev: number; real: number };

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
      <p className="font-semibold text-gray-600 mb-1">Deal {label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <strong>${p.value.toFixed(2)}</strong>
        </p>
      ))}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   EV SIMULATOR
   ═══════════════════════════════════════════════════════════ */
const HAND_NAMES: Record<string, string> = {
  "8": "Straight Flush", "7": "Four of a Kind", "6": "Full House",
  "5": "Flush", "4": "Straight", "3": "Three of a Kind",
  "2": "Two Pair", "1": "Pair", "0": "High Card",
};

function handName(val: number[]): string {
  return HAND_NAMES[String(val[0])] ?? "Unknown";
}

const EVSimulator: React.FC = () => {
  const [board, setBoard] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<1 | -1 | 0 | null>(null);
  const [lastHands, setLastHands] = useState<{ qq: string; ak: string } | null>(null);
  const [data, setData] = useState<Pt[]>([{ deal: 0, ev: 0, real: 0 }]);
  const [profit, setProfit] = useState(0);
  const [n, setN] = useState(0);

  const handleDeal = () => {
    const b = dealBoard();
    const r = outcome(b);
    const qqVal = best7(b, QQ_HOLE);
    const akVal = best7(b, AK_HOLE);
    const newN = n + 1;
    const gain = r === 1 ? 100 : r === -1 ? -100 : 0;
    const newProfit = profit + gain;
    setBoard(b);
    setLastResult(r);
    setLastHands({ qq: handName(qqVal), ak: handName(akVal) });
    setN(newN);
    setProfit(newProfit);
    setData(prev => [
      ...prev,
      {
        deal: newN,
        ev: Math.round(newN * QQ_EV_PROFIT * 100) / 100,
        real: newProfit,
      },
    ]);
  };

  const handleReset = () => {
    setBoard([]); setLastResult(null); setLastHands(null);
    setData([{ deal: 0, ev: 0, real: 0 }]);
    setProfit(0); setN(0);
  };

  const resultStyle =
    lastResult === 1
      ? { badge: "bg-emerald-50 border-emerald-200 text-emerald-700", text: "QQ wins!" }
      : lastResult === -1
      ? { badge: "bg-red-50 border-red-200 text-red-700", text: "AK wins!" }
      : lastResult === 0
      ? { badge: "bg-gray-50 border-gray-200 text-gray-600", text: "Split pot" }
      : null;

  const evProfit = n * QQ_EV_PROFIT;
  const diff = profit - evProfit;

  return (
    <div className="space-y-5 rounded-xl border border-emerald-200/60 bg-emerald-50/30 p-4">
      {/* Header */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-700 mb-2">
          EV Simulator — QQ vs AK Preflop All-In
        </p>
        <p className="text-xs text-gray-600 leading-relaxed">
          QQ is a{" "}
          <strong className="text-emerald-700">~{Math.round(QQ_EV * 100)}% favorite</strong>{" "}
          vs AKo going in. Deal complete boards to watch real results converge toward the EV line
          over time. This is the law of large numbers in action.
        </p>
      </div>

      {/* Hands display */}
      <div className="flex flex-wrap gap-6 items-center">
        <div className="text-center space-y-1">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            AK ({Math.round((1 - QQ_EV) * 100)}% EV)
          </p>
          <CardRow cardsStr="As Kd" size="sm" />
        </div>
        <p className="text-gray-400 font-semibold text-sm">vs</p>
        <div className="text-center space-y-1">
          <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide">
            QQ ({Math.round(QQ_EV * 100)}% EV — tracked)
          </p>
          <CardRow cardsStr="Qh Qc" size="sm" />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleDeal}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 active:scale-95 transition-all shadow-sm"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Deal Board
        </button>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Deals:</span>
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

      {/* Board + result */}
      {board.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Board</p>
          <CardRow cardsStr={board.join(" ")} size="sm" />
          {resultStyle && lastHands && (
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className={`inline-flex items-center px-3 py-1 rounded-lg border text-sm font-bold ${resultStyle.badge}`}>
                {resultStyle.text}
              </span>
              <span className="text-xs text-gray-500">
                QQ: <em>{lastHands.qq}</em> &nbsp;·&nbsp; AK: <em>{lastHands.ak}</em>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Stats row */}
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
            <p className="text-blue-500">$100 buy-in</p>
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

      {/* Line chart */}
      {data.length > 1 && (
        <div className="rounded-xl border border-gray-200 bg-white p-3 pt-4">
          <p className="text-xs font-bold text-gray-600 mb-3 text-center">
            QQ Cumulative Wins — EV (expected) vs Actual
          </p>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="deal"
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
          <p className="text-xs text-gray-400 text-center mt-0">
            Number of deals
          </p>
          <p className="text-xs text-gray-400 text-center mt-1">
            {n < 20
              ? "Keep dealing — the lines converge as the sample grows."
              : n < 60
              ? "The real line is stabilizing around the EV line."
              : "Over many deals, the actual results track the EV line closely."}
          </p>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   CONVERSION TABLE
   ═══════════════════════════════════════════════════════════ */
const CONV_ROWS = [
  { frac: "1/2", pct: "50%", ratio: "1:1" },
  { frac: "1/3", pct: "33.3%", ratio: "2:1" },
  { frac: "1/4", pct: "25%", ratio: "3:1" },
  { frac: "1/5", pct: "20%", ratio: "4:1" },
  { frac: "1/6", pct: "16.7%", ratio: "5:1" },
  { frac: "2/5", pct: "40%", ratio: "3:2" },
  { frac: "3/8", pct: "37.5%", ratio: "5:3" },
];

const ConversionTable: React.FC = () => (
  <div className="overflow-hidden rounded-xl border border-gray-200">
    <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-600">
        Fraction ↔ Percentage ↔ Ratio — Quick Reference
      </p>
    </div>
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-100">
          <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Fraction</th>
          <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Percentage</th>
          <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Odds (against:for)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {CONV_ROWS.map(({ frac, pct, ratio }) => (
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

/* ═══════════════════════════════════════════════════════════
   EV STEP-BY-STEP WORKTHROUGH
   ═══════════════════════════════════════════════════════════ */
const EV_STEPS = [
  {
    label: "Step 1 — Identify every possible outcome and its probability",
    content: ["Villain folds: probability 60%", "Villain calls (you lose): probability 40%"],
    cls: "bg-blue-50 border-blue-200 text-blue-800",
  },
  {
    label: "Step 2 — Multiply probability × result for each outcome",
    content: ["Fold: 0.60 × +$60 (win the pot) = +$36", "Call: 0.40 × −$40 (lose your bet) = −$16"],
    cls: "bg-amber-50 border-amber-200 text-amber-800",
  },
  {
    label: "Step 3 — Sum all results to get EV",
    content: ["+$36 + (−$16) = +$20", "EV of this bluff = +$20 per attempt"],
    cls: "bg-emerald-50 border-emerald-200 text-emerald-800",
  },
];

const EVWorkthrough: React.FC = () => {
  const [step, setStep] = useState(0);
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-gray-500">
        Scenario: Pot is $60. You bluff $40. Villain folds 60% of the time.
      </p>
      {EV_STEPS.slice(0, step + 1).map((s, i) => (
        <div key={i} className={`rounded-lg border px-4 py-3 space-y-1.5 ${s.cls}`}>
          <p className="text-xs font-bold">{s.label}</p>
          {s.content.map((line, j) => <p key={j} className="text-sm font-mono">{line}</p>)}
        </div>
      ))}
      <div className="flex gap-2">
        {step < EV_STEPS.length - 1 ? (
          <button
            onClick={() => setStep(step + 1)}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            Show Step {step + 2}
          </button>
        ) : (
          <button
            onClick={() => setStep(0)}
            className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   SECTION 3 MAIN
   ═══════════════════════════════════════════════════════════ */
const Section3: React.FC = () => (
  <div className="space-y-6">

    {/* ── Part 1: Fractions, Percentages, Ratios ── */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Fractions, Percentages and Ratios</h3>
      <p>
        Every probability in poker can be stated three ways. You'll encounter all three in
        real play — pot odds quoted as ratios, equity shown as percentages, outs expressed as
        fractions. Fluent conversion between them is not optional.
      </p>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">The Three Forms</p>
        <div className="space-y-2">
          <div className="bg-white rounded-lg border border-blue-200 p-3">
            <p className="font-semibold text-sm text-blue-900">Fraction (n/d)</p>
            <p className="text-xs text-blue-700 mt-1">
              Numerator = favorable outcomes; denominator = total outcomes.
              Convert to percentage: divide top by bottom, multiply by 100.
              <span className="font-mono ml-1">1/4 → 0.25 → 25%</span>
            </p>
          </div>
          <div className="bg-white rounded-lg border border-blue-200 p-3">
            <p className="font-semibold text-sm text-blue-900">Percentage (%)</p>
            <p className="text-xs text-blue-700 mt-1">
              Easiest for comparing two probabilities. To convert back to fraction: divide by 100.
              <span className="font-mono ml-1">36% → 36/100 → 9/25</span>
            </p>
          </div>
          <div className="bg-white rounded-lg border border-blue-200 p-3">
            <p className="font-semibold text-sm text-blue-900">Ratio (m:n — "against : for")</p>
            <p className="text-xs text-blue-700 mt-1">
              The number of losing outcomes versus winning outcomes. To convert to fraction:
              <span className="font-mono ml-1">m:n → n/(m+n)</span>.
              To convert fraction to ratio: losses = denom − numer, so
              <span className="font-mono ml-1">1/4 → (4−1):1 = 3:1</span>.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
          The Doors Warning — 5:1 ≠ 1/5
        </p>
        <p className="text-sm text-amber-900">
          The Doors song "Five to One" (5:1 ratio) is NOT a 20% probability. A 5:1 ratio means
          five losses for every one win:{" "}
          <span className="font-mono font-bold">5:1 → 1/(5+1) = 1/6 ≈ 16.7%</span>.
          This trap catches a lot of players. Always apply <span className="font-mono">m:n → n/(m+n)</span>{" "}
          before doing any arithmetic with ratios.
        </p>
        <div className="bg-white rounded-lg border border-amber-200 p-2 text-xs font-mono text-amber-800 space-y-0.5">
          <p>5:1 → 1/(5+1) = 1/6 = 16.7%  ✓</p>
          <p>5:1 → 1/5 = 20%  ✗  (The Doors trap)</p>
          <p>3:1 → 1/(3+1) = 1/4 = 25%  ✓</p>
          <p>2:1 → 1/(2+1) = 1/3 = 33.3%  ✓</p>
        </div>
      </div>

      <ConversionTable />

      <p className="text-xs text-gray-500 leading-relaxed">
        Memorize the fraction/percentage pairs in the table above. Pot odds are often given as
        ratios, but break-even equity is a percentage — you'll convert between them constantly.
        The table above covers the most important values you'll see at the table.
      </p>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Practice Conversions</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono text-gray-700">
          <p>Fraction 3/10 → <strong>30%</strong>, ratio <strong>7:3</strong></p>
          <p>Ratio 7:1 → fraction <strong>1/8</strong> → <strong>12.5%</strong></p>
          <p>Percentage 20% → fraction <strong>1/5</strong> → ratio <strong>4:1</strong></p>
          <p>Ratio 4:3 → fraction <strong>3/7</strong> → <strong>42.9%</strong></p>
        </div>
      </div>
    </div>

    {/* ── Part 2: Expectation Value ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Expectation Value (EV)</h3>

      <p>
        <strong>Expectation value</strong> is the average result of a decision if you made it
        an infinite number of times. It's the cornerstone of every mathematical poker concept
        that follows.
      </p>
      <p>
        EV is <em>not</em> about any individual result. You can make a perfectly correct
        decision and lose the hand — that's variance. You can make a terrible decision and win —
        that's also variance. The math guarantees only that correct decisions produce profit over
        a large enough sample. This is why experienced players say: "make the right decision and
        the money takes care of itself."
      </p>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
          The Three-Step EV Process
        </p>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-emerald-900">
          <li>
            <strong>Identify every possible outcome</strong> and assign each a probability.
            All probabilities must sum to 100%.
          </li>
          <li>
            For each outcome: <strong>multiply probability × result</strong>.
            Use positive numbers for wins, negative for losses.
          </li>
          <li>
            <strong>Sum all results</strong>. The total is the EV of the decision.
          </li>
        </ol>
        <p className="text-xs text-emerald-700 font-mono">
          EV = Σ (probability × result)
        </p>
      </div>

      {/* Worked examples */}
      <div className="space-y-3">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Example 1 — Coin Flip</p>
          <p className="text-sm text-gray-700">Heads → lose $10. Tails → win $15. Should you play?</p>
          <div className="text-xs font-mono text-gray-700 bg-white border border-gray-200 rounded-lg p-3 space-y-0.5">
            <p>Step 1:  heads (50%)  |  tails (50%)</p>
            <p>Step 2:  0.50 × (−$10) = −$5.00  |  0.50 × (+$15) = +$7.50</p>
            <p>Step 3:  −$5.00 + $7.50 = <strong>+$2.50</strong></p>
          </div>
          <p className="text-xs text-gray-500">EV = +$2.50 per flip. Always play — every flip profits $2.50 on average.</p>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Example 2 — Rolling a Die</p>
          <p className="text-sm text-gray-700">Roll 1 or 2 → win $3. Anything else → lose $1.</p>
          <div className="text-xs font-mono text-gray-700 bg-white border border-gray-200 rounded-lg p-3 space-y-0.5">
            <p>Step 1:  win = 2/6 = 1/3  |  lose = 4/6 = 2/3</p>
            <p>Step 2:  (1/3) × +$3 = +$1.00  |  (2/3) × −$1 = −$0.667</p>
            <p>Step 3:  +$1.00 − $0.667 = <strong>+$0.33</strong></p>
          </div>
          <p className="text-xs text-gray-500">EV = +$0.33 per roll. Positive EV — play every time it's offered.</p>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Example 3 — Card Draw (Negative EV)</p>
          <p className="text-sm text-gray-700">Draw from a deck. Ace → win $10; any other card → lose $1.</p>
          <div className="text-xs font-mono text-gray-700 bg-white border border-gray-200 rounded-lg p-3 space-y-0.5">
            <p>Step 1:  ace = 4/52 = 1/13  |  miss = 48/52 = 12/13</p>
            <p>Step 2:  (1/13) × +$10 = +$0.769  |  (12/13) × −$1 = −$0.923</p>
            <p>Step 3:  +$0.769 − $0.923 = <strong>−$0.154</strong></p>
          </div>
          <p className="text-xs text-gray-500">EV = −$0.154 per draw. Negative EV — decline every time.</p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Example 4 — Poker Bluff</p>
          <p className="text-sm text-blue-900">
            You bluff $50 into a $60 pot. Villain folds 55% of the time.
          </p>
          <div className="text-xs font-mono text-blue-800 bg-white border border-blue-200 rounded-lg p-3 space-y-0.5">
            <p>Step 1:  fold (55%)  |  call/raise (45%)</p>
            <p>Step 2:  0.55 × +$60 = +$33  |  0.45 × −$50 = −$22.50</p>
            <p>Step 3:  +$33 − $22.50 = <strong>+$10.50</strong></p>
          </div>
          <p className="text-xs text-blue-700">
            EV = +$10.50 per bluff attempt. This bluff is profitable — and the math tells you
            exactly how profitable, independent of whether villain actually folds in any given hand.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
          Sklansky Bucks and G-Bucks (Preview)
        </p>
        <p className="text-sm text-gray-700">
          <strong>Sklansky Bucks</strong>: what you "should" have won based on your equity at
          the moment money went in. If you got all-in with 70% equity for a $100 pot, you earned
          $70 in Sklansky Bucks regardless of the actual outcome. This separates decision quality
          from results. A bad beat doesn't mean a bad decision.
        </p>
        <p className="text-sm text-gray-700">
          <strong>G-Bucks</strong> (covered fully in Section 6) extend this concept to equity
          against an opponent's <em>entire range</em>, not just the hand they happened to show.
          G-Bucks are a more accurate measure of real decision quality.
        </p>
      </div>
    </div>

    {/* ── Part 3: EV Step-by-Step Workthrough ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-4">
        Interactive — Three-Step EV Calculation
      </p>
      <EVWorkthrough />
    </div>

    {/* ── Part 4: EV Simulator ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-3">
        Seeing EV in Action — QQ vs AK
      </p>
      <p className="text-sm text-gray-600 mb-4 leading-relaxed">
        This simulator demonstrates the most important lesson in all of poker math: in the short
        run, real results deviate wildly from expectation. In the long run, they converge. Every
        time you make a +EV decision, you earn Sklansky Bucks — whether you win the hand or not.
      </p>
      <EVSimulator />
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
            { label: "1/4 = 25%", explanation: "Close, but 4:1 means 4 losses for every 1 win. Fraction = 1/(4+1) = 1/5 = 20%, not 1/4. Watch out for The Doors trap!" },
            { label: "1/5 = 20%", explanation: "Correct! Ratio m:n → fraction n/(m+n). So 4:1 → 1/(4+1) = 1/5 = 20%." },
            { label: "4/5 = 80%", explanation: "4/5 is the probability of LOSING (4 of 5 outcomes). The WIN probability is 1/5 = 20%." },
            { label: "1/4 = 33%", explanation: "Two errors: 1/4 = 25% (not 33%), and ratio 4:1 → 1/5 (not 1/4). Apply m:n → n/(m+n): 4:1 → 1/5 = 20%." },
          ]}
          correctIndex={1}
        />

        <QuizQuestion
          question="You roll one die. Rolling a 6 wins you $4. Anything else loses $1. What is the EV per roll?"
          options={[
            { label: "+$0.50", explanation: "EV = (1/6 × $4) + (5/6 × −$1) = $0.667 − $0.833 = −$0.167. Negative." },
            { label: "+$0.17", explanation: "EV = (1/6 × $4) + (5/6 × −$1) = −$0.167. Negative, not positive." },
            { label: "−$0.17", explanation: "Correct! (1/6 × $4) + (5/6 × −$1) = $0.667 − $0.833 = −$0.167. Don't play this game." },
            { label: "+$0.33", explanation: "EV = (1/6 × $4) + (5/6 × −$1) = $0.667 − $0.833 = −$0.167. The prize isn't large enough to compensate for frequent losses." },
          ]}
          correctIndex={2}
        />

        <QuizQuestion
          question="You call a river bet. 40% of the time villain is bluffing (you win the $200 pot). 60% of the time villain has the nuts and you lose your $60 call. What is the EV of calling?"
          options={[
            { label: "+$16", explanation: "EV = (0.40 × +$200) + (0.60 × −$60) = $80 − $36 = +$44." },
            { label: "+$44", explanation: "Correct! Step 1: fold (40%) and call-loses (60%). Step 2: 0.40 × $200 = +$80; 0.60 × −$60 = −$36. Step 3: +$80 − $36 = +$44." },
            { label: "−$16", explanation: "EV = (0.40 × $200) + (0.60 × −$60) = $80 − $36 = +$44. Calling is profitable here." },
            { label: "+$28", explanation: "EV = (0.40 × $200) + (0.60 × −$60) = $80 − $36 = +$44, not $28." },
          ]}
          correctIndex={1}
        />
      </div>
    </div>
  </div>
);

export default Section3;
