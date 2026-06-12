import React, { useState } from "react";
import CardRow from "@/components/CardRow";
import QuizQuestion from "../components/QuizQuestion";

/* ── 4/2 Rule Calculator ── */
const FourTwoCalc: React.FC = () => {
  const [outs, setOuts] = useState(9);
  const flop = Math.min(100, outs * 4);
  const turn = Math.min(100, outs * 2);
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-800">
        Adjust outs to see approximate equity:
      </p>
      <div className="space-y-1">
        <label className="text-xs font-semibold text-gray-600">Outs: {outs}</label>
        <input type="range" min={1} max={20} value={outs}
          onChange={(e) => setOuts(Number(e.target.value))} className="w-full accent-emerald-600" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
          <p className="text-xs text-emerald-600 font-semibold">Flop → River (× 4)</p>
          <p className="text-2xl font-bold text-emerald-700">{flop}%</p>
          <p className="text-xs text-emerald-500 font-mono">{outs} × 4 = {flop}%</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-center">
          <p className="text-xs text-blue-600 font-semibold">Turn → River (× 2)</p>
          <p className="text-2xl font-bold text-blue-700">{turn}%</p>
          <p className="text-xs text-blue-500 font-mono">{outs} × 2 = {turn}%</p>
        </div>
      </div>
    </div>
  );
};

/* ── Outs demo ── */
const OutsDemo: React.FC = () => {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-gray-600">
        You hold <strong>T♥ 9♥</strong>. Board: <strong>A♠ K♥ 4♥</strong> (flop). How many flush outs?
      </p>
      <div className="flex flex-wrap gap-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Your hand</p>
          <CardRow cardsStr="Th 9h" size="sm" />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Board</p>
          <CardRow cardsStr="As Kh 4h" size="sm" />
        </div>
      </div>
      {!show ? (
        <button onClick={() => setShow(true)}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors">
          Count the Outs
        </button>
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-1.5">
          <p className="text-sm font-bold text-emerald-800">9 Flush Outs</p>
          <p className="text-xs text-emerald-700">
            There are 13 hearts in the deck. You can see 3 (T♥, 9♥, K♥, 4♥ — wait, K♥ and 4♥ are
            on board, and T♥, 9♥ in hand). That's 4 hearts accounted for. 13 − 4 = <strong>9 hearts remaining</strong> = 9 outs.
          </p>
          <p className="text-xs text-emerald-600 font-mono mt-1">
            Flop equity: 9 × 4 ≈ 36%
          </p>
        </div>
      )}
    </div>
  );
};

