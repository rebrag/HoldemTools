// src/pages/private/AdvancedTab.tsx
// Taiwanese Advanced: deal a full random table. Every player gets random 7
// cards, and each independently sets the best PRE-BOARD split for their own
// cards (the same argmax-EV computation the single-hand advisor runs, knowing
// nothing about the other hands or the board). Then the board(s) are dealt
// and the deal is scored for real. Clicking a player shows their pre-board
// ranking - independent of this deal's board and the other players' cards -
// for comparing real home-game setting decisions against the tool's.
import React, { useState } from "react";
import clsx from "clsx";
import { evaluateCards } from "phe";
import PlayingCard from "@/components/PlayingCard";
import { buildDeck, sampleN } from "@/lib/cards";
import { bestOmaha } from "@/lib/handEval";
import { scoreDealAll, type DealBreakdown, type RowScores } from "@/lib/taiwanese";
import { useAdvancedSolves, type PlayerRanking } from "./useAdvancedSolves";
import { useSelfPlayLibrary } from "./useSelfPlayLibrary";
import SplitRows from "./SplitRows";
import BreakdownTable from "./BreakdownTable";
import { Segmented, Chip, ProgressBar, glassCard } from "./controls";
import type { TaiwaneseSplitResult } from "./protocol";

const SAMPLE_PRESETS = [
  { label: "1k", value: 1_000 },
  { label: "2k", value: 2_000 },
  { label: "5k", value: 5_000 },
  { label: "20k", value: 20_000 },
];

const fmtEv = (ev: number) => `${ev >= 0 ? "+" : ""}${ev.toFixed(2)} pts`;
const fmtPts = (n: number) => (n > 0 ? `+${n}` : String(n));

interface Deal {
  rankings: PlayerRanking[];
  chosen: TaiwaneseSplitResult[];
  boardCards: string[][];
  breakdown: DealBreakdown[];
}

