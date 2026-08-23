// src/pages/private/taiwaneseScoring.ts
// The scoring explanation shown on the Taiwanese tab, derived by running the
// real scoreDealHero rather than restating what it does. Every demo number
// the page prints is the number the simulation actually paid out, so the two
// cannot drift apart. See CLAUDE.md in this folder before changing any of it.
import { rank5 } from "@/lib/handEval";
import { scoreDealHero, ROYALTY_TABLE, type RowScores } from "@/lib/taiwanese";

// Genuine phe scores with known categories, so royalty lookups inside the
// scoring function see exactly what they would see in a real deal.
const HIGH = rank5(["Ah", "Kd", "Qc", "Js", "9h"]); // ace high
const HIGH2 = rank5(["Kh", "Qd", "Jc", "Ts", "8h"]); // king high, weaker
const FLUSH = rank5(["Ah", "Kh", "Qh", "Jh", "9h"]);
const FULL = rank5(["Ah", "Ad", "Ac", "Ks", "Kh"]);
const SFLUSH = rank5(["9h", "8h", "7h", "6h", "5h"]);

const row = (top: number, middle: number, bottom: number): RowScores => ({ top, middle, bottom });
// The reference opponent holds a king-high hand in every row on every board.
const OPP = row(HIGH2, HIGH2, HIGH2);
const TIE = row(HIGH2, HIGH2, HIGH2);
const SWEEP = row(HIGH, HIGH, HIGH);

/** One-board deal against a single reference opponent. */
const single = (hero: RowScores, royalties: boolean) =>
  scoreDealHero([hero], [[OPP]], royalties);

export interface ScoringLine {
  situation: string;
  points: number;
  note?: string;
}

/** Every line is priced by the scoring function, not written down by hand. */
export function scoringLines(royalties: boolean, boards: 1 | 2): ScoringLine[] {
  const lines: ScoringLine[] = [
    {
      situation: "Win the top row, tie the rest",
      points: single(row(HIGH, HIGH2, HIGH2), royalties),
      note: boards === 2 ? "the 1-card hold'em row; each board pays this separately" : "the 1-card hold'em row",
    },
    {
      situation: "Win the middle row, tie the rest",
      points: single(row(HIGH2, HIGH, HIGH2), royalties),
      note: "the 2-card hold'em row",
    },
    {
      situation: "Win the bottom row, tie the rest",
      points: single(row(HIGH2, HIGH2, HIGH), royalties),
      note: "the 4-card Omaha row",
    },
    {
      situation: "Lose the bottom row, tie the rest",
      points: scoreDealHero([row(HIGH2, HIGH2, HIGH2)], [[row(HIGH2, HIGH2, HIGH)]], royalties),
      note: "losers pay the row winner",
    },
    {
      situation: "Tie every row",
      points: single(TIE, royalties),
      note: "ties split the payout, and nobody pays a tied row",
    },
  ];
  if (royalties) {
    lines.push(
      {
        situation: "Win the middle with a flush",
        points: single(row(HIGH2, FLUSH, HIGH2), royalties),
        note: "2 for the row plus the flush royalty, PokerNews's own example",
      },
      {
        situation: "Win the bottom with a full house",
        points: single(row(HIGH2, HIGH2, FULL), royalties),
        note: "3 for the row plus the full house royalty",
      },
      {
        situation: "Lose the bottom to a straight flush",
        points: scoreDealHero([row(HIGH2, HIGH2, HIGH2)], [[row(HIGH2, HIGH2, SFLUSH)]], royalties),
        note: "losers pay royalties in full, whatever they hold themselves",
      }
    );
  }
  if (boards === 1) {
    lines.push({
      situation: "Win all three rows outright (scoop)",
      points: single(SWEEP, royalties),
      note: "1 + 2 + 3 for the rows plus the scoop bonus",
    });
  } else {
    lines.push(
      {
        situation: "Win all six rows across both boards (scoop)",
        points: scoreDealHero([SWEEP, SWEEP], [[OPP, OPP]], royalties),
        note: "both boards' rows plus the scoop bonus; the scoop needs all six",
      },
      {
        situation: "Sweep one board, drop the other board's bottom",
        points: scoreDealHero([SWEEP, row(HIGH, HIGH, HIGH2)], [[OPP, row(HIGH2, HIGH2, HIGH)]], royalties),
        note: "no scoop: one lost row anywhere breaks it",
      }
    );
  }
  lines.push({
    situation: "Second-best bottom at a 3-player table",
    points: scoreDealHero(
      [row(HIGH2, HIGH2, HIGH)],
      [[row(HIGH2, HIGH2, FULL)], [row(HIGH2, HIGH2, HIGH2)]],
      royalties
    ),
    note: "only the outright best hand in a row is paid: beating the third player earns nothing, and you still pay the winner",
  });
  return lines;
}