const Section4: React.FC = () => (
  <div className="space-y-6">

    {/* ── Counting Outs ── */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">Counting Outs</h3>
      <p>
        An <strong>out</strong> is any card that can come on a future street that gives you the
        best hand. Counting outs accurately is the foundation for calculating your equity on any
        street.
      </p>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Rules for Counting Outs</p>
        <ol className="list-decimal list-inside space-y-1.5 text-sm text-emerald-900">
          <li>An out must give you the <strong>best hand</strong> — not just a strong hand</li>
          <li>Cards that complete villain's hand are <strong>not</strong> your outs</li>
          <li>Backdoor outs (need two running cards) count as approximately <strong>1 out each</strong></li>
          <li>Chopping outs (split pot) count as <strong>half an out</strong></li>
          <li>Hidden outs (board pairs, giving you the better kicker) can add extra outs</li>
        </ol>
      </div>

      {/* Table 4 */}
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Table 4 — Common Draws and Outs</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Draw Type</th>
              <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Outs</th>
              <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Flop % (×4)</th>
              <th className="text-center px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">Turn % (×2)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[
              ["Gutshot (inside straight draw)", 4, 16, 8],
              ["One pair (to two pair or trips)", 5, 20, 10],
              ["Two overcards", 6, 24, 12],
              ["Open-ended straight draw (OESD)", 8, 32, 16],
              ["Double gutter (double-inside straight)", 8, 32, 16],
              ["Four-flush (flush draw)", 9, 36, 18],
              ["Straight + flush draw combo (OESFD)", 15, 54, 30],
            ].map(([label, outs, flopPct, turnPct]) => (
              <tr key={label as string} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-700">{label}</td>
                <td className="px-4 py-2 text-center font-bold font-mono text-emerald-700">{outs}</td>
                <td className="px-4 py-2 text-center font-mono text-gray-600">~{flopPct}%</td>
                <td className="px-4 py-2 text-center font-mono text-gray-600">~{turnPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Backdoor outs */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Backdoor Outs</p>
        <p className="text-sm text-blue-900">
          Backdoor draws need two specific running cards to complete (e.g., a backdoor flush needs
          two more cards of your suit on turn <em>and</em> river). Each individual backdoor draw is
          worth approximately <strong>1 out</strong> when you are seeing both cards.
        </p>
        <div className="text-xs font-mono text-blue-800 bg-white border border-blue-200 rounded-lg p-2 space-y-0.5">
          <p>Backdoor flush only: ~4% equity added (≈ 1 extra out on flop)</p>
          <p>Backdoor flush + backdoor straight: ~8% equity added (≈ 2 extra outs)</p>
        </div>
        <p className="text-xs text-blue-700">
          Multiple backdoor draws compound — a hand with a backdoor flush draw AND a backdoor straight
          draw can gain 8%+ equity over a hand with no draw.
        </p>
      </div>

      {/* Hidden and chopping outs */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Hidden and Chopping Outs</p>
        <p className="text-sm text-amber-900">
          <strong>Hidden outs</strong> are cards that remove villain's outs by pairing the board
          (giving you the best kicker), or cards that make your hand best in a non-obvious way.
          These are easy to miss and undercount your equity.
        </p>
        <p className="text-sm text-amber-800">
          <strong>Chopping outs</strong> are cards that cause a split pot — you win half the pot
          instead of all of it. Count these as 0.5 outs rather than a full out.
        </p>
      </div>
    </div>

    {/* ── 4/2 Rule ── */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">The 4/2 Rule</h3>
      <p>
        Once you know your outs, the <strong>4/2 rule</strong> converts them to an approximate
        equity percentage instantly:
      </p>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-lg border border-emerald-200 p-3 text-center">
            <p className="text-xs font-bold text-emerald-700 uppercase">On the Flop (2 cards to come)</p>
            <p className="text-2xl font-bold text-emerald-700 font-mono">Outs × 4</p>
            <p className="text-xs text-emerald-600">≈ equity by the river</p>
          </div>
          <div className="bg-white rounded-lg border border-emerald-200 p-3 text-center">
            <p className="text-xs font-bold text-emerald-700 uppercase">On the Turn (1 card to come)</p>
            <p className="text-2xl font-bold text-emerald-700 font-mono">Outs × 2</p>
            <p className="text-xs text-emerald-600">≈ equity on the river</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-red-700">Critical Caveat — Not All-In on the Flop</p>
        <p className="text-sm text-red-900">
          The <strong>×4 multiplier</strong> on the flop assumes you will see <em>both</em> the turn
          and river cards (i.e., you are all-in). If there is still betting on the turn,{" "}
          <strong>only use ×2</strong> for the next card. You cannot count both cards unless there
          is no more betting.
        </p>
        <p className="text-sm text-red-800">
          Using ×4 when you are <em>not</em> all-in overestimates your equity and leads to
          overcalling. Be conservative: use ×2 per card unless you're all-in.
        </p>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Why Does 4/2 Work?</p>
        <p className="text-sm text-gray-700">
          A standard deck has 52 cards. After seeing 2 hole cards and 3 board cards (flop), there
          are 52 − 5 = 47 unknown cards. For a flush draw with 9 outs:{" "}
          <code>9/47 ≈ 19%</code> for just the turn. For both cards:{" "}
          <code>1 − (38/47 × 37/46) ≈ 35%</code>. The ×4 shortcut gives 36% — close enough for
          fast mental math at the table.
        </p>
      </div>
    </div>

    {/* ── Interactives ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-4">
        Interactive Demo
      </p>
      <OutsDemo />
    </div>

    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-4">
        4/2 Rule Practice
      </p>
      <FourTwoCalc />
    </div>

    {/* ── Quiz ── */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-5">
        Check Your Understanding
      </p>
      <div className="space-y-7">
        <QuizQuestion
          question="You hold K♠Q♠ on a board of J♠ T♦ 2♠. How many flush outs do you have?"
          options={[
            { label: "7 outs", explanation: "13 spades total. K♠ and Q♠ in hand, J♠ and 2♠ on board = 4 spades accounted for. 13 − 4 = 9 outs." },
            { label: "8 outs", explanation: "Hmm — 13 spades in the deck. K♠, Q♠ (hand) + J♠, 2♠ (board) = 4 used. 13 − 4 = 9." },
            { label: "9 outs", explanation: "Correct! 13 spades − 4 accounted for (K♠, Q♠, J♠, 2♠) = 9 remaining flush outs." },
            { label: "11 outs", explanation: "Only aces of spades weren't counted — there are 4 suits × 13 ranks = 52 cards. K♠, Q♠, J♠, 2♠ = 4 gone. 13 − 4 = 9." },
          ]}
          correctIndex={2}
        />

        <QuizQuestion
          question="You're on the flop with 12 outs and you are NOT all-in (betting continues on the turn). What equity should you use for this street's decision?"
          options={[
            { label: "48% (12 × 4)", explanation: "Using ×4 is only valid when you're all-in and see both cards. Since betting continues, only count the next card: 12 × 2 = 24%." },
            { label: "24% (12 × 2)", explanation: "Correct! With betting still to come on the turn, only multiply by 2 for the next card. 12 × 2 = 24%." },
            { label: "36% (splitting the difference)", explanation: "There's no 'split' method. On the flop with active betting, use ×2 (next card only) = 24%." },
            { label: "It doesn't matter which you use", explanation: "It matters a lot! 48% vs 24% could completely change whether a call is profitable. Use ×2 when not all-in on the flop." },
          ]}
          correctIndex={1}
        />

        <QuizQuestion
          question="You have an open-ended straight draw (OESD) on the turn. Using the 4/2 rule, what is your approximate equity on the river?"
          options={[
            { label: "~8%", explanation: "An OESD has 8 outs. On the turn (1 card to come) use ×2: 8 × 2 = 16%." },
            { label: "~16%", explanation: "Correct! OESD = 8 outs. Turn uses ×2: 8 × 2 = 16% on the river." },
            { label: "~24%", explanation: "24% would be 12 outs × 2. An OESD has 8 outs: 8 × 2 = 16%." },
            { label: "~32%", explanation: "32% would be 8 outs × 4 — but that's the flop formula. On the turn, use ×2: 8 × 2 = 16%." },
          ]}
          correctIndex={1}
        />
      </div>
    </div>
  </div>
);

export default Section4;
