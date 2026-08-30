// src/pages/multiway/PushFoldResultPanel.tsx
//
// The finished push/fold charts, rendered from the artifact's own 169-class
// rollup through the same DecisionMatrix the /solutions and /compare views
// use. Nothing new is invented here: ALLIN and Fold are already first-class
// action names with colours in lib/solver/constants.
//
// Navigation is a line walk rather than a node list. A jam/fold tree is a
// binary tree of depth `players`, so "who acts next, and what did the seat
// before them do" is the only question, and a breadcrumb answers it in the
// language a player already uses.
import { useMemo, useState } from "react";
import DecisionMatrix from "@/pages/solver/DecisionMatrix";
import {
  actionLabels,
  actionPct,
  gridFor,
  walkLine,
  type PushFoldDump,
} from "./pushfoldResult";

const chip =
  "rounded-full border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[10px] text-slate-300";

const PushFoldResultPanel = ({ dump }: { dump: PushFoldDump }) => {
  const [path, setPath] = useState<number[]>([]);
  const meta = dump.metadata;
  const seats = meta.seats ?? [];

  const { steps, node } = useMemo(() => walkLine(dump, path), [dump, path]);

  const grid = useMemo(
    () => (node && node.kind === "decision" ? gridFor(node) : []),
    [node]
  );
  const labels = node && node.kind === "decision" ? actionLabels(node) : [];
  const jamPct = node && node.kind === "decision" ? actionPct(node, "ALLIN") : 0;
  const actorName = node?.actor != null ? seats[node.actor] ?? `P${node.actor}` : null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      {/* Per-seat root EV, which is what the whole solve is for. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-200">Root EV</span>
        {seats.map((name, i) => {
          const ev = meta.ev_chips?.[i] ?? 0;
          return (
            <span key={name + i} className={chip}>
              {name}{" "}
              <span
                className={`tabular-nums ${ev >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {ev >= 0 ? "+" : ""}
                {ev.toFixed(3)}
              </span>
            </span>
          );
        })}
        <span className={chip} title="Per-player exploitability of the solved strategy, in chips.">
          exploitable {(meta.final_nashconv / 2 / Math.max(1, seats.length)).toExponential(1)}
        </span>
        <span className={chip}>{meta.iterations} iters</span>
      </div>

      {/* Breadcrumb: the line that led to the node on screen. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPath([])}
          className={`${chip} ${path.length === 0 ? "border-emerald-600 text-emerald-300" : "hover:border-slate-500"}`}
        >
          Start
        </button>
        {steps.map((step, i) => (
          <button
            key={`${step.node.node_id}-${i}`}
            type="button"
            onClick={() => setPath(path.slice(0, i + 1))}
            className={`${chip} hover:border-slate-500`}
          >
            {seats[step.seat] ?? `P${step.seat}`} {step.label === "ALLIN" ? "jams" : "folds"}
          </button>
        ))}
      </div>

      {node && node.kind === "decision" ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-slate-200">
              {actorName} {steps.length === 0 ? "opens" : "decides"} · pot {node.pot}
            </span>
            <span className="text-[11px] tabular-nums text-emerald-400">
              {jamPct.toFixed(1)}% of combos jam
            </span>
          </div>
          <DecisionMatrix gridData={grid} heightMode="full" />
          <div className="flex flex-wrap gap-2">
            {labels.map((label, i) => {
              const child = dump.nodes[String((node.first_child ?? 0) + i)];
              const leaf = child?.kind !== "decision";
              return (
                <button
                  key={label}
                  type="button"
                  disabled={leaf}
                  onClick={() => setPath([...path, i])}
                  title={
                    leaf
                      ? child?.terminal === "showdown"
                        ? "The hand is all-in - no more decisions."
                        : "Everyone else folded - the hand is over."
                      : undefined
                  }
                  className={`${chip} px-3 py-1 ${leaf ? "opacity-40" : "hover:border-emerald-600 hover:text-emerald-300"}`}
                >
                  {label === "ALLIN" ? "All-in" : "Fold"}
                  {leaf ? " (ends the hand)" : ""}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <p className="px-2 py-6 text-center text-[11px] text-slate-500">
          {node?.terminal === "showdown"
            ? "Everyone left is all-in - the hand runs out from here."
            : "Everyone else folded, so the hand is over."}{" "}
          Step back up the line to see another decision.
        </p>
      )}

      {/* The caveats, on screen rather than only in the artifact. A chart that
          does not say what it approximated is a chart nobody can check. */}
      <ul className="border-t border-slate-800 pt-2 text-[10px] leading-relaxed text-slate-500">
        {meta.board_sample && (
          <li>
            Board runouts: {meta.board_sample.pair_count.toLocaleString()} sampled for the exact
            heads-up equity matrix, {meta.board_sample.iter_count.toLocaleString()} averaged per
            iteration where three or more seats reach showdown. Seed {meta.board_sample.seed}, so
            this result is reproducible.
          </li>
        )}
        {meta.opponent_card_removal === "hero_only" && seats.length > 2 && (
          <li>
            Card removal is exact between your hand and each opponent, and dropped BETWEEN
            opponents at three or more seats. That is what the root EVs summing to{" "}
            {(meta.ev_chips ?? []).reduce((a, b) => a + b, 0).toFixed(3)} instead of 0 measures.
          </li>
        )}
        {meta.multiway_no_nash_guarantee && (
          <li>
            With three or more players CFR has no Nash guarantee - it converges to the coarse
            correlated equilibrium set, and several equilibria may exist with no principled way to
            pick between them. Read these as a strong strategy, not a proven one.
          </li>
        )}
        <li>
          Every one of the 1326 combos carries its own strategy; the 13x13 grid is display
          aggregation, not bucketing.
        </li>
      </ul>
    </section>
  );
};

export default PushFoldResultPanel;
