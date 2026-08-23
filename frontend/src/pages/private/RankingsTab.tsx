// src/pages/private/RankingsTab.tsx
// "Top X% of hands" Monte Carlo rankings: 5-card hold'em, 4-card Badugi, and
// 5-card Badugi (best 4 of 5). Recreates the output of the old Python tool.
import React, { useState } from "react";
import clsx from "clsx";
import PlayingCard from "@/components/PlayingCard";
import { sortCardsDesc } from "@/lib/cards";
import { ACE_LOW_RANK, rankRun } from "@/lib/badugi";
import { useRankingsSim } from "./useRankingsSim";
import { describeCutoff } from "./describe";
import { Segmented, Chip, ProgressBar, glassCard } from "./controls";
import type { RankingsMode } from "./protocol";

const MODE_OPTIONS: { value: RankingsMode; label: string }[] = [
  { value: "holdem5", label: "5-Card Hold'em" },
  { value: "badugi4", label: "4-Card Badugi" },
  { value: "badugi5", label: "5-Card Badugi" },
];

const HAND_PRESETS = [
  { label: "100k", value: 100_000 },
  { label: "300k", value: 300_000 },
  { label: "500k", value: 500_000 },
  { label: "1M", value: 1_000_000 },
];

const MIN_HANDS = 1_000;
const MAX_HANDS = 5_000_000;
const DEFAULT_PERCENTS = "50, 35, 20, 15, 10, 5, 2, 1";

function parsePercents(text: string): number[] {
  const out: number[] = [];
  for (const tok of text.split(/[,\s]+/)) {
    if (!tok) continue;
    const p = Number(tok);
    if (Number.isFinite(p) && p > 0 && p <= 100) out.push(p);
  }
  return out;
}

/** Hold'em cutoffs read high-to-low; badugi cutoffs read low-to-high (ace low). */
function displayOrder(mode: RankingsMode, cards: string[]): string[] {
  if (mode === "holdem5") return sortCardsDesc(cards);
  return cards
    .slice()
    .sort((a, b) => ACE_LOW_RANK[a[0].toUpperCase()] - ACE_LOW_RANK[b[0].toUpperCase()]);
}

