import React, { useState } from "react";
import QuizQuestion from "../components/QuizQuestion";

const CONCEPTS = [
  { section: 1, topic: "Why Math Matters", summary: "Two keys: accurate assumptions + making the best decision. Math provides the decision-making framework that gut feel cannot." },
  { section: 2, topic: "Measurements", summary: "Stack depth in BB, win rates in bb/100 (0–4 marginal, 4–7 nice, 7+ crushing), pot-size raise formula, hourly earn calculation." },
  { section: 3, topic: "Numbers & EV", summary: "Fractions ↔ percentages ↔ ratios. EV = Σ(probability × result). Three-step process to calculate expectation value." },
  { section: 4, topic: "Outs & 4/2 Rule", summary: "Count outs carefully (regular, backdoor ~1 out, hidden, chopping 0.5). Flop: ×4 only when all-in. Turn: ×2. Table 4 for common draws." },
  { section: 5, topic: "Pot Odds & Implied Odds", summary: "Required equity = call ÷ (call + pot). Table 5: memorize 6 key benchmarks. Table 6: implied odds multipliers (20% equity = 4× call needed)." },
  { section: 6, topic: "Combinations & Ranges", summary: "Pairs: 6 combos. Suited: 4. Offsuit: 12. Board removal reduces combos. 4-step equity vs range. MS Method. G-Bucks for decision quality." },
  { section: 7, topic: "Aggression", summary: "Bluff break-even = bet ÷ (bet + pot). Table 8 for reward:risk. Semi-bluff = fold equity + showdown equity. Value bet when >50% of calling range is worse." },
  { section: 8, topic: "At the Table", summary: "Tables 9–12 for equity reference. SPR = stack ÷ pot. Table 13 for chunking. Set mining: 15× rule. Exploitive vs balanced play." },
];

const ReviewCard: React.FC<{ section: number; topic: string; summary: string }> = ({ section, topic, summary }) => (
  <div className="flex gap-3">
    <div className="shrink-0 w-7 h-7 rounded-full bg-emerald-50 ring-1 ring-emerald-200 flex items-center justify-center mt-0.5">
      <span className="text-[10px] font-bold text-emerald-700">{section}</span>
    </div>
    <div>
      <p className="text-xs font-semibold text-gray-800">{topic}</p>
      <p className="text-xs text-gray-500 leading-relaxed">{summary}</p>
    </div>
  </div>
);

