// src/pages/multiwayPostflop/MultiwayResultView.tsx
//
// One multiway postflop solve, rendered the way /compare renders a single
// solver: the seat strip, the coloured action panels over their distribution
// bar, the 169 matrix, and the per-combo breakdown beside it.
//
// A COMPONENT rather than a page because /compare hosts it. The two payloads
// genuinely differ - /compare's own view is decoded from a binary .htc of
// per-node rows keyed by Pio-style node ids, which is what lets two solvers'
// grids be joined by node id and action label, while a multiway solve is a
// JSON node tree carrying 169-class rollups. Forcing one into the other's
// view model would mean rewriting htcDecode and compareLineNodes to lose
// information; hosting both render modes on one page costs a branch.
import { useCallback, useMemo, useState } from "react";
import ActionSummary from "@/pages/solver/ActionSummary";
import DecisionMatrix from "@/pages/solver/DecisionMatrix";
import HandBreakdown from "@/pages/solver/HandBreakdown";
import Line from "@/pages/solver/Line";
import { buildLineModel, lineHandlers } from "@/pages/multiway/lineModel";
import type { DumpNode, PushFoldDump } from "@/pages/multiway/pushfoldResult";
import { labellerFor, postflopGridFor } from "./postflopLabels";

const CARD_RE = /[2-9TJQKA][hdcs]/gi;

/** Chips to two places, with a sign so a loss reads as one. */
const fmtChips = (n: number): string => `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(2)}`;

const MultiwayResultView = ({ dump }: { dump: PushFoldDump }) => {
  const [path, setPath] = useState<number[]>([]);
  const [hand, setHand] = useState<string | null>(null);

  /* The dump's own labeller, bound once and handed to every shared helper.
     NOT the default jam/fold one, which collapses a three-action postflop
     node to a single "ALLIN" - see postflopLabels.ts. */
  const labeller = useMemo(() => labellerFor(dump), [dump]);
  /* /multiway's dump -> Line adapter, reused wholesale: it builds the seat
     cards, the per-seat bets and the rewind targets. Only the labeller
     differs. */
  const model = useMemo(() => buildLineModel(dump, path, labeller), [dump, path, labeller]);
  const handlers = useMemo(
    () => lineHandlers(dump, path, setPath, model.seatOf, labeller),
    [dump, path, model.seatOf, labeller]
  );
  const node: DumpNode | null = model.node ?? null;
  const grid = useMemo(
    () => (node && node.kind === "decision" ? postflopGridFor(dump, node) : null),
    [dump, node]
  );
  const seats = dump.metadata.seats ?? [];
  const board = useMemo(
    () => (dump.metadata.board ?? "").match(CARD_RE) ?? [],
    [dump.metadata.board]
  );
  /* Bet labels are percentages of THIS node's pot, the reference /compare
     uses, so "Bet 50" into 100 colours as a half-pot bet rather than as 50
     big blinds. */
  const potHere = node?.pot ?? dump.metadata.pot;

  const onActionClick = useCallback(
    (action: string) => {
      if (!node || node.kind !== "decision") return;
      const k = labeller(node).indexOf(action);
      if (k >= 0) setPath([...path, k]);
    },
    [node, labeller, path]
  );

  const evSum = dump.metadata.ev_chips.reduce((a, b) => a + b, 0);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {/* Root EV by seat is the headline: it is what a MonkerSolver comparison
          reads, and the sum against the pot is the first thing to check. */}
      <section className="shrink-0 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold text-slate-200">
            Root EV by seat
            {dump.metadata.board ? (
              <span className="ml-2 font-normal text-slate-500">{dump.metadata.board}</span>
            ) : null}
          </h2>
          <span className="text-[10px] tabular-nums text-slate-500">
            {dump.metadata.iterations.toLocaleString()} iters ·{" "}
            {dump.metadata.final_nashconv == null
              ? "no exploitability past 3 seats"
              : `exploitable ${(dump.metadata.final_nashconv / (seats.length || 1)).toFixed(4)} chips`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {dump.metadata.ev_chips.map((ev, i) => (
            <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                {seats[i] ?? `S${i}`}
              </div>
              <div className="tabular-nums text-sm text-emerald-300">{fmtChips(ev)}</div>
            </div>
          ))}
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Sum</div>
            <div className="tabular-nums text-sm text-slate-300">
              {fmtChips(evSum)}
              <span className="ml-1 text-[10px] text-slate-500">/ {dump.metadata.pot}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Seat strip + action panels. */}
      <section className="shrink-0 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-3 w-full min-w-0">
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

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {node && node.kind === "decision" ? (
            <span className="text-xs font-semibold text-slate-200">
              {seats[node.actor ?? 0] ?? `S${node.actor}`}{" "}
              {model.steps.length === 0 ? "opens" : "decides"} · pot {node.pot}
            </span>
          ) : (
            <span className="text-xs text-slate-400">
              {node?.terminal === "fold"
                ? "Everyone else folded - the hand ends here."
                : "Showdown."}
            </span>
          )}
          {path.length > 0 && (
            <button
              type="button"
              onClick={() => setPath([])}
              className="rounded border border-slate-700 px-2 py-0.5 text-[10px] hover:border-slate-500"
            >
              Back to root
            </button>
          )}
        </div>

        {grid && (
          <div className="mt-2">
            <ActionSummary
              data={grid}
              sizeRef={potHere}
              sizeUnit="pct"
              onActionClick={onActionClick}
            />
          </div>
        )}
      </section>

      {grid && (
        <section className="grid min-h-0 gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-2">
            <DecisionMatrix
              gridData={grid}
              randomFillEnabled={false}
              sizeRef={potHere}
              sizeUnit="pct"
              onHandSelect={setHand}
              onHandHover={setHand}
              selectedHand={hand ?? undefined}
            />
          </div>
          {/* No comboDetail: the watcher uploads `dump-json --fields rollup`,
              which drops the per-hand rows to keep the payload small, so every
              combo of a class shows the class strategy. Postflop that is a real
              simplification - blockers make Ah5h a different hand from Ac5c -
              and the panel shows it by rendering identical tiles. Per-combo
              data means dropping --fields rollup, at ~27x the payload. */}
          <HandBreakdown
            data={grid}
            hand={hand}
            board={board}
            sizeRef={potHere}
            sizeUnit="pct"
            chipEv={false}
            className="min-h-[18rem]"
          />
        </section>
      )}
    </div>
  );
};

export default MultiwayResultView;