const RankingsTab: React.FC = () => {
  const [mode, setMode] = useState<RankingsMode>("badugi4");
  const [numHands, setNumHands] = useState(500_000);
  const [opponents, setOpponents] = useState(3);
  const [draws, setDraws] = useState(0);
  const [percentsText, setPercentsText] = useState(DEFAULT_PERCENTS);
  const [inputError, setInputError] = useState<string | null>(null);
  const { running, progress, result, error, run, cancel } = useRankingsSim();

  const isBadugi = mode !== "holdem5";
  const isDraw = isBadugi && draws > 0;

  const onRun = () => {
    const percents = parsePercents(percentsText);
    if (!percents.length) {
      setInputError("Enter at least one percentage between 0 and 100.");
      return;
    }
    setInputError(null);
    const n = Math.min(MAX_HANDS, Math.max(MIN_HANDS, Math.floor(numHands) || MIN_HANDS));
    setNumHands(n);
    run(mode, n, percents, opponents, isBadugi ? draws : 0);
  };

  const resultDraws = result?.draws ?? 0;
  const freqLabel =
    result?.mode === "holdem5"
      ? "Pair-or-better frequency"
      : resultDraws > 0
        ? `Makes a 4-card Badugi after ${resultDraws} ${resultDraws === 1 ? "draw" : "draws"}`
        : result?.mode === "badugi4"
          ? "4-card Badugi frequency"
          : "4-card Badugi frequency (best 4 of 5)";

  return (
    <div className="space-y-4">
      <div className={glassCard}>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
              Game
            </p>
            <Segmented value={mode} options={MODE_OPTIONS} onChange={setMode} disabled={running} />
            {mode === "badugi5" && (
              <p className="mt-1.5 text-xs text-emerald-100/60">
                Players are dealt 5 cards and use the best 4 of the 5.
              </p>
            )}
          </div>

          {isBadugi && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
                Draws
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {[0, 1, 2, 3].map((d) => (
                  <Chip
                    key={d}
                    label={d === 0 ? "None" : String(d)}
                    active={draws === d}
                    onClick={() => setDraws(d)}
                    disabled={running}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-xs text-emerald-100/60 max-w-lg">
                {draws === 0
                  ? "Hands are ranked exactly as dealt."
                  : `Hands are ranked as dealt, by their showdown value after ${draws} ` +
                    `${draws === 1 ? "draw" : "draws"} of any size, choosing the best keep ` +
                    "each round. A good drawing hand can outrank a made but weak Badugi." +
                    (mode === "badugi4" && draws === 3 ? " 4 cards with 3 draws is standard Badugi." : "")}
              </p>
            </div>
          )}

          {isDraw && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
                Opponents
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((o) => (
                  <Chip
                    key={o}
                    label={String(o)}
                    active={opponents === o}
                    onClick={() => setOpponents(o)}
                    disabled={running}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-xs text-emerald-100/60 max-w-lg">
                A hand is worth the chance it beats every opponent, so the more of them
                there are, the more a marginal made hand is worth breaking up.
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
              Hands to deal
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {HAND_PRESETS.map((pr) => (
                <Chip
                  key={pr.label}
                  label={pr.label}
                  active={numHands === pr.value}
                  onClick={() => setNumHands(pr.value)}
                  disabled={running}
                />
              ))}
              <input
                type="number"
                min={MIN_HANDS}
                max={MAX_HANDS}
                step={1000}
                value={numHands}
                disabled={running}
                onChange={(e) => setNumHands(Number(e.target.value))}
                className="w-32 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                aria-label="Number of hands to deal"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
              Top % cutoffs
            </p>
            <input
              type="text"
              value={percentsText}
              disabled={running}
              onChange={(e) => setPercentsText(e.target.value)}
              placeholder={DEFAULT_PERCENTS}
              className="w-full max-w-sm rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              aria-label="Percent cutoffs, comma separated"
            />
            <p className="mt-1.5 text-xs text-emerald-100/60">
              Comma-separated. Add any percentage to answer "what beats the top X%?".
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={running ? cancel : onRun}
              className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-emerald-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {running ? "Cancel" : "Run simulation"}
            </button>
            <div className="flex-1 max-w-xs">
              <ProgressBar progress={progress} visible={running} />
            </div>
          </div>

          {(inputError || error) && (
            <p className="text-sm text-red-400">{inputError ?? error}</p>
          )}
        </div>
      </div>

      {result && (
        <div className={glassCard}>
          <div className="font-mono text-sm text-emerald-100/90 space-y-1.5">
            <p>Hands dealt: {result.handsDealt.toLocaleString("en-US")}</p>
            {result.opponents != null && (
              <p>
                Ranked against {result.opponents}{" "}
                {result.opponents === 1 ? "opponent" : "opponents"}
                {resultDraws > 0 &&
                  ` over ${resultDraws} ${resultDraws === 1 ? "draw" : "draws"}`}
              </p>
            )}
            <p>
              {freqLabel} &asymp; {result.frequency.toFixed(4)}%
            </p>
          </div>
          <div className="mt-4 space-y-2">
            {result.cutoffs.map((c) => {
              const cards = displayOrder(result.mode, c.cards);
              const kept = c.keep ? new Set(c.keep) : null;
              return (
                <div
                  key={`${c.percent}-${c.cards.join("")}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/[0.04] px-3 py-2"
                >
                  <span className="font-mono text-sm text-emerald-300 w-24 shrink-0">
                    Top {c.percent}%
                  </span>
                  <span className="flex gap-1">
                    {cards.map((card) => (
                      <PlayingCard
                        key={card}
                        code={card}
                        width={30}
                        // Draw mode: the cards this hand throws away read as
                        // discards rather than part of the hand.
                        className={clsx(kept && !kept.has(card) && "opacity-25 grayscale")}
                      />
                    ))}
                  </span>
                  {c.keep ? (
                    <span className="font-mono text-sm text-emerald-100/80">
                      Keep {rankRun(c.keep)}, draw {c.cards.length - c.keep.length}
                      {c.winPct != null && (
                        <span className="text-emerald-300"> &middot; wins {c.winPct.toFixed(1)}%</span>
                      )}
                    </span>
                  ) : (
                    <span className="font-mono text-sm text-emerald-100/80">
                      {describeCutoff(result.mode, c.cards)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {resultDraws > 0 && (
            <p className="mt-4 text-xs text-emerald-100/50 max-w-2xl">
              "Keep" is the first-round decision; later rounds re-decide after each draw.
              "Wins" is the chance of beating every opponent at showdown, everyone playing
              the same optimal-keep strategy. Discards are modeled as unknown cards rather
              than dead ones.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default RankingsTab;
