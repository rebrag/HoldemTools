import React, { useState } from "react";
import CardRow from "@/components/CardRow";
import QuizQuestion from "../components/QuizQuestion";
import ChipStack from "@/components/ChipStack";

/* ── SPR Calculator ── */
const SPR_CATEGORIES = [
  { range: "0–3", label: "Low SPR", color: "emerald", hands: "Top pair, overpairs", note: "Pot-committed. Stack off with strong top pair or better." },
  { range: "4–13", label: "Medium SPR", color: "amber", hands: "Two pair, sets, strong draws", note: "Be selective. Need stronger hands to feel comfortable stacking." },
  { range: "14+", label: "High SPR", color: "blue", hands: "Sets, straights, flushes, boats+", note: "Need near-nuts. Overpairs are marginal at best." },
];

const SPRCalc: React.FC = () => {
  const [stack, setStack] = useState(120);
  const [pot, setPot] = useState(30);
  const spr = Math.round((stack / pot) * 10) / 10;
  const category = spr <= 3 ? SPR_CATEGORIES[0] : spr <= 13 ? SPR_CATEGORIES[1] : SPR_CATEGORIES[2];
  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    blue: "bg-blue-50 border-blue-200 text-blue-800",
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">Effective stack: ${stack}</label>
          <input type="range" min={20} max={500} step={10} value={stack}
            onChange={(e) => setStack(Number(e.target.value))} className="w-full accent-emerald-600" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">Pot size: ${pot}</label>
          <input type="range" min={5} max={200} step={5} value={pot}
            onChange={(e) => setPot(Number(e.target.value))} className="w-full accent-blue-600" />
        </div>
      </div>
      <div className={`rounded-lg border px-4 py-3 space-y-3 ${colorMap[category.color]}`}>
        <div className="flex items-end justify-around pb-3 border-b border-current/10">
          <div className="flex flex-col items-center gap-1">
            <ChipStack amount={stack} showBreakdown={false} showLabel={false} />
            <span className="text-[10px] text-gray-500 font-medium">Stack</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ChipStack amount={pot} showBreakdown={false} showLabel={false} />
            <span className="text-[10px] text-gray-500 font-medium">Pot</span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{category.label}</span>
          <span className="text-2xl font-bold font-mono">SPR {spr}</span>
        </div>
        <p className="text-xs font-mono">${stack} ÷ ${pot} = {spr}</p>
        <p className="text-xs font-semibold">Stack off with: {category.hands}</p>
        <p className="text-xs">{category.note}</p>
      </div>
    </div>
  );
};

/* ── Memory flash cards ── */
type MemTable = { title: string; rows: [string, string][]; color: string };

const MEMORY_TABLES: MemTable[] = [
  {
    title: "Table 9 — All-In Preflop Equity (approximate)",
    color: "emerald",
    rows: [
      ["Overpair vs. underpair (AA vs. KK)", "80% / 20%"],
      ["Pair vs. two overcards (88 vs. AK)", "52% / 48%"],
      ["Pair vs. one overcard (88 vs. A7)", "70% / 30%"],
      ["Dominated hand (AK vs. AT)", "75% / 25%"],
      ["Two live cards vs. pair (KQ vs. 88)", "48% / 52%"],
    ],
  },
  {
    title: "Table 10 — Strong Hands vs. Strong Ranges",
    color: "blue",
    rows: [
      ["AK vs. JJ+ / AK range", "~43%"],
      ["TT vs. JJ+ / AK range", "~33%"],
      ["QQ vs. KK+ / AK range", "~44%"],
      ["JJ vs. QQ+ / AK range", "~38%"],
      ["AQs vs. QQ+ / AK range", "~36%"],
    ],
  },
  {
    title: "Table 11 — Hole Cards: Flopping Specific Hands",
    color: "amber",
    rows: [
      ["Flopping a set (with pocket pair)", "~11.8% (≈ 1 in 8)"],
      ["Flopping a flush (suited hand)", "~0.8%"],
      ["Flopping four-flush (suited hand)", "~10.9%"],
      ["Flopping pair (one hole card paired)", "~26.9%"],
      ["Flopping two pair (both hole cards)", "~2.0%"],
    ],
  },
  {
    title: "Table 12 — Common Draw vs. Made Hand Equities (flop)",
    color: "gray",
    rows: [
      ["Flush draw vs. top pair", "38% / 62%"],
      ["Flush draw vs. set", "26% / 74%"],
      ["OESD vs. top pair", "32% / 68%"],
      ["Overpair vs. pair + flush draw", "50% / 50%"],
      ["Straight vs. flush draw (flop)", "65% / 35%"],
    ],
  },
];

