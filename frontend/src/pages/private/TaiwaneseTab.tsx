// src/pages/private/TaiwaneseTab.tsx
// Taiwanese poker hand-setting advisor: enter your 7 dealt cards and the tool
// Monte Carlo-scores all 105 top/middle/bottom splits against random
// opponents, ranking them by expected points.
import React, { useMemo, useState } from "react";
import clsx from "clsx";
import PlayingCard from "@/components/PlayingCard";
import CardPicker from "@/components/CardPicker";
import RankSuitKeypad from "@/components/RankSuitKeypad";
import { ROW_POINT, SCOOP_BONUS } from "@/lib/taiwanese";
import { useTaiwaneseSolve } from "./useTaiwaneseSolve";
import { Segmented, Chip, ProgressBar, glassCard } from "./controls";
import type { TaiwaneseSplitResult } from "./protocol";

const SAMPLE_PRESETS = [
  { label: "500", value: 500 },
  { label: "1k", value: 1_000 },
  { label: "2k", value: 2_000 },
  { label: "5k", value: 5_000 },
];

const fmtEv = (ev: number) => `${ev >= 0 ? "+" : ""}${ev.toFixed(2)} pts`;

function SplitRows({ split, cardWidth }: { split: TaiwaneseSplitResult; cardWidth: number }) {
  const rows: { label: string; cards: string[] }[] = [
    { label: "Top", cards: split.top },
    { label: "Middle", cards: split.middle },
    { label: "Bottom", cards: split.bottom },
  ];
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-emerald-100/60">{r.label}</span>
          <span className="flex gap-1">
            {r.cards.map((c) => (
              <PlayingCard key={c} code={c} width={cardWidth} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

const TaiwaneseTab: React.FC = () => {
  const [cards, setCards] = useState<string[]>([]);
  const [opponents, setOpponents] = useState(1);
  const [boards, setBoards] = useState<1 | 2>(2);
  const [samples, setSamples] = useState(1_000);
  const [showAll, setShowAll] = useState(false);
  const { running, progress, result, error, solve, cancel } = useTaiwaneseSolve();

  const used = useMemo(() => new Set(cards), [cards]);
  const full = cards.length === 7;

  const pick = (code: string) => {
    if (running || full || used.has(code)) return;
    setCards((cs) => [...cs, code]);
  };
  const remove = (code: string) => {
    if (running) return;
    setCards((cs) => cs.filter((c) => c !== code));
  };

  const onSolve = () => {
    setShowAll(false);
    solve(cards, opponents, boards, samples);
  };

  return (
    <div className="space-y-4">
      <div className={glassCard}>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                Your 7 cards
              </p>
              <div className="flex items-center gap-3">
                <p className="text-xs text-emerald-100/60">
                  {full ? "Ready to solve" : `Choose card ${cards.length + 1} of 7`}
                </p>
                <button
                  type="button"
                  onClick={() => setCards([])}
                  disabled={running || !cards.length}
                  className="text-xs text-emerald-100/60 underline decoration-emerald-100/30 transition-colors hover:text-emerald-100 disabled:opacity-30 disabled:pointer-events-none"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Fixed slots, so the row keeps its height and the next target is
                obvious instead of the layout shifting on every pick. Seven
                equal columns rather than a wrapping flex row: the slots then
                stay on one line down to the narrowest phone. */}
            <div className="grid grid-cols-7 gap-1.5 max-w-[340px]">
              {Array.from({ length: 7 }, (_, i) => {
                const code = cards[i];
                if (code) {
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => remove(code)}
                      title={`Remove ${code}`}
                      className="flex rounded-lg transition-transform active:scale-95 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      <PlayingCard code={code} width="100%" />
                    </button>
                  );
                }
                const isNext = i === cards.length && !running;
                return (
                  <div
                    key={`slot-${i}`}
                    className={clsx(
                      "w-full aspect-[3/4] rounded-lg border border-dashed",
                      isNext
                        ? "border-emerald-400/70 bg-emerald-400/10"
                        : "border-white/15 bg-white/[0.03]"
                    )}
                  />
                );
              })}
            </div>

            {/* Desktop: the full deck as four suit rows of thirteen. The
                component's default class is inline-grid, which collapses an
                auto-fill track list to a single column, so this passes an
                explicit full-width block grid. */}
            <div className="mt-3 hidden md:block">
              <CardPicker
                used={used}
                onPick={pick}
                disabled={running || full}
                size="sm"
                fitToWidth
                cardWidth="100%"
                gapPx={5}
                className={clsx(
                  "grid w-full max-w-3xl rounded-xl border border-white/10 bg-white/[0.04] p-2.5 transition-opacity",
                  (running || full) && "opacity-40"
                )}
              />
            </div>
            <div className="mt-2 md:hidden">
              <RankSuitKeypad
                used={used}
                onPick={pick}
                targetLabel={full || running ? undefined : `Card ${cards.length + 1} of 7`}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
                Opponents
              </p>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Chip
                    key={n}
                    label={String(n)}
                    active={opponents === n}
                    onClick={() => setOpponents(n)}
                    disabled={running}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
                Boards
              </p>
              <Segmented
                value={String(boards) as "1" | "2"}
                options={[
                  { value: "1", label: "Single" },
                  { value: "2", label: "Double" },
                ]}
                onChange={(v) => setBoards(Number(v) as 1 | 2)}
                disabled={running}
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
                Samples
              </p>
              <div className="flex gap-1.5">
                {SAMPLE_PRESETS.map((pr) => (
                  <Chip
                    key={pr.label}
                    label={pr.label}
                    active={samples === pr.value}
                    onClick={() => setSamples(pr.value)}
                    disabled={running}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={running ? cancel : onSolve}
              disabled={!running && !full}
              className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-emerald-300 active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {running ? "Cancel" : "Solve"}
            </button>
            <div className="flex-1 max-w-xs">
              <ProgressBar progress={progress} visible={running} />
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>

      {result && (
        <div className={glassCard}>
          <p className="font-mono text-sm text-emerald-100/90">
            {result.samples.toLocaleString("en-US")} scenarios vs {result.opponents}{" "}
            {result.opponents === 1 ? "opponent" : "opponents"},{" "}
            {result.boards === 1 ? "single board" : "double board"}. EV is net points per deal.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {result.splits.slice(0, 10).map((s, i) => (
              <div
                key={s.top.join("") + s.middle.join("")}
                className="rounded-lg bg-white/[0.04] p-3 flex items-start justify-between gap-3"
              >
                <div>
                  <p className="text-xs text-emerald-100/50 mb-1.5">#{i + 1}</p>
                  <SplitRows split={s} cardWidth={30} />
                </div>
                <span className="shrink-0 rounded-full bg-emerald-400/15 border border-emerald-400/40 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                  {fmtEv(s.evPoints)}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-4 text-sm text-emerald-300 underline decoration-emerald-300/40 hover:text-emerald-200 transition-colors"
          >
            {showAll ? "Hide" : "Show"} all {result.splits.length} splits
          </button>
          {showAll && (
            <div className="mt-3 font-mono text-xs text-emerald-100/80 space-y-1 overflow-x-auto">
              {result.splits.map((s, i) => (
                <p key={s.top.join("") + s.middle.join("")} className="whitespace-nowrap">
                  {String(i + 1).padStart(3, " ")}. {s.top.join("")} | {s.middle.join(" ")} |{" "}
                  {s.bottom.join(" ")} {"->"} {fmtEv(s.evPoints)}
                </p>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-emerald-100/50">
            Opponent model: each opponent is dealt 7 random cards and sets them with a fixed
            heuristic (best Omaha material to the bottom). Scoring: {ROW_POINT} pts per row won,{" "}
            {SCOOP_BONUS}-pt scoop bonus for winning every row on every board.
          </p>
        </div>
      )}
    </div>
  );
};

export default TaiwaneseTab;
