// src/pages/private/TaiwaneseTab.tsx
// Taiwanese poker hand-setting advisor: enter your 7 dealt cards and the tool
// Monte Carlo-scores every legal top/middle/bottom split against random
// opponents, ranking them by expected points.
import React, { useMemo, useState } from "react";
import clsx from "clsx";
import PlayingCard from "@/components/PlayingCard";
import CardPicker from "@/components/CardPicker";
import { buildDeck, sampleN } from "@/lib/cards";
import { useTaiwaneseSolve } from "./useTaiwaneseSolve";
import { useSelfPlayLibrary, cachedLibrary, LIBRARY_ENTRIES } from "./useSelfPlayLibrary";
import ScoringExplainer from "./ScoringExplainer";
import SplitRows from "./SplitRows";
import { Segmented, Chip, ProgressBar, glassCard } from "./controls";

const SAMPLE_PRESETS = [
  { label: "2k", value: 2_000 },
  { label: "5k", value: 5_000 },
  { label: "20k", value: 20_000 },
  { label: "50k", value: 50_000 },
];

const fmtEv = (ev: number) => `${ev >= 0 ? "+" : ""}${ev.toFixed(2)} pts`;
const fmtErr = (se?: number) => (se == null ? "" : ` ±${se.toFixed(2)}`);

