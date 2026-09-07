// src/pages/multiwayPostflop/MultiwayPostflopSolver.tsx
//
// Multiway POSTFLOP (engine M8b): 3 to 9 seats on one board, with side pots.
//
// URL-only, like /multiway - no NavBar slot. The tree builder lives in a
// drawer whose header is EngineCoreTabs, so the page says which of the three
// solvers it feeds before it says anything else.
//
// It renders the SAME payload /multiway does - `rollup_169` per decision node
// plus `metadata.ev_chips` - because the engine writes that for any seat count
// and the watcher uploads it unchanged. That is why this page reuses
// pushfoldResult's decoding wholesale rather than owning a schema: the 169
// rollup is export-only aggregation, and the schema-4 bundle path is heads-up
// by construction (manifest.seats is {oop, ip}) and correctly refuses an
// N-seat artifact.
//
// The seat count picks the engine core, and the page says so rather than
// hiding it: three seats solve exactly and report exploitability, four and up
// deal concrete cards and report none, because the vectorized showdown sweep
// has no O(H) form past three seats.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CardPicker from "@/components/CardPicker";
import EngineCoreTabs from "@/components/EngineCoreTabs";
import PlayingCard from "@/components/PlayingCard";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import { authedFetch } from "@/lib/api";
import DecisionMatrix from "@/pages/solver/DecisionMatrix";
import {
  ago,
  isOpenable,
  STATUS_TONE,
  TERMINAL,
  type CompareJob,
} from "@/pages/multiway/compareJob";
import { fetchPushFoldDump } from "@/pages/multiway/fetchPushFoldDump";
import type { DumpNode, PushFoldDump } from "@/pages/multiway/pushfoldResult";
import { postflopActionLabels, postflopGridFor, postflopWalkLine } from "./postflopLabels";
import {
  boardCards,
  buildConfig,
  defaultView,
  EXACT_SEAT_LIMIT,
  FULL_RANGE,
  MAX_SEATS,
  MIN_SEATS,
  randomBoard,
  seatCount,
  spr,
  usesSampledCore,
  validate,
  withSeats,
  type MultiwayPostflopView,
} from "./postflopConfig";

const inputCls =
  "rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 " +
  "outline-none focus:border-sky-500";
const labelCls = "text-[10px] uppercase tracking-wide text-slate-500";

/** Chips, to one decimal, with a sign so a loss reads as one. */
const fmtChips = (n: number): string => `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(2)}`;

