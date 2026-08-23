// src/pages/private/ScoringExplainer.tsx
// On-page reference for how Taiwanese scoring is configured, tracking the
// tab's ACTIVE settings (royalties on/off, board count). Every demo number is
// produced by running the scoring function, so this panel is a readout of the
// code rather than a description of it. See CLAUDE.md in this folder.
import React from "react";
import { scoringLines, royaltyChart, sourceChecks } from "./taiwaneseScoring";
import { glassCard } from "./controls";

const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));

interface ScoringExplainerProps {
  royalties: boolean;
  boards: 1 | 2;
}

const ScoringExplainer: React.FC<ScoringExplainerProps> = ({ royalties, boards }) => {
  const lines = scoringLines(royalties, boards);
  const chart = royaltyChart();
  const checks = sourceChecks(royalties);
  const allOk = checks.every((c) => c.ok);

  return (
    <details className={glassCard} open>
      <summary className="cursor-pointer list-none">
        <span className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          How scoring is configured
        </span>
        <p className="mt-1 text-sm text-emerald-100/70">
          {royalties
            ? "PokerNews rules: rows pay 1 / 2 / 3 to the outright best hand, royalties for strong hands, and a scoop bonus."
            : "House rules: rows pay 1 / 2 / 3 to the outright best hand, no royalties, and a scoop bonus."}{" "}
          Every number below is read straight from the scoring code with the settings picked
          above, so it always matches what the solver paid.
        </p>
      </summary>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-emerald-100/50">
              <th className="text-left font-medium py-1.5 pr-4">
                Example situations (vs one opponent unless noted)
              </th>
              <th className="text-right font-medium py-1.5 whitespace-nowrap">Your points</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.situation} className="border-t border-white/10 align-top">
                <td className="py-2 pr-4 text-emerald-100/90">
                  {l.situation}
                  {l.note && (
                    <span className="block text-xs text-emerald-100/50">{l.note}</span>
                  )}
                </td>
                <td
                  className={`py-2 text-right font-mono tabular-nums whitespace-nowrap ${
                    l.points > 0
                      ? "text-emerald-300"
                      : l.points < 0
                        ? "text-red-400"
                        : "text-emerald-100/60"
                  }`}
                >
                  {fmt(l.points)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {royalties ? (
        <div className="mt-4 overflow-x-auto">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
            Royalties (added to the row winner's collect)
          </p>
          <table className="w-full max-w-md text-sm border-collapse">
            <thead>
              <tr className="text-emerald-100/50">
                <th className="text-left font-medium py-1 pr-4">Hand</th>
                <th className="text-right font-medium py-1 px-2">Top</th>
                <th className="text-right font-medium py-1 px-2">Middle</th>
                <th className="text-right font-medium py-1 pl-2">Bottom</th>
              </tr>
            </thead>
            <tbody>
              {chart.map((r) => (
                <tr key={r.hand} className="border-t border-white/10">
                  <td className="py-1 pr-4 text-emerald-100/90">{r.hand}</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums text-emerald-100/80">+{r.top}</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums text-emerald-100/80">+{r.middle}</td>
                  <td className="py-1 pl-2 text-right font-mono tabular-nums text-emerald-100/80">+{r.bottom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-emerald-100/70">
          Royalties are off: no bonus points for hand strength, in any row.
        </p>
      )}

      <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
          Checked against the rule sources
        </p>
        <ul className="space-y-1 text-sm">
          {checks.map((c) => (
            <li key={c.label} className={c.ok ? "text-emerald-100/80" : "text-amber-300"}>
              {c.ok ? "OK" : "Mismatch"}: {c.label} {c.computed}, sources say {c.stated}
            </li>
          ))}
        </ul>
        {!allOk && (
          <p className="mt-2 text-sm text-amber-300">
            The configured scoring does not reproduce the rule sources. Either
            lib/taiwanese.ts or the SOURCE_FACTS reference needs correcting.
          </p>
        )}
      </div>

      <div className="mt-3 space-y-1.5 text-xs text-emerald-100/50">
        {royalties && (
          <p>
            Where the two published sources disagree, the PokerNews reading is used: losing
            players pay the winner's royalty in full even when their own hand would qualify
            for the same royalty (the Infogram worked example waives it in that case).
          </p>
        )}
        <p>
          Setting rule: bottom must be the strongest hand and top the weakest, judged on the
          hole cards at setting time (category, then high cards) since the board is not yet
          dealt. The advisor only ranks splits that satisfy it.
        </p>
        <p>
          The scoop needs every row on every board outright: 3 rows on a single board, all 6
          on the double board. Ties break it.
        </p>
        <p>
          Points are settled with every opponent separately. Tied winners split the pot; the
          odd-chip suit tiebreaker from the rules sheet is averaged away in the EV numbers.
        </p>
      </div>
    </details>
  );
};

export default ScoringExplainer;