/* ── Study habits accordion ── */
const StudyHabits: React.FC = () => {
  const [open, setOpen] = useState<number | null>(null);
  const habits = [
    {
      title: "Hand history review",
      detail: "After every session, flag 3–5 decision points where you were unsure. Work through the math off the table: calculate pot odds, equity, EV. Don't just mark bad beats — mark decision points where you hesitated or chose based on feel rather than math.",
    },
    {
      title: "Use poker forums and study groups",
      detail: "Discussing hands with other players is among the most effective study methods. You'll hear reasoning you hadn't considered, expose holes in your logic, and solidify correct concepts by explaining them to others. Choose forums with thoughtful analysis — not just results-oriented thinking.",
    },
    {
      title: "Equity and EV drilling",
      detail: "Use equity calculators regularly but make your estimate before checking. Ask: 'What's my equity with AK vs a 3-betting range of QQ+/AK?' then verify. Active recall beats passive reading. Drill the numbers until they're instant — that's when they become useful at the table.",
    },
    {
      title: "Consistent session volume",
      detail: "Regular shorter sessions beat occasional marathon grinds. Fatigue is the enemy of correct decisions. Your brain processes and consolidates learning during rest. A focused 2-hour session is worth more than a tired 6-hour one in terms of both improvement and win rate.",
    },
    {
      title: "Focus on decisions, not results",
      detail: "The most important mental habit: evaluate your sessions by the quality of decisions, not the dollar outcome. A losing month with excellent decisions is a success; a winning month built on lucky coolers and hero calls is a warning sign. Track your reasoning, not your bankroll graph.",
    },
    {
      title: "Away-from-table work is where you actually improve",
      detail: "Owen Gaines emphasizes this throughout the book: the majority of your improvement happens off the felt. Playing poker is practice — but reading, reviewing, drilling, and thinking through spots is where mental models are built. Commit significant time away from the table if you're serious about improving.",
    },
  ];
  return (
    <div className="space-y-2">
      {habits.map((h, i) => (
        <div key={i} className="rounded-lg border border-gray-200 overflow-hidden">
          <button onClick={() => setOpen(open === i ? null : i)}
            className="w-full text-left px-4 py-2.5 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors">
            <span className="text-sm font-medium text-gray-700">{h.title}</span>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${open === i ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {open === i && (
            <div className="px-4 py-3 text-sm text-gray-600 leading-relaxed bg-white">
              {h.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const Section9: React.FC = () => (
  <div className="space-y-6">

    {/* Course at a glance */}
    <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
      <p>
        You've covered the complete mathematical foundation of winning poker. These concepts
        don't exist in isolation — they form a connected decision-making system from first
        principles to applied strategy.
      </p>
    </div>

    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
      <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Course at a Glance</p>
      <div className="space-y-3">
        {CONCEPTS.map((c) => <ReviewCard key={c.section} {...c} />)}
      </div>
    </div>

    {/* Champions mindset */}
    <div className="border-t border-gray-200 pt-5 space-y-4 text-sm text-gray-700 leading-relaxed">
      <h3 className="font-bold text-gray-900 text-base">The Champion's Mindset</h3>
      <p>
        Michael Jordan missed more than 9,000 shots in his career. Larry Bird practiced free throws
        for hours before every game, even after becoming the best. The defining trait of champions
        in any field is not that they win every time — it's that they make every decision with full
        commitment to the correct process and then trust the results to follow over time.
      </p>
      <p>
        Poker is identical. You will make the mathematically correct play and lose the hand. You
        will fold correctly and watch villain show a bluff. These outcomes are irrelevant to
        whether you made the right decision. The only question that matters: <em>given what I
        knew at the time, did I make the play with the highest expected value?</em>
      </p>
      <p>
        Bad beats and downswings are not variance punishing you — they are variance being
        variance. The math guarantees that correct decisions produce profit over a large enough
        sample. Your job is to make correct decisions consistently and let the sample do the rest.
      </p>
      <p>
        The biggest enemy of improvement is results-oriented thinking: judging a call good because
        it worked, or bad because it didn't. Decouple your self-evaluation from outcomes entirely.
        Every hand is a decision to be evaluated on its merits, not its result.
      </p>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Champion's Principles</p>
        <ul className="list-disc list-inside space-y-1.5 text-sm text-emerald-900">
          <li>Evaluate decisions, not outcomes</li>
          <li>Embrace variance — it's the reason bad players keep playing</li>
          <li>Study when you lose <em>and</em> when you win</li>
          <li>Honest self-assessment beats ego</li>
          <li>Micro-stakes is your education; treat it as such</li>
          <li>Choose your stakes based on what you can learn from, not impress others with</li>
        </ul>
      </div>
    </div>

    {/* Study habits */}
    <div className="border-t border-gray-200 pt-5">
      <h3 className="font-bold text-gray-900 text-base mb-4">Away-from-Table Study</h3>
      <p className="text-sm text-gray-700 mb-4">
        The players who improve fastest are not the ones who play the most hours — they're the
        ones who study deliberately between sessions. Owen Gaines devoted an entire section of
        this book to the idea that away-from-table work is where real improvement lives.
      </p>
      <StudyHabits />
    </div>

    {/* Final quiz */}
    <div className="border-t border-gray-200 pt-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-5">
        Final Review — All 8 Sections
      </p>
      <div className="space-y-7">
        <QuizQuestion
          question="You have a flush draw (9 outs) on the flop. Pot is $60, villain bets $30 (½ pot). Are you getting the right pot odds to call based on pot odds alone?"
          options={[
            { label: "No — flush draws never have enough equity to call ½-pot bets", explanation: "Pot odds for ½-pot bet = 25%. Flush draw on flop (not all-in) = 9 × 2 = 18%. 18% < 25% → no. But with implied odds it may be profitable." },
            { label: "No — pot odds needed is 25%, but flush draw equity with one card is only ~18%", explanation: "Correct! ½-pot bet requires 25% equity. Flush draw turn equity = 9 × 2 = 18%. 18% < 25% → based on immediate pot odds alone, fold. Implied odds may swing this." },
            { label: "Yes — flush draws always have enough equity", explanation: "Depends on the situation. Here: 9 × 2 = 18% vs 25% required. Without implied odds this is a fold." },
            { label: "Yes — 9 outs × 4 = 36% which exceeds the 25% needed", explanation: "The ×4 multiplier only applies when all-in (seeing both cards). Since betting continues, use ×2: 9 × 2 = 18%." },
          ]}
          correctIndex={1}
        />

        <QuizQuestion
          question="Villain's range contains: AA (3 combos after ace on board), KK (6 combos), AK (9 combos). Which hand is most likely in villain's range?"
          options={[
            { label: "AA — aces are always the most likely hand in a 3-bet range", explanation: "Not when card removal applies. After an ace on board: AA = 3 combos, KK = 6 combos, AK = 9 combos. AK is most likely (9 combos)." },
            { label: "KK — pairs are more likely than unpaired hands", explanation: "Not accounting for combos. KK has 6 combos; AK has 9. AK is more likely in this range." },
            { label: "AK — 9 combos makes it the most represented hand", explanation: "Correct! With board removal reducing AA to 3 combos and KK at 6 combos, AK has 9 combos — the highest weight in this range." },
            { label: "All equally likely since they're all in the 3-bet range", explanation: "Hands in a range are weighted by their combo counts. AK (9) > KK (6) > AA (3 after board removal)." },
          ]}
          correctIndex={2}
        />

        <QuizQuestion
          question="Pot is $100. You bluff shove $100. Villain folds 45% of the time. Is this bluff profitable?"
          options={[
            { label: "Yes — any fold equity makes a bluff +EV", explanation: "Break-even fold % = $100 ÷ $200 = 50%. Villain folds 45% < 50% → this bluff is −EV: (0.45 × $100) + (0.55 × −$100) = $45 − $55 = −$10." },
            { label: "No — break-even is 50%; at 45% folds this bluff loses $10 on average", explanation: "Correct! Break-even = 50%. At 45%: EV = (0.45 × +$100) + (0.55 × −$100) = $45 − $55 = −$10. Negative EV." },
            { label: "Yes — shoving into a $100 pot is always correct aggression", explanation: "Aggression requires math to be correct. Break-even = 50%; at 45% folds this bluff loses money." },
            { label: "Break-even — exactly 45% is the threshold", explanation: "The threshold is 50%, not 45%. At 45% folds: EV = −$10 per bluff." },
          ]}
          correctIndex={1}
        />

        <QuizQuestion
          question="SPR is 2 on the flop. You hold top pair, top kicker. Villain bets pot. What should you do?"
          options={[
            { label: "Fold — top pair isn't worth risking your stack", explanation: "SPR 2 = Low SPR. You're committed to the pot. Folding top pair, top kicker at SPR 2 is a major error — the math demands you play for stacks." },
            { label: "Call and re-evaluate the turn — never commit at SPR 2", explanation: "At SPR 2, there's barely a pot-size bet left. You're effectively all-in with your calling range. Top pair top kicker is easily good enough to commit." },
            { label: "Raise or call — you're committed at SPR 2; top pair is enough to stack off", explanation: "Correct! At SPR 0–3, top pair and overpairs are standard stacking hands. You're pot-committed; folding here is a clear mistake." },
            { label: "Only call if you have the nut top pair", explanation: "At SPR 2, top pair with any reasonable kicker is a stacking hand. You cannot fold because of SPR constraints." },
          ]}
          correctIndex={2}
        />

        <QuizQuestion
          question="Which type of analysis gives the best measure of whether your all-in decision was correct — regardless of the outcome?"
          options={[
            { label: "Your actual profit/loss for the session", explanation: "Session results include variance. A winning session may have included terrible decisions that happened to work out. Results alone don't measure decision quality." },
            { label: "G-Bucks — your equity vs. villain's full range × pot at the time of commitment", explanation: "Correct! G-Bucks measure your equity against villain's entire range (not just the hand they had). This is the truest measure of decision quality independent of outcome." },
            { label: "Sklansky Bucks — your equity vs. the specific hand villain showed down", explanation: "S-Bucks are better than real bucks, but since villain's specific hand is unknown when you decide, G-Bucks (equity vs. full range) is more accurate." },
            { label: "Your hourly rate over the last 10 sessions", explanation: "Hourly rate includes variance across sessions. G-Bucks isolate decision quality for individual hands." },
          ]}
          correctIndex={1}
        />
      </div>
    </div>

    {/* Completion banner */}
    <div className="rounded-xl border border-emerald-300/60 bg-emerald-50 p-5 text-center space-y-2">
      <p className="text-sm font-bold text-emerald-800">Course Complete</p>
      <p className="text-xs text-emerald-700 max-w-sm mx-auto leading-relaxed">
        You now have the mathematical foundation to approach every poker decision with precision
        and confidence. Study the concepts, drill the numbers, review your hands — and let the
        math compound over thousands of decisions.
      </p>
    </div>
  </div>
);

export default Section9;