const MultiwayPostflopSolver = () => {
  const [view, setView] = useState<MultiwayPostflopView>(defaultView);
  const [builderOpen, setBuilderOpen] = useState(true);
  const [solving, setSolving] = useState(false);
  const [job, setJob] = useState<CompareJob | null>(null);
  const [dump, setDump] = useState<PushFoldDump | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<number | null>(null);

  const seats = seatCount(view);
  const sampled = usesSampledCore(view);
  const issue = validate(view);
  const cards = boardCards(view.board);

  const set = useCallback(
    <K extends keyof MultiwayPostflopView>(key: K, value: MultiwayPostflopView[K]) =>
      setView((v) => ({ ...v, [key]: value })),
    []
  );

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const solve = useCallback(async () => {
    setError(null);
    setDump(null);
    setPath([]);
    setJob(null);
    setSolving(true);
    setElapsed(0);
    const started = Date.now();
    const tick = window.setInterval(() => setElapsed(Date.now() - started), 500);
    try {
      const create = await authedFetch("/api/enginecompare", {
        method: "POST",
        body: JSON.stringify({
          config: buildConfig(view),
          mode: "multiway",
          pioAccuracyPct: 0.02,
          disablePio: true,
          disableCompare: true,
          disableCrossCheck: true,
        }),
      });
      if (!create.ok) throw new Error((await create.text()) || `Queue failed (${create.status})`);
      let current = (await create.json()) as CompareJob;
      setJob(current);
      setBuilderOpen(false);

      // Poll until the watcher finishes. Same cadence /multiway uses: a
      // multiway postflop solve is seconds to minutes, not hours.
      while (!TERMINAL.includes(current.status)) {
        await new Promise((r) => window.setTimeout(r, 1500));
        const poll = await authedFetch(`/api/enginecompare/${current.id}`);
        if (!poll.ok) throw new Error(`Poll failed (${poll.status})`);
        current = (await poll.json()) as CompareJob;
        setJob(current);
      }
      if (current.status === "Failed") {
        throw new Error(current.error || "The solve failed on the watcher.");
      }
      if (!isOpenable(current)) throw new Error("The job finished with no result to open.");
      setDump(await fetchPushFoldDump(current.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      window.clearInterval(tick);
      setSolving(false);
    }
  }, [view]);

  const line = useMemo(() => (dump ? postflopWalkLine(dump, path) : null), [dump, path]);
  const node: DumpNode | null = line?.node ?? null;
  // NOT pushfoldResult's gridFor/actionLabels: those assume a jam/fold tree
  // and collapse a three-action postflop node to one label - see
  // postflopLabels.ts.
  const grid = useMemo(
    () => (dump && node && node.kind === "decision" ? postflopGridFor(dump, node) : null),
    [dump, node]
  );
  const labels = useMemo(
    () => (dump && node && node.kind === "decision" ? postflopActionLabels(dump, node) : []),
    [dump, node]
  );
  const seatNames = dump?.metadata.seats ?? view.seats;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-3 px-3 py-4 text-slate-200">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Multiway postflop solver</h1>
          <p className="text-[11px] text-slate-500">
            {seats}-way {cards.length === 5 ? "river" : cards.length === 4 ? "turn" : "flop"} ·
            pot {view.potChips} · SPR {spr(view).toFixed(1)} ·{" "}
            {sampled ? "sampled core" : "exact (vectorized)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setBuilderOpen(true)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:border-slate-500"
          >
            Tree setup
          </button>
          <button
            type="button"
            disabled={solving || !!issue}
            onClick={() => void solve()}
            title={issue ?? undefined}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white
                       disabled:cursor-not-allowed disabled:opacity-40 hover:bg-sky-500"
          >
            {solving ? `Solving… ${(elapsed / 1000).toFixed(0)}s` : "Solve"}
          </button>
        </div>
      </header>

      {(error || issue) && (
        <p className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          {error ?? issue}
        </p>
      )}

      {job && (
        <p className="text-[11px] text-slate-500">
          <span className={STATUS_TONE[job.status]}>{job.status}</span>
          {job.board ? ` · ${job.board}` : ""}
          {job.createdAtUtc ? ` · ${ago(job.createdAtUtc)}` : ""}
        </p>
      )}

      {dump && (
        <>
          {/* The EV table is the MonkerSolver diff: per-seat root EV in chips,
              which conserves to the pot exactly at any seat count. */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold text-slate-200">Root EV by seat</h2>
              <span className="text-[10px] tabular-nums text-slate-500">
                {dump.metadata.iterations.toLocaleString()} iters ·{" "}
                {dump.metadata.final_nashconv == null
                  ? "no exploitability past 3 seats"
                  : `exploitable ${(
                      dump.metadata.final_nashconv / (dump.metadata.seats.length || 1)
                    ).toFixed(4)} chips`}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {dump.metadata.ev_chips.map((ev, i) => (
                <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    {seatNames[i] ?? `S${i}`}
                  </div>
                  <div className="tabular-nums text-sm text-emerald-300">{fmtChips(ev)}</div>
                </div>
              ))}
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Sum</div>
                <div className="tabular-nums text-sm text-slate-300">
                  {fmtChips(dump.metadata.ev_chips.reduce((a, b) => a + b, 0))}
                  <span className="ml-1 text-[10px] text-slate-500">/ {dump.metadata.pot}</span>
                </div>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              Root EVs sum to the pot exactly at every seat count - that is the utility
              convention, and it is the first thing to check against another solver.
            </p>
          </section>

          {/* The line walked so far, and what can be done next. */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <button
                type="button"
                onClick={() => setPath([])}
                className="rounded border border-slate-700 px-2 py-0.5 hover:border-slate-500"
              >
                Root
              </button>
              {line?.steps.map((step, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPath(path.slice(0, i + 1))}
                  className="rounded border border-slate-700 px-2 py-0.5 hover:border-slate-500"
                >
                  {seatNames[step.seat] ?? `S${step.seat}`} {step.label}
                </button>
              ))}
            </div>
            {node && node.kind === "decision" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  {seatNames[node.actor ?? 0] ?? `S${node.actor}`} to act
                </span>
                {labels.map((label, k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setPath([...path, k])}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-xs hover:border-sky-500"
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-slate-500">
                {node?.terminal === "fold"
                  ? "Everyone else folded - the hand ends here."
                  : "Showdown."}
              </p>
            )}
          </section>

          {grid && (
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-2">
              <DecisionMatrix gridData={grid} randomFillEnabled={false} />
            </section>
          )}
        </>
      )}

      {!dump && !solving && (
        <p className="rounded-xl border border-dashed border-slate-800 px-4 py-10 text-center text-xs text-slate-500">
          Set the tree up, then solve. Results render the same 169-class chart the multiway
          preflop page uses.
        </p>
      )}

      <ResponsiveDrawer
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        scrollMode="custom"
        desktopMaxWidthClassName="sm:max-w-3xl"
        zClassName="z-[70]"
        ariaLabel="Multiway postflop tree builder"
      >
        <div className="flex h-[88vh] max-h-[88vh] flex-col">
          {/* The engine-core tabs ARE this drawer's header, exactly as on
              /multiway and /compare: they name which solver this tree feeds. */}
          <div className="border-b border-slate-800 px-4 py-3 pr-12">
            <EngineCoreTabs value="multiwayPostflop" />
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {/* ---- Board ---- */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-semibold text-slate-200">Board</h2>
                <div className="flex gap-1">
                  {[3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => set("board", randomBoard(n))}
                      className="rounded border border-slate-700 px-2 py-0.5 text-[10px] hover:border-slate-500"
                    >
                      Random {n === 3 ? "flop" : n === 4 ? "turn" : "river"}
                    </button>
                  ))}
                  {cards.length > 0 && (
                    <button
                      type="button"
                      onClick={() => set("board", "")}
                      className="rounded border border-slate-700 px-2 py-0.5 text-[10px] hover:border-slate-500"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="mb-2 flex min-h-[3rem] flex-wrap items-center gap-1">
                {cards.length === 0 ? (
                  <span className="text-[11px] text-slate-500">Pick 3, 4 or 5 cards.</span>
                ) : (
                  cards.map((c) => <PlayingCard key={c} code={c} size="sm" />)
                )}
              </div>
              {cards.length < 5 && (
                <CardPicker
                  used={new Set(cards.map((c) => c.toLowerCase()))}
                  onPick={(code) => set("board", [...cards, code].join(" "))}
                />
              )}
            </section>

            {/* ---- Seats, pot, stacks ---- */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-semibold text-slate-200">Seats and money</h2>
                <span className="text-[10px] tabular-nums text-emerald-400">
                  SPR {spr(view).toFixed(1)}
                </span>
              </div>
              <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Players</span>
                  <input
                    type="number"
                    min={MIN_SEATS}
                    max={MAX_SEATS}
                    value={seats}
                    onChange={(e) => setView((v) => withSeats(v, Number(e.target.value)))}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Pot</span>
                  <input
                    type="number"
                    min={1}
                    value={view.potChips}
                    onChange={(e) => set("potChips", Number(e.target.value))}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Stack (all seats)</span>
                  <input
                    type="number"
                    min={1}
                    value={view.stacks[0]}
                    onChange={(e) =>
                      set("stacks", view.stacks.map(() => Number(e.target.value)))
                    }
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {view.stacks.map((stack, i) => (
                  <label key={i} className="flex flex-col gap-1">
                    <span className={labelCls}>{view.seats[i]} stack</span>
                    <input
                      type="number"
                      min={1}
                      value={stack}
                      onChange={(e) =>
                        set(
                          "stacks",
                          view.stacks.map((s, j) => (j === i ? Number(e.target.value) : s))
                        )
                      }
                      className={`${inputCls} tabular-nums`}
                    />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                Unequal stacks are fine: a call is capped at the caller's own stack and the
                side pot it creates is resolved by layer.
              </p>
            </section>

            {/* ---- Sizings ---- */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <h2 className="mb-2 text-xs font-semibold text-slate-200">Bet sizing</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Bets (% pot)</span>
                  <input
                    value={view.betPcts.join(",")}
                    onChange={(e) =>
                      set(
                        "betPcts",
                        e.target.value
                          .split(",")
                          .map((t) => Number(t.trim()))
                          .filter((n) => Number.isFinite(n) && n > 0)
                      )
                    }
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Raises (% pot)</span>
                  <input
                    value={view.raisePcts.join(",")}
                    onChange={(e) =>
                      set(
                        "raisePcts",
                        e.target.value
                          .split(",")
                          .map((t) => Number(t.trim()))
                          .filter((n) => Number.isFinite(n) && n > 0)
                      )
                    }
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Max raises</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={view.maxRaises}
                    onChange={(e) => set("maxRaises", Number(e.target.value))}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Shove</span>
                  <button
                    type="button"
                    onClick={() => set("shove", !view.shove)}
                    className={`rounded-lg border px-2 py-1 text-xs ${
                      view.shove
                        ? "border-emerald-600 bg-emerald-950/40 text-emerald-300"
                        : "border-slate-700 text-slate-400"
                    }`}
                  >
                    {view.shove ? "Offered" : "Off"}
                  </button>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>All-in at</span>
                  <input
                    type="number"
                    min={0.1}
                    max={1.5}
                    step={0.05}
                    value={view.allinThreshold}
                    onChange={(e) => set("allinThreshold", Number(e.target.value))}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                Shove is derived, not typed: bets are a percentage of POT but an all-in is a
                fraction of the STACK, so at SPR {spr(view).toFixed(1)} a jam is{" "}
                {Math.ceil((100 * Math.max(...view.stacks)) / Math.max(1, view.potChips))}% of
                pot and would stop being one the moment the stack or pot moved. Leaving it on
                gives every seat a true jam at every depth.
              </p>
            </section>

            {/* ---- Ranges and budget ---- */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-semibold text-slate-200">Ranges and budget</h2>
                <button
                  type="button"
                  onClick={() => set("ranges", view.seats.map(() => FULL_RANGE))}
                  className="rounded border border-slate-700 px-2 py-0.5 text-[10px] hover:border-slate-500"
                >
                  All 100%
                </button>
              </div>
              <div className="mb-2 grid gap-2">
                {view.ranges.map((range, i) => (
                  <label key={i} className="flex flex-col gap-1">
                    <span className={labelCls}>
                      {view.seats[i]} range{" "}
                      {range === FULL_RANGE ? (
                        <span className="text-emerald-500">100%</span>
                      ) : null}
                    </span>
                    <textarea
                      rows={2}
                      value={range}
                      onChange={(e) =>
                        set(
                          "ranges",
                          view.ranges.map((r, j) => (j === i ? e.target.value : r))
                        )
                      }
                      className={`${inputCls} font-mono text-[10px]`}
                    />
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className={labelCls}>Iterations</span>
                  <input
                    type="number"
                    min={1}
                    value={view.iterations}
                    onChange={(e) => set("iterations", Number(e.target.value))}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
                {sampled && (
                  <label className="flex flex-col gap-1">
                    <span className={labelCls}>Seed</span>
                    <input
                      type="number"
                      value={view.seed}
                      onChange={(e) => set("seed", Number(e.target.value))}
                      className={`${inputCls} tabular-nums`}
                    />
                  </label>
                )}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {sampled
                  ? `${seats} seats is past the ${EXACT_SEAT_LIMIT}-seat limit of the vectorized showdown, so this runs on the sampled core: iterations are DEALS, chips still conserve exactly, and there is no exploitability number to stop on.`
                  : `${seats} seats still has an exact vectorized showdown, so this solve is exact and reports exploitability.`}
              </p>
            </section>

            <div className="flex items-center justify-end gap-2 pb-2">
              {issue && <span className="text-[11px] text-red-300">{issue}</span>}
              <button
                type="button"
                disabled={solving || !!issue}
                onClick={() => void solve()}
                className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white
                           disabled:cursor-not-allowed disabled:opacity-40 hover:bg-sky-500"
              >
                Solve
              </button>
            </div>
          </div>
        </div>
      </ResponsiveDrawer>
    </div>
  );
};

export default MultiwayPostflopSolver;
