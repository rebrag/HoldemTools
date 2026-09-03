// src/pages/multiway/PushFoldResultPanel.tsx
//
// The finished push/fold charts, rendered from the artifact's own 169-class
// rollup through the same DecisionMatrix the /solutions and /compare views
// use. Nothing new is invented here: ALLIN and Fold are already first-class
// action names with colours in lib/solver/constants.
//
// Navigation is the solver's Line strip: one card per seat in acting order,
// each listing that seat's options, so a jam/fold tree is walked the way the
// /solutions sims are - click an option to take it, click a seat's card to
// put that seat back on the spot. The line itself lives on the page (it also
// drives the table), so this panel is handed the model and a setter.
import { useMemo } from "react";
import type { MoneyOpts } from "@/pages/solver/boardDisplay";
import DecisionMatrix from "@/pages/solver/DecisionMatrix";
import Line from "@/pages/solver/Line";
import { lineHandlers, type LineModel } from "./lineModel";
import PartnerHandSelect from "./PartnerHandSelect";
import {
  actionPct,
  conditionedGridFor,
  fmtCount,
  gridFor,
  settingsRows,
  type PushFoldDump,
} from "./pushfoldResult";

const chip =
  "rounded-full border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[10px] text-slate-300";

const PushFoldResultPanel = ({
  dump,
  model,
  path,
  onPathChange,
  partnerClass,
  onPartnerClassChange,
  className = "",
  onOpenBaseline,
}: {
  dump: PushFoldDump;
  /** The line as the page walks it: seats, options, who is on the spot. */
  model: LineModel;
  path: number[];
  onPathChange: (path: number[]) => void;
  /** Conditioned viewer: the partner hand class the team charts are
   *  conditioned on; null = the partner-averaged marginal. */
  partnerClass: number | null;
  onPartnerClassChange: (partnerClass: number | null) => void;
  /** The page hands this a definite height. Everything below is sized from
   *  it - see the grid wrapper's comment. */
  className?: string;
  /** Unaware team results only: queue the no-team solve of this spot that
   *  resumes the baseline the opponents were frozen at. Undefined while a
   *  solve is running, which disables the control. */
  onOpenBaseline?: () => void;
}) => {
  const meta = dump.metadata;
  // Memoized because the `?? []` fallback is a fresh array every render, which
  // would make every useMemo keyed on it recompute.
  const seats = useMemo(() => meta.seats ?? [], [meta.seats]);
  // The rollup's EVs are chips; the tooltip quotes big blinds, so it has to
  // be told the blind. Without this a 6.9-chip EV read "6.9 bb".
  const money = useMemo<MoneyOpts>(
    () => ({ mode: "bb", bbSize: meta.chip_scale > 0 ? meta.chip_scale : 1 }),
    [meta.chip_scale]
  );

  const { steps, node } = model;
  const handlers = useMemo(
    () => lineHandlers(dump, path, onPathChange, model.seatOf),
    [dump, path, onPathChange, model.seatOf]
  );

  const spot = useMemo(() => {
    const pf = meta.preflop;
    const stacks = meta.stacks;
    if (!pf || !stacks?.length) return null;
    const smallest = Math.min(...stacks);
    const depth = pf.big_blind > 0 ? smallest / pf.big_blind : NaN;
    const same = stacks.every((s) => s === stacks[0]);
    const sizes = same
      ? `${stacks[0]} each`
      : stacks.map((s, i) => `${seats[i] ?? i} ${s}`).join(", ");
    return `${seats.length}-way jam/fold · blinds ${pf.small_blind}/${pf.big_blind} · ${sizes}` +
      (Number.isFinite(depth) ? ` (${depth.toFixed(1)} bb)` : "") +
      ` · button ${seats[pf.button] ?? pf.button}`;
  }, [meta, seats]);

  const teamRollup =
    node && node.kind === "decision" && meta.team && meta.team_rollup
      ? meta.team_rollup[String(node.node_id)]
      : undefined;
  const grid = useMemo(() => {
    if (!node || node.kind !== "decision") return [];
    if (teamRollup && partnerClass != null) {
      return conditionedGridFor(node, teamRollup, partnerClass);
    }
    return gridFor(node);
  }, [node, teamRollup, partnerClass]);
  const rows = useMemo(() => settingsRows(meta), [meta]);
  const jamPct = node && node.kind === "decision" ? actionPct(node, "ALLIN") : 0;
  const actorName = node?.actor != null ? seats[node.actor] ?? `P${node.actor}` : null;

  return (
    <section
      className={`flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3 ${className}`}
    >
      {/* What spot this actually is, read off the artifact rather than the
          builder. Opening a past solve now moves the builder onto it too
          (MultiwaySolver's loadResult -> viewFromDump), so this line and the
          table agree; it is still stated here because the artifact is the
          authority on its own spot, and a chart that cannot name its blinds
          and stacks is not much of a chart. */}
      {spot && <p className="shrink-0 text-[11px] text-slate-300">{spot}</p>}

      {/* Per-seat root EV, which is what the whole solve is for. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
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
        {meta.final_nashconv != null && (
          <span
            className={chip}
            title="Per-player exploitability of the solved strategy, in chips."
          >
            exploitable {(meta.final_nashconv / 2 / Math.max(1, seats.length)).toExponential(1)}
          </span>
        )}
        {meta.team && (
          <span
            className={`${chip} border-amber-800 text-amber-300`}
            title={
              meta.team.awareness === "unaware"
                ? "The pair shares hole cards and maximizes summed EV against opponents frozen at the no-team baseline."
                : "The pair shares hole cards and maximizes summed EV; opponents know and adapt."
            }
          >
            team {meta.team.seats.map((s) => seats[s] ?? s).join("+")}{" "}
            <span className="tabular-nums">
              {meta.team.ev_chips >= 0 ? "+" : ""}
              {meta.team.ev_chips.toFixed(3)}
            </span>
            {meta.team.uplift_chips != null && (
              <span className="tabular-nums text-slate-400">
                {" "}
                (uplift {meta.team.uplift_chips >= 0 ? "+" : ""}
                {meta.team.uplift_chips.toFixed(3)})
              </span>
            )}{" "}
            · {meta.team.awareness}
          </span>
        )}
        {/* With a team this count is the TEAM phase only, and the baseline is
            a separate budget - saying just "N iters" made the two
            indistinguishable on a finished solve. */}
        <span
          className={chip}
          title={
            meta.team
              ? "Iterations of the team phase (phase 2). The baseline phase is budgeted separately - see Settings below."
              : "Iterations completed."
          }
        >
          {fmtCount(meta.iterations)} {meta.team ? "team iters" : "iters"}
          {meta.team?.baseline_iterations != null && (
            <span className="text-slate-500">
              {" "}
              · {fmtCount(meta.team.baseline_iterations)} baseline
            </span>
          )}
        </span>
        {meta.solve_id && (
          <span
            className={chip}
            title="The solve lineage. Re-solving this spot with this id continues it from where it stopped rather than starting over."
          >
            solve <span className="text-slate-200">{meta.solve_id}</span>
          </span>
        )}
        {/* The baseline the opponents were frozen at is a solve of its own -
            the spot with no team - and this is the way to look at it. */}
        {meta.team?.awareness === "unaware" && meta.team.baseline_iterations != null && (
          <button
            type="button"
            onClick={onOpenBaseline}
            disabled={!onOpenBaseline}
            className={`${chip} transition-colors enabled:hover:border-emerald-600 enabled:hover:text-emerald-300 disabled:cursor-default disabled:opacity-60`}
            title={
              "Open the no-team baseline the opponents play here as a result of its own. " +
              "It queues a no-team solve of this spot at the baseline's iteration count, " +
              "which continues the saved baseline, iterates nothing, and exports it - " +
              "a short job, and afterwards a row in Recent."
            }
          >
            open baseline
            {meta.team.baseline_solve_id && (
              <>
                {" "}
                <span className="text-slate-200">{meta.team.baseline_solve_id}</span>
              </>
            )}
          </button>
        )}
        {/* Both early stops say the same thing about the numbers - a real
            solve, just less converged than asked for - and differ only in who
            stopped it. Neither is a failure or a partial file. */}
        {(meta.stopped_reason === "time_budget" || meta.stopped_reason === "cancelled") && (
          <span
            className={`${chip} ${
              meta.stopped_reason === "cancelled"
                ? "border-amber-800 text-amber-300"
                : "border-sky-800 text-sky-300"
            }`}
            title={
              (meta.stopped_reason === "cancelled"
                ? "You stopped this solve. It wrote its checkpoint and exported the " +
                  "artifact for the iterations it had completed, so it can be continued " +
                  "later by re-solving under the same solve id. "
                : "The solve hit its wall-clock ceiling and wrote what it had rather than " +
                  "being discarded. ") +
              "Everything shown is a real solve, just less converged " +
              (meta.requested_iterations
                ? `than the ${fmtCount(meta.requested_iterations)} iterations requested.`
                : "than requested.")
            }
          >
            {meta.stopped_reason === "cancelled" ? "stopped by you" : "stopped on time budget"}
          </span>
        )}
      </div>

      {/* The chart and its notes side by side from lg up - the same breakpoint
          at which the page becomes a fixed-height workbench, and therefore
          exactly where bounding the grid by HEIGHT (below) hands back most of
          the pane's width. The caveats are what should have that width:
          stacked underneath they were the reason the panel ran a full screen
          past the fold.
          Every min-h-0/flex-1 here is lg-and-up on purpose: they exist to
          DIVIDE a fixed height, and below lg there is none to divide. Applied
          unconditionally they let this column shrink under its own grid, which
          then paints over the notes. */}
      <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:flex-row">
        <div className="flex flex-col gap-1.5 lg:min-h-0 lg:flex-1">
          {/* The line: one card per seat in acting order. Clicking an option
              takes it wherever that seat's decision is - ahead of the spot
              (everyone between folds first) or behind it (the line rewinds
              there) - and clicking a card puts that seat on the spot. */}
          <div className="w-full min-w-0 shrink-0">
            <Line
              line={model.line}
              positions={model.positions}
              activePlayer={model.activePlayer}
              plateData={model.plateData}
              plateMapping={model.plateMapping}
              playerBets={model.playerBets}
              alivePlayers={model.alivePlayers}
              onActionClick={handlers.onActionClick}
              onSkipToSeat={handlers.onSkipToSeat}
              onRewindTo={handlers.onRewindTo}
            />
          </div>
          {node && node.kind === "decision" ? (
            <>
              <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200">
                  {actorName} {steps.length === 0 ? "opens" : "decides"} · pot {node.pot}
                </span>
                <span className="text-[11px] tabular-nums text-emerald-400">
                  {jamPct.toFixed(1)}% of combos jam
                </span>
              </div>
              {teamRollup && (
                <PartnerHandSelect
                  rollup={teamRollup}
                  partnerLabel={seats[teamRollup.partner] ?? `P${teamRollup.partner}`}
                  value={partnerClass}
                  onChange={onPartnerClassChange}
                />
              )}
              {/* DecisionMatrix is w-full aspect-square and its className cannot
                  be overridden through the spread, so the only way to bound it by
                  height is a wrapper whose width comes FROM its height - the same
                  trick /compare uses. Without it the grid takes the pane's full
                  width and runs hundreds of pixels below the fold.
                  Only from lg, though: that is where the page becomes a
                  fixed-height workbench. Below it the page scrolls and there is no
                  height budget to divide, so a height-driven square would collapse
                  to a few unreadable pixels - the grid stays width-driven there. */}
              <div className="flex justify-center lg:min-h-0 lg:flex-1">
                <div className="w-full lg:aspect-square lg:h-full lg:w-auto lg:max-w-full">
                  <DecisionMatrix gridData={grid} heightMode="full" money={money} />
                </div>
              </div>
            </>
          ) : (
            <p className="flex items-center justify-center px-2 py-6 text-center text-[11px] text-slate-500 lg:min-h-0 lg:flex-1">
              {node?.terminal === "showdown"
                ? "Everyone left is all-in - the hand runs out from here."
                : "Everyone else folded, so the hand is over."}{" "}
              Click a seat above to go back to its decision.
            </p>
          )}
        </div>

        {/* The caveats, on screen rather than only in the artifact. A chart
            that does not say what it approximated is a chart nobody can
            check - so this is a rail beside the grid, not a block under it,
            and it scrolls itself rather than growing the panel. */}
        <ul className="shrink-0 border-t border-slate-800 pt-2 text-[10px] leading-relaxed text-slate-500 lg:w-[16rem] lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0 xl:w-[20rem]">
        {seats.length > 2 && meta.solver_family === "sampled" && (
          <li>
            Solved by dealing: every iteration deals one hand per seat plus a real board, so
            card removal between every pair of seats is exact and the strategy conserves chips
            by construction. The EVs shown ride a fixed-board measuring evaluator, which is why
            they sum to {(meta.ev_chips ?? []).reduce((a, b) => a + b, 0).toFixed(3)} instead
            of 0 - that residual belongs to the measurement, not the strategy.
          </li>
        )}
        {seats.length > 2 && meta.solver_family !== "sampled" && (
          <li>
            Card removal between you and each opponent is exact. Between opponents it is exact
            for the profile weighting and approximate for the showdown itself, so the root EVs
            sum to {(meta.ev_chips ?? []).reduce((a, b) => a + b, 0).toFixed(3)} instead of 0 -
            that number is what is left of it.
          </li>
        )}
        {meta.multiway_no_nash_guarantee && (
          <li>
            With three or more players CFR has no Nash guarantee - it converges to the coarse
            correlated equilibrium set, and several equilibria may exist with no principled way to
            pick between them. Read these as a strong strategy, not a proven one.
          </li>
        )}
        {meta.hand_symmetry === "suit_classes_169" ? (
          <li>
            Strategies are per hand class: preflop no infoset can tell suits apart, so the 169
            classes are exactly the suit orbits and merging them is a relabeling the game itself
            makes - not bucketing. It also pools every member combo{"'"}s samples into one row,
            which is where the variance reduction comes from.
          </li>
        ) : (
          <li>
            Every one of the 1326 combos carries its own strategy; the 13x13 grid is display
            aggregation, not bucketing.
          </li>
        )}
        </ul>
      </div>

      {/* Everything the solve actually ran with. Read from the artifact's own
          config rather than the builder: opening a past solve must show what
          THAT solve used, and the builder has since been edited. Collapsed by
          default - it answers a question you only ask sometimes, but when you
          ask it you want all of it, hence the raw config underneath the
          readable rows. */}
      <details className="border-t border-slate-800 pt-2">
        <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-200">
          Settings used
        </summary>
        <dl className="mt-2 grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-3 gap-y-1 text-[10px]">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-slate-500">{row.label}</dt>
              {/* break-all, or the 64-char config hash makes the whole panel
                  scroll sideways. */}
              <dd className="min-w-0 break-all tabular-nums text-slate-300">
                {row.value}
                {row.note && <span className="ml-1.5 text-slate-500">({row.note})</span>}
              </dd>
            </div>
          ))}
        </dl>
        {meta.config && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-300">
              Raw engine config
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded border border-slate-800 bg-slate-950/60 p-2 text-[10px] leading-relaxed text-slate-400">
              {JSON.stringify(meta.config, null, 2)}
            </pre>
          </details>
        )}
      </details>
    </section>
  );
};

export default PushFoldResultPanel;