/** The royalty chart exactly as configured, labeled by phe category order. */
export function royaltyChart(): { hand: string; top: number; middle: number; bottom: number }[] {
  const names = [
    "Straight Flush", "Four of a Kind", "Full House", "Flush",
    "Straight", "Three of a Kind", "Two Pair", "One Pair", "High Card",
  ];
  return names
    .map((hand, i) => ({
      hand,
      top: ROYALTY_TABLE.top[i],
      middle: ROYALTY_TABLE.middle[i],
      bottom: ROYALTY_TABLE.bottom[i],
    }))
    .filter((r) => r.top > 0 || r.middle > 0 || r.bottom > 0);
}

// What the rule sources state outright. This is the OUTSIDE reference the
// code is checked against, so it is the one thing here that is written down
// rather than derived. Change it only when the agreed rules change, never to
// make a failing check pass.
// Sources: pokernews.com/poker-rules/taiwanese-poker.htm and
// infogram.com/taiwanese-poker-rules-1hmr6gldm7w84nl (fetched 2026-08-23),
// plus the client's home-game numbers relayed from his friend (2026-08-23):
// scoop 8, no royalties, max vs one opponent 14 on a single board and 20 on
// the double board, scoop requiring all six rows there.
export const SOURCE_FACTS = {
  rowWin: { top: 1, middle: 2, bottom: 3 }, // every source agrees
  pokernews: { scoopBonus: 3, middleFlushTotal: 4 },
  house: { scoopBonus: 8, maxSingleBoard: 14, maxDoubleBoard: 20 },
};

export interface SourceCheck {
  label: string;
  computed: number;
  stated: number;
  ok: boolean;
}

/** Does the code pay out what the active rule set's sources say it should? */
export function sourceChecks(royalties: boolean): SourceCheck[] {
  const winTop = single(row(HIGH, HIGH2, HIGH2), royalties);
  const winMiddle = single(row(HIGH2, HIGH, HIGH2), royalties);
  const winBottom = single(row(HIGH2, HIGH2, HIGH), royalties);
  const sweep1 = single(SWEEP, royalties);
  const checks: SourceCheck[] = [
    { label: "top row win pays", computed: winTop, stated: SOURCE_FACTS.rowWin.top, ok: false },
    { label: "middle row win pays", computed: winMiddle, stated: SOURCE_FACTS.rowWin.middle, ok: false },
    { label: "bottom row win pays", computed: winBottom, stated: SOURCE_FACTS.rowWin.bottom, ok: false },
  ];
  if (royalties) {
    checks.push(
      {
        label: "scoop bonus on top of the three rows",
        computed: sweep1 - winTop - winMiddle - winBottom,
        stated: SOURCE_FACTS.pokernews.scoopBonus,
        ok: false,
      },
      {
        label: "middle flush collects (PokerNews example)",
        computed: single(row(HIGH2, FLUSH, HIGH2), royalties),
        stated: SOURCE_FACTS.pokernews.middleFlushTotal,
        ok: false,
      }
    );
  } else {
    checks.push(
      {
        label: "scoop bonus on top of the rows (house)",
        computed: sweep1 - winTop - winMiddle - winBottom,
        stated: SOURCE_FACTS.house.scoopBonus,
        ok: false,
      },
      {
        label: "most from one opponent, single board (house)",
        computed: sweep1,
        stated: SOURCE_FACTS.house.maxSingleBoard,
        ok: false,
      },
      {
        label: "most from one opponent, double board (house)",
        computed: scoreDealHero([SWEEP, SWEEP], [[OPP, OPP]], royalties),
        stated: SOURCE_FACTS.house.maxDoubleBoard,
        ok: false,
      }
    );
  }
  for (const c of checks) c.ok = c.computed === c.stated;
  return checks;
}