const TaiwaneseTab: React.FC = () => {
  const [cards, setCards] = useState<string[]>([]);
  const [opponents, setOpponents] = useState(1);
  const [boards, setBoards] = useState<1 | 2>(2);
  // Defaults follow the client's home game: double board, no royalties.
  const [royalties, setRoyalties] = useState(false);
  const [samples, setSamples] = useState(20_000);
  // Self-play by default: it is the equilibrium model, and the fixed rule of
  // thumb only exists as a fast preview.
  const [selfPlay, setSelfPlay] = useState(true);
  // Human-like mixed play by default: opponents sample among their near-best
  // splits weighted by EV gap, which mimics real tables better than everyone
  // finding the exact best split every hand.
  const [mixing, setMixing] = useState<"pure" | "mixed">("mixed");
  const [solvedModel, setSolvedModel] = useState<"heuristic" | "selfplay">("selfplay");
  const [showAll, setShowAll] = useState(false);
  // Collapsed by default: the settings are set once and then left alone, and
  // keeping them out of the flow is what lets the results sit near the top.
  const [showSettings, setShowSettings] = useState(false);
  const { running, progress, result, error, solve, cancel } = useTaiwaneseSolve();
  const lib = useSelfPlayLibrary();

  const used = useMemo(() => new Set(cards), [cards]);
  const full = cards.length === 7;

  // One-line stand-in for the collapsed settings panel, so the current
  // configuration is still readable without opening it.
  const settingsSummary = [
    `${opponents} ${opponents === 1 ? "opponent" : "opponents"}`,
    boards === 1 ? "single board" : "double board",
    `royalties ${royalties ? "on" : "off"}`,
    `${samples / 1000}k samples`,
    selfPlay
      ? `self-play (${mixing === "mixed" ? "human mix" : "best split"})`
      : "heuristic opponents",
  ].join(" · ");

  const pick = (code: string) => {
    if (running || full || used.has(code)) return;
    setCards((cs) => [...cs, code]);
  };
  const remove = (code: string) => {
    if (running) return;
    setCards((cs) => cs.filter((c) => c !== code));
  };
  const randomize = () => {
    if (running) return;
    setCards(sampleN(buildDeck(), 7));
  };

  const onSolve = async () => {
    setShowAll(false);
    if (selfPlay) {
      const library = await lib.ensure(opponents, boards, royalties);
      if (!library) return; // error is shown by the hook
      setSolvedModel("selfplay");
      solve(cards, opponents, boards, samples, royalties, library.entries, mixing);
    } else {
      setSolvedModel("heuristic");
      solve(cards, opponents, boards, samples, royalties);
    }
  };

  const onCancel = () => {
    lib.cancel();
    cancel();
  };

  const busy = running || lib.building;
  const solvedLibrary = solvedModel === "selfplay" ? cachedLibrary(opponents, boards, royalties) : null;
  const libStats = solvedLibrary?.stats ?? null;

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
                  {full ? "Tap a card to change it" : `Choose card ${cards.length + 1} of 7`}
                </p>
                <button
                  type="button"
                  onClick={randomize}
                  disabled={busy}
                  className="text-xs text-emerald-100/60 underline decoration-emerald-100/30 transition-colors hover:text-emerald-100 disabled:opacity-30 disabled:pointer-events-none"
                >
                  Random
                </button>
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

            {/* The full deck as four suit rows of thirteen, on every viewport:
                one picker, so a phone and a desktop select cards the same way.
                The component's default class is inline-grid, which collapses an
                auto-fill track list to a single column, so this passes an
                explicit full-width block grid; the columns are fractions, so
                the thirteen ranks stay on one line down to the narrowest phone.

                It is only mounted while cards are still missing. Once the hand
                is set the deck is dead weight between the hand and the results,
                and removing a card brings it straight back. */}
            {!full && (
              <div className="mt-3">
                <CardPicker
                  used={used}
                  onPick={pick}
                  disabled={running}
                  size="sm"
                  fitToWidth
                  cardWidth="100%"
                  gapPx={3}
                  className={clsx(
                    "grid w-full max-w-3xl rounded-xl border border-white/10 bg-white/[0.04] p-1.5 sm:p-2.5 transition-opacity",
                    running && "opacity-40"
                  )}
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              aria-expanded={showSettings}
              className="text-xs font-semibold uppercase tracking-widest text-emerald-400 underline decoration-emerald-400/30 transition-colors hover:text-emerald-300"
            >
              {showSettings ? "Hide settings" : "Settings"}
            </button>
            {!showSettings && (
              <p className="font-mono text-xs text-emerald-100/60">{settingsSummary}</p>
            )}
          </div>

          {showSettings && (
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
                <p className="mt-1.5 text-xs text-emerald-100/60 max-w-lg">
                  {selfPlay
                    ? "Opponents set the split that is best against the field, found by iterated best response. The first solve per settings loads a precomputed policy or builds one (under a minute), then it is cached."
                    : "Opponents set their hands with a fixed rule of thumb."}
                </p>
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
                  <p className="mt-1.5 text-xs text-emerald-100/60 max-w-lg">
                    {mixing === "mixed"
                      ? "Opponents sample among their near-best splits, weighted by how little EV each gives up - closer to a real table."
                      : "Every opponent always finds their exact best split."}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={busy ? onCancel : onSolve}
              disabled={!busy && !full}
              className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-emerald-300 active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {busy ? "Cancel" : "Solve"}
            </button>
            <div className="flex-1 max-w-xs">
              <ProgressBar progress={lib.building ? lib.progress : progress} visible={busy} />
            </div>
            {lib.building && (
              <p className="text-xs text-emerald-100/60">Building opponent policy...</p>
            )}
          </div>

          {(error || lib.error) && <p className="text-sm text-red-400">{error ?? lib.error}</p>}
        </div>
      </div>

      {result && (
        <div className={glassCard}>
          <p className="font-mono text-sm text-emerald-100/90">
            {result.samples.toLocaleString("en-US")} scenarios vs {result.opponents}{" "}
            {result.opponents === 1 ? "opponent" : "opponents"},{" "}
            {result.boards === 1 ? "single board" : "double board"}, royalties{" "}
            {result.royalties ? "on" : "off"},{" "}
            {solvedModel === "selfplay" ? "self-play opponents" : "heuristic opponents"}. EV is
            net points per deal.
          </p>
          {libStats && libStats.length > 0 && (
            <div className="mt-2">
              <p className="font-mono text-xs text-emerald-100/60">
                Opponent policy: {libStats.length} rounds of best response over an
                opponent pool of{" "}
                {(solvedLibrary?.entries.length ?? LIBRARY_ENTRIES).toLocaleString("en-US")}{" "}
                hands. Each round's gain is what re-optimizing bought over the round before
                it, so a gain heading to zero means the policy has stopped improving.
              </p>
              <table className="mt-1.5 text-xs font-mono border-collapse">
                <thead>
                  <tr className="text-emerald-100/40">
                    <th className="text-left font-medium pr-4 py-0.5">Round</th>
                    <th className="text-right font-medium px-3 py-0.5">Gain over previous</th>
                    <th className="text-right font-medium pl-3 py-0.5">Same split</th>
                  </tr>
                </thead>
                <tbody>
                  {libStats.map((s) => (
                    <tr key={s.level} className="text-emerald-100/70">
                      <td className="pr-4 py-0.5">{s.level}</td>
                      <td className="text-right px-3 py-0.5 tabular-nums">
                        {Math.max(0, s.prevPolicyEvLoss).toFixed(2)} pts/deal
                      </td>
                      <td className="text-right pl-3 py-0.5 tabular-nums">
                        {s.agreePrevPct.toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {solvedLibrary && solvedLibrary.opponents !== result.opponents && (
                <p className="mt-1.5 font-mono text-xs text-emerald-100/50">
                  {result.royalties
                    ? `Policy trained vs ${solvedLibrary.opponents} opponents and reused here: ` +
                      "under royalties the best row wins collect from the whole table, so the " +
                      "best split does shift a little with table size. An approximation."
                    : `Policy trained vs ${solvedLibrary.opponents} ` +
                      `${solvedLibrary.opponents === 1 ? "opponent" : "opponents"} and reused ` +
                      "here, exactly: house rules settle each pair separately, so EV scales " +
                      "linearly with table size and the best split is the same at any size."}
                </p>
              )}
            </div>
          )}
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
                  <span className="font-normal text-emerald-100/50">{fmtErr(s.evStdErr)}</span>
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
            Any card may be set in any row. Opponent model: each opponent is dealt 7 random
            cards and sets them with a fixed heuristic (best Omaha material to the bottom).
            Points follow the scoring shown below.
          </p>
        </div>
      )}

      <ScoringExplainer royalties={royalties} boards={boards} />
    </div>
  );
};

export default TaiwaneseTab;