const AdvancedTab: React.FC = () => {
  const [playerCount, setPlayerCount] = useState(3);
  const [boards, setBoards] = useState<1 | 2>(2);
  const [royalties, setRoyalties] = useState(false);
  const [samples, setSamples] = useState(1_000);
  // Self-play by default: it is the equilibrium model, and the fixed rule of
  // thumb only exists as a fast preview.
  const [selfPlay, setSelfPlay] = useState(true);
  const [mixing, setMixing] = useState<"pure" | "mixed">("mixed");
  const [deal, setDeal] = useState<Deal | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { running, progress, error, run, cancel } = useAdvancedSolves();
  const lib = useSelfPlayLibrary();

  const busy = running || lib.building;

  const dealNew = async () => {
    setDeal(null);
    setSelected(null);
    setShowAll(false);
    // Capture the settings this deal runs under, so a toggle flipped mid-solve
    // cannot make the scoring disagree with the solves.
    const dealRoyalties = royalties;
    let library;
    if (selfPlay) {
      const l = await lib.ensure(playerCount - 1, boards, dealRoyalties);
      if (!l) return; // error is shown by the hook
      library = l.entries;
    }
    const deck = sampleN(buildDeck(), 52);
    const hands = Array.from({ length: playerCount }, (_, i) => deck.slice(i * 7, i * 7 + 7));
    const off = playerCount * 7;
    const boardCards = Array.from({ length: boards }, (_, b) =>
      deck.slice(off + b * 5, off + b * 5 + 5)
    );
    run(hands, playerCount - 1, boards, samples, dealRoyalties, library, mixing, (rankings) => {
      const chosen = rankings.map((r) => r.splits[0]);
      const rows: RowScores[][] = chosen.map((sp) =>
        boardCards.map((board) => ({
          top: evaluateCards([...sp.top, ...board]),
          middle: evaluateCards([...sp.middle, ...board]),
          bottom: bestOmaha(board, sp.bottom),
        }))
      );
      setDeal({ rankings, chosen, boardCards, breakdown: scoreDealAll(rows, dealRoyalties) });
    });
  };

  const cancelAll = () => {
    lib.cancel();
    cancel();
  };

  const sel = selected != null && deal ? deal.rankings[selected] : null;

  return (
    <div className="space-y-4">
      <div className={glassCard}>
        <div className="space-y-4">
          <p className="text-sm text-emerald-100/70 max-w-2xl">
            Deals every player a random 7-card hand. Each player independently sets the best
            pre-board split for their own cards, knowing nothing about the board or the
            other hands; then the board runs out and the deal is scored. Click a player to
            see their full pre-board ranking.
          </p>

          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
                Players
              </p>
              <div className="flex gap-1.5">
                {[2, 3, 4].map((n) => (
                  <Chip
                    key={n}
                    label={String(n)}
                    active={playerCount === n}
                    onClick={() => setPlayerCount(n)}
                    disabled={busy}
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
                disabled={busy}
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
                Royalties
              </p>
              <Segmented
                value={royalties ? "on" : "off"}
                options={[
                  { value: "off", label: "Off (house)" },
                  { value: "on", label: "On (PokerNews)" },
                ]}
                onChange={(v) => setRoyalties(v === "on")}
                disabled={busy}
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
                    disabled={busy}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
                Opponent model
              </p>
              <Segmented
                value={selfPlay ? "selfplay" : "heuristic"}
                options={[
                  { value: "selfplay", label: "Self-play" },
                  { value: "heuristic", label: "Heuristic (fast)" },
                ]}
                onChange={(v) => setSelfPlay(v === "selfplay")}
                disabled={busy}
              />
            </div>
            {selfPlay && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
                  Opponent play
                </p>
                <Segmented
                  value={mixing}
                  options={[
                    { value: "mixed", label: "Human mix" },
                    { value: "pure", label: "Best split" },
                  ]}
                  onChange={setMixing}
                  disabled={busy}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={busy ? cancelAll : dealNew}
              className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-emerald-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {busy ? "Cancel" : "Deal random hands"}
            </button>
            <div className="flex-1 max-w-xs">
              <ProgressBar progress={lib.building ? lib.progress : progress} visible={busy} />
            </div>
            {lib.building ? (
              <p className="text-xs text-emerald-100/60">Building opponent policy...</p>
            ) : (
              running && (
                <p className="text-xs text-emerald-100/60">
                  Solving player {Math.min(playerCount, Math.floor(progress * playerCount) + 1)} of{" "}
                  {playerCount}...
                </p>
              )
            )}
          </div>

          {(error || lib.error) && <p className="text-sm text-red-400">{error ?? lib.error}</p>}
        </div>
      </div>

      {deal && (
        <div className={glassCard}>
          <div className="grid gap-3 sm:grid-cols-2">
            {deal.chosen.map((sp, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setSelected(selected === i ? null : i);
                  setShowAll(false);
                }}
                className={clsx(
                  "rounded-lg bg-white/[0.04] p-3 text-left transition-colors hover:bg-white/[0.08]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  selected === i && "ring-2 ring-emerald-400"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-emerald-100/60 mb-1.5">
                      Player {i + 1} <span className="text-emerald-100/40">(their best pre-board split)</span>
                    </p>
                    <SplitRows split={sp} cardWidth={30} />
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold",
                      deal.breakdown[i].total > 0
                        ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
                        : deal.breakdown[i].total < 0
                          ? "border-red-400/40 bg-red-400/10 text-red-400"
                          : "border-white/20 bg-white/[0.05] text-emerald-100/60"
                    )}
                  >
                    {fmtPts(deal.breakdown[i].total)} pts
                  </span>
                </div>
              </button>
            ))}

            {deal.boardCards.map((b, g) => (
              <div key={`b${g}`} className="rounded-lg bg-white/[0.04] p-3">
                <p className="text-xs text-emerald-100/60 mb-2">
                  Board {g + 1} <span className="text-emerald-100/40">(dealt after everyone set)</span>
                </p>
                <div className="flex gap-1">
                  {b.map((c) => (
                    <PlayingCard key={c} code={c} width={34} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <BreakdownTable breakdown={deal.breakdown} />
          </div>
        </div>
      )}

      {deal && sel && selected != null && (
        <div className={glassCard}>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Player {selected + 1}'s pre-board ranking
          </p>
          <p className="mt-1 text-sm text-emerald-100/70 max-w-2xl">
            EV over random boards and opponents, knowing only these 7 cards - independent of
            this deal's board and the other players' hands. #1 is the split they set above.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {sel.splits.slice(0, 10).map((s, i) => (
              <div
                key={s.top.join("") + s.middle.join("")}
                className={clsx(
                  "rounded-lg bg-white/[0.04] p-3 flex items-start justify-between gap-3",
                  i === 0 && "ring-1 ring-emerald-400/50"
                )}
              >
                <div>
                  <p className="text-xs text-emerald-100/50 mb-1.5">
                    #{i + 1}
                    {i === 0 && <span className="text-emerald-300"> &middot; set</span>}
                  </p>
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
            {showAll ? "Hide" : "Show"} all {sel.splits.length} splits
          </button>
          {showAll && (
            <div className="mt-3 font-mono text-xs text-emerald-100/80 space-y-1 overflow-x-auto">
              {sel.splits.map((s, i) => (
                <p key={s.top.join("") + s.middle.join("")} className="whitespace-nowrap">
                  {String(i + 1).padStart(3, " ")}. {s.top.join("")} | {s.middle.join(" ")} |{" "}
                  {s.bottom.join(" ")} {"->"} {fmtEv(s.evPoints)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdvancedTab;