const MemoryTables: React.FC = () => {
  const [active, setActive] = useState(0);
  const t = MEMORY_TABLES[active];
  const colorClasses: Record<string, { tab: string; header: string; row: string }> = {
    emerald: { tab: "bg-emerald-600 text-white", header: "bg-emerald-50 border-emerald-200", row: "hover:bg-emerald-50" },
    blue: { tab: "bg-blue-600 text-white", header: "bg-blue-50 border-blue-200", row: "hover:bg-blue-50" },
    amber: { tab: "bg-amber-600 text-white", header: "bg-amber-50 border-amber-200", row: "hover:bg-amber-50" },
    gray: { tab: "bg-gray-700 text-white", header: "bg-gray-50 border-gray-200", row: "hover:bg-gray-50" },
  };
  const cc = colorClasses[t.color];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {MEMORY_TABLES.map((_mt, i) => (
          <button key={i} onClick={() => setActive(i)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              active === i ? cc.tab : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}>
            Table {i + 9}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className={`border-b px-4 py-2 ${cc.header}`}>
          <p className="text-xs font-bold text-gray-700">{t.title}</p>
        </div>
        <table className="w-full text-xs">
          <tbody className="divide-y divide-gray-100">
            {t.rows.map(([label, value], i) => (
              <tr key={i} className={cc.row}>
                <td className="px-4 py-2 text-gray-700">{label}</td>
                <td className="px-4 py-2 text-right font-bold font-mono text-gray-800">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Section8: React.FC = () => (
  <div className="space-y-6">

    {/* ── Memory Tables ── */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">A Bit of Memory</h3>
      <p>
        Some numbers in poker are best learned by memorizing approximations. The four tables below
        cover the most important equity relationships you'll encounter at the table. Study them
        until they feel automatic.
      </p>
      <MemoryTables />
    </div>

    {/* ── Chunking / SPR ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Chunking and SPR</h3>
      <p>
        Pots grow <em>exponentially</em> through streets, not linearly. Each street adds roughly a
        pot-size amount. This means four pot-size bets on a 100BB stack takes it all-in.
      </p>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Stack-to-Pot Ratio (SPR)</p>
        <p className="text-sm text-emerald-900">
          SPR = effective stack ÷ pot size on the flop. It tells you how many "pot-size bets"
          you have left and which hand strengths are appropriate for stacking off.
        </p>
        <div className="space-y-2">
          {SPR_CATEGORIES.map((cat) => {
            const bg = cat.color === "emerald" ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
              cat.color === "amber" ? "bg-amber-50 border-amber-200 text-amber-800" :
              "bg-blue-50 border-blue-200 text-blue-800";
            return (
              <div key={cat.range} className={`rounded-lg border px-3 py-2 ${bg}`}>
                <div className="flex items-baseline gap-2">
                  <span className="font-bold font-mono text-sm">{cat.range}</span>
                  <span className="font-semibold text-sm">{cat.label}</span>
                </div>
                <p className="text-xs mt-0.5">Stack off with: {cat.hands}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Table 13 */}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Table 13 — Chunking SPR Options (100BB effective stack, 1BB raise)</p>
          <p className="text-xs text-gray-500 mt-0.5">How many pot-size bets fit in the remaining stack at a given SPR</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">SPR</th>
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Betting Pattern to All-In</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[
              [1, "Stack off immediately on flop"],
              [3, "Pot / Pot (2 streets)"],
              [9, "Pot / ¾ pot / ¾ pot (3 streets)"],
              [13, "Pot / pot / pot (3 streets)"],
              [27, "Pot / pot / pot / pot (4 streets — needs preflop action too)"],
            ].map(([spr, pattern]) => (
              <tr key={spr} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-center font-bold font-mono text-emerald-700">{spr}</td>
                <td className="px-4 py-2 text-gray-700">{pattern}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bg-gray-50 border-t border-gray-100 px-4 py-2">
          <p className="text-xs text-gray-500">
            Use this to plan your line before acting. If you have SPR 9, you can comfortably bet
            pot on the flop and the turn and still have a pot-size bet left on the river.
          </p>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Creative Bet Sizing and SPR Control</p>
        <p className="text-sm text-blue-900">
          Bet sizing preflop and on early streets directly controls the SPR at commitment
          decision points. Raising to $3.50 vs $3.00 preflop seems trivial, but adds $3.50 to
          the pot every time — after 3 streets of pot-size betting, this difference compounds to
          a $13.50 difference in total pot size. Use sizing to put SPR at the level where your
          hand plays best.
        </p>
      </div>
    </div>

    {/* ── Set Mining ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Set Mining</h3>
      <p>
        <strong>Set mining</strong> is calling preflop with a small pocket pair, hoping to flop a
        set (trips). It's a speculative call based entirely on implied odds.
      </p>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">The Math of Set Mining</p>
        <div className="text-xs font-mono text-amber-800 bg-white border border-amber-200 rounded-lg p-3 space-y-1">
          <p>Probability of flopping a set or better: ~11.8% (roughly 1 in 8)</p>
          <p>Odds against flopping a set: ~7.5 : 1</p>
          <p className="mt-1">For a profitable call, you need to win roughly 8× your call when you hit.</p>
          <p>But since you're not 100% equity when all-in vs. villain's hand: use 15× as a safe threshold.</p>
          <p className="mt-1">Rule of thumb: call if stack (effective) ≥ 15× your call</p>
        </div>
        <p className="text-sm text-amber-900">
          <strong>Example:</strong> villain raises to $10. You need at least 15 × $10 = $150 in
          effective stacks (after the call) to justify set mining.
        </p>
        <div className="space-y-1.5 text-sm text-amber-800">
          <p className="font-semibold text-xs uppercase tracking-wide">Additional requirements:</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>Villain must have a hand strong enough to stack off with (e.g., top pair+)</li>
            <li>Position helps extract more value when you hit</li>
            <li>Your set must be well-disguised on the texture</li>
            <li>Beware reverse implied odds: flopping bottom set on AAK board = danger</li>
          </ul>
        </div>
      </div>
    </div>

    {/* ── Balanced vs Exploitive Play ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Balanced vs. Exploitive Play</h3>
      <p>
        There are two strategic frameworks in poker, and knowing when to use each is essential.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Exploitive Play</p>
          <p className="text-xs text-emerald-800">
            Maximize profit against <em>this specific villain's</em> weaknesses. If villain
            over-folds, bluff more. If they never fold, value bet wider and never bluff. This
            produces the highest EV against a fixed opponent.
          </p>
          <p className="text-xs text-emerald-700">
            Downside: exploitive adjustments can themselves be exploited. A player who bluffs
            more against over-folders can be exploited by a counter-adjustment.
          </p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Balanced Play</p>
          <p className="text-xs text-blue-800">
            Mix bet/check and value/bluff frequencies so that villain cannot profitably
            counter-exploit you. Balanced ranges have both strong hands and bluffs at the right
            ratios. Optimal for high-stakes vs. skilled opponents.
          </p>
          <p className="text-xs text-blue-700">
            In practice: use exploitive play vs. weaker players with clear leaks. Use balanced
            play vs. observant, skilled regulars who adjust.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Board Texture Awareness</p>
        <div className="space-y-2">
          {[
            { board: "As Kh 4d", label: "Dry / Rainbow", desc: "Few draws. Top pair holds strong equity. Value bet thinner. Villain's range is polarized." },
            { board: "Jh Th 9s", label: "Wet / Connected", desc: "Many draws and combo draws. Protect strong hands with larger bets. Draws have equity." },
            { board: "7h 7d 2c", label: "Paired / Dry", desc: "Sets and full houses dominate. Overpairs lose value. Villain's range has more trips/boats." },
          ].map(({ board, label, desc }) => (
            <div key={board} className="flex gap-3 items-start rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="shrink-0"><CardRow cardsStr={board} size="sm" /></div>
              <div>
                <p className="text-xs font-semibold text-gray-700">{label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* ── Interactive ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-4">
        SPR Calculator
      </p>
      <SPRCalc />
    </div>

    {/* ── Quiz ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-5">
        Check Your Understanding
      </p>
      <div className="space-y-7">
        <QuizQuestion
          question="Using Table 11, how often will you flop a set or better with a pocket pair?"
          options={[
            { label: "~5% of the time (roughly 1 in 20)", explanation: "From Table 11: the probability of flopping a set or better with a pocket pair is ~11.8% — approximately 1 in 8 times." },
            { label: "~8% of the time (roughly 1 in 13)", explanation: "From Table 11: ~11.8% or roughly 1 in 8, not 1 in 13." },
            { label: "~12% of the time (roughly 1 in 8)", explanation: "Correct! From Table 11: ~11.8% → roughly 1 in 8 flops will give you a set or better." },
            { label: "~25% of the time (roughly 1 in 4)", explanation: "This is far too high. From Table 11: ~11.8%, or roughly 1 in 8." },
          ]}
          correctIndex={2}
        />

        <QuizQuestion
          question="You're set mining with 55. Villain raises to $15. Using the 15× rule, what is the minimum effective stack needed to justify calling?"
          options={[
            { label: "$75 (5× the raise)", explanation: "The 15× rule: $15 × 15 = $225 in effective stacks needed, not $75." },
            { label: "$150 (10× the raise)", explanation: "The rule of thumb is 15× the call: $15 × 15 = $225." },
            { label: "$225 (15× the raise)", explanation: "Correct! 15× rule: $15 × 15 = $225. You need at least $225 in effective stacks to justify set mining here." },
            { label: "$300 (20× the raise)", explanation: "$300 would be the conservative 20× version. The standard rule of thumb is 15×: $15 × 15 = $225." },
          ]}
          correctIndex={2}
        />

        <QuizQuestion
          question="The pot on the flop is $24. Effective stacks are $192. What is the SPR, and which hands should you be willing to stack off with?"
          options={[
            { label: "SPR 4 — Low SPR. Stack off with top pair.", explanation: "$192 ÷ $24 = 8.0, not 4.0. SPR 8 is medium range, requiring two pair or sets." },
            { label: "SPR 8 — Medium SPR. Stack off with two pair and better.", explanation: "Correct! $192 ÷ $24 = 8. Medium SPR (4–13). Two pair, sets, and strong combo draws are comfortable stacking hands here." },
            { label: "SPR 8 — Low SPR. Top pair is sufficient to stack off.", explanation: "SPR 8 is medium, not low. Low SPR is 0–3. At SPR 8, top pair alone is usually not strong enough to stack off." },
            { label: "SPR 16 — High SPR. Need near-nuts to stack off.", explanation: "$192 ÷ $24 = 8.0, not 16. SPR 8 is medium range." },
          ]}
          correctIndex={1}
        />
      </div>
    </div>
  </div>
);

export default Section8;
