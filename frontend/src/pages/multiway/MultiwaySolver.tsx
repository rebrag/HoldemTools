// src/pages/multiway/MultiwaySolver.tsx
//
// The multiway preflop workbench: build an N-seat jam-or-fold tree, queue it
// to htsolver, and read the resulting push/fold charts back.
//
// Laid out after MonkerSolver's two-step tree setup - a "New tree" dialog
// (game / limit / street / players), then a stacks-and-blinds screen with the
// table as the visual aid - but using this app's own PokerTable rather than
// Monker's felt.
//
// URL-only, no navbar slot, following /compare's precedent for solver-engine
// surfaces. The engine-mode control at the top is what makes the two
// reachable from each other: this page is the multiway preflop engine, and
// /compare is the heads-up postflop one.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PokerTable from "@/components/PokerTable";
import type { PokerTableSeatData } from "@/components/PokerTableSeat";
import SegmentedControl from "@/components/SegmentedControl";
import { authedFetch } from "@/lib/api";
import PushFoldResultPanel from "./PushFoldResultPanel";
import type { PushFoldDump } from "./pushfoldResult";
import {
  DEFAULT_VIEW,
  MAX_PLAYERS,
  MIN_PLAYERS,
  actionOrder,
  blindSeats,
  buildMultiwayConfig,
  effectiveBb,
  seatLabels,
  validate,
  withPlayers,
  type MultiwayView,
} from "./multiwayView";

const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 " +
  "transition-colors hover:border-slate-600 focus:border-emerald-500 focus:outline-none " +
  "focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-40";

const buttonCls =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-700 " +
  "bg-slate-800/70 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors " +
  "hover:border-slate-500 hover:bg-slate-700/70 disabled:cursor-not-allowed disabled:opacity-40";

const labelCls = "text-[10px] font-medium uppercase tracking-wide text-slate-500";

type JobStatus = "Queued" | "Claimed" | "Running" | "Uploading" | "Done" | "Failed";
interface CompareJob {
  id: string;
  status: JobStatus;
  error?: string | null;
  hasHtResult?: boolean;
}

const TERMINAL: JobStatus[] = ["Done", "Failed"];
const POLL_MS = 3000;
const DEADLINE_MS = 20 * 60 * 1000;

/** A select whose unimplemented options stay visible but disabled. Showing
 *  them is the point - it says what this engine will grow into - and
 *  disabling them is what stops it silently accepting a tree it cannot
 *  solve. */
const GatedSelect = <T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; enabled: boolean; why?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) => (
  <label className="flex flex-col gap-1">
    <span className={labelCls}>{label}</span>
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={inputCls}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={!o.enabled} title={o.why}>
          {o.label}
          {o.enabled ? "" : "  (not yet)"}
        </option>
      ))}
    </select>
  </label>
);

const MultiwaySolver = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<MultiwayView>(DEFAULT_VIEW);
  const [job, setJob] = useState<CompareJob | null>(null);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dump, setDump] = useState<PushFoldDump | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  const set = <K extends keyof MultiwayView>(key: K, value: MultiwayView[K]) =>
    setView((v) => ({ ...v, [key]: value }));

  const labels = useMemo(() => seatLabels(view.players, view.button), [view.players, view.button]);
  const { sb, bb } = useMemo(
    () => blindSeats(view.players, view.button),
    [view.players, view.button]
  );
  const order = useMemo(
    () => actionOrder(view.players, view.button),
    [view.players, view.button]
  );
  const issues = useMemo(() => validate(view), [view]);
  const bbCount = effectiveBb(view);

  const anteEach = Number(view.ante) || 0;
  const potChips =
    (Number(view.dead) || 0) + (Number(view.smallBlind) || 0) + (Number(view.bigBlind) || 0) +
    anteEach * view.players;

  /* Seats are display-only in PokerTable (the whole cluster is one button), so
   * stacks are edited in the list beside it and the table shows the posted
   * blind as that seat's bet - which is exactly what a blind is. */
  const seats: PokerTableSeatData[] = useMemo(
    () =>
      Array.from({ length: view.players }, (_, i) => {
        const posted =
          (i === sb ? Number(view.smallBlind) || 0 : 0) +
          (i === bb ? Number(view.bigBlind) || 0 : 0) +
          anteEach;
        const stack = Number(view.stacks[i]) || 0;
        return {
          key: i,
          label: labels[i],
          stackText: `${Math.max(0, stack - posted)}`,
          committedAmount: posted > 0 ? posted : undefined,
          committedText: posted > 0 ? `${posted}` : undefined,
          isButton: i === view.button,
          isActive: i === order[0],
        };
      }),
    [view, labels, sb, bb, order, anteEach]
  );

  const loadResult = useCallback(async (id: string) => {
    const resp = await authedFetch(`/api/enginecompare/${id}/result/ht`);
    if (!resp.ok) throw new Error(`Result fetch failed (${resp.status})`);
    // Served with Content-Encoding: gzip, which the browser unwraps for us.
    setDump((await resp.json()) as PushFoldDump);
  }, []);

  const solve = useCallback(async () => {
    setError(null);
    setDump(null);
    setSolving(true);
    setElapsed(0);
    const started = Date.now();
    const tick = window.setInterval(() => setElapsed(Date.now() - started), 500);
    try {
      const create = await authedFetch("/api/enginecompare", {
        method: "POST",
        body: JSON.stringify({
          config: buildMultiwayConfig(view),
          mode: "pushfold",
          pioAccuracyPct: 0.02,
          disablePio: true,
          disableCompare: true,
          disableCrossCheck: true,
        }),
      });
      if (!create.ok) throw new Error((await create.text()) || `Queue failed (${create.status})`);
      let current = (await create.json()) as CompareJob;
      setJob(current);

      while (!TERMINAL.includes(current.status)) {
        if (cancelled.current) return;
        if (Date.now() - started > DEADLINE_MS) throw new Error("Timed out waiting for the solve.");
        await new Promise((r) => setTimeout(r, POLL_MS));
        const poll = await authedFetch(`/api/enginecompare/${current.id}`);
        if (!poll.ok) throw new Error(`Poll failed (${poll.status})`);
        current = (await poll.json()) as CompareJob;
        setJob(current);
      }
      if (current.status === "Failed") throw new Error(current.error || "The solve failed.");
      await loadResult(current.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      window.clearInterval(tick);
      setSolving(false);
    }
  }, [view, loadResult]);

  const downloadConfig = () => {
    const blob = new Blob([JSON.stringify(buildMultiwayConfig(view), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pushfold_${view.players}way.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-4 px-3 py-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Multiway preflop solver</h1>
          <p className="max-w-3xl text-[11px] leading-relaxed text-slate-400">
            Jam-or-fold trees for 2 to 9 seats, solved by htsolver. Every combo keeps its own
            strategy - nothing is bucketed. The one approximation is the board runout at an
            all-in showdown, which is averaged over a fixed, seeded sample rather than dealt into
            the tree.
          </p>
        </div>
        <SegmentedControl
          className="text-xs"
          value="multiway"
          options={[
            { key: "multiway", label: "Multiway preflop" },
            { key: "postflop", label: "Heads-up postflop" },
          ]}
          onChange={(k) => {
            if (k === "postflop") navigate("/compare");
          }}
        />
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* ---- Step 1: New tree ---- */}
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <h2 className="mb-2 text-xs font-semibold text-slate-200">New tree</h2>
            <div className="grid grid-cols-2 gap-2">
              <GatedSelect
                label="Game"
                value={view.game}
                disabled={solving}
                onChange={(v) => set("game", v)}
                options={[
                  { value: "holdem", label: "Hold'em", enabled: true },
                  { value: "omaha", label: "Omaha Hi", enabled: false, why: "PLO needs a 270k-combo hand universe and a four-card terminal evaluator." },
                  { value: "omaha_hi_lo", label: "Omaha Hi/Lo", enabled: false },
                ]}
              />
              <GatedSelect
                label="Limit"
                value={view.limit}
                disabled={solving}
                onChange={(v) => set("limit", v)}
                options={[
                  { value: "nl", label: "No limit", enabled: true },
                  { value: "pl", label: "Pot limit", enabled: false },
                ]}
              />
              <GatedSelect
                label="Street"
                value={view.street}
                disabled={solving}
                onChange={(v) => set("street", v)}
                options={[
                  { value: "preflop", label: "Preflop", enabled: true },
                  { value: "flop", label: "Flop", enabled: false, why: "Multiway postflop is the next milestone." },
                  { value: "turn", label: "Turn", enabled: false },
                  { value: "river", label: "River", enabled: false },
                ]}
              />
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Players</span>
                <input
                  type="number"
                  min={MIN_PLAYERS}
                  max={MAX_PLAYERS}
                  value={view.players}
                  disabled={solving}
                  onChange={(e) => setView((v) => withPlayers(v, Number(e.target.value)))}
                  className={`${inputCls} tabular-nums`}
                />
              </label>
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              Actions are all-in or fold. Real preflop sizings are a later pass - the tree builder
              already carries the fields and refuses them.
            </p>
          </section>

          {/* ---- Step 2: stacks, blinds, button ---- */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold text-slate-200">Stacks and blinds</h2>
              <span className="text-[10px] tabular-nums text-emerald-400">
                {Number.isFinite(bbCount) ? `${bbCount.toFixed(1)} bb effective` : ""}
              </span>
            </div>
            <div className="mb-2 grid grid-cols-4 gap-2">
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Pot</span>
                <input
                  readOnly
                  value={potChips}
                  title="Blinds, antes and dead money. Derived, not typed: the engine computes it the same way."
                  className={`${inputCls} tabular-nums opacity-70`}
                />
              </label>
              {(
                [
                  ["smallBlind", "SB"],
                  ["bigBlind", "BB"],
                  ["ante", "Ante"],
                ] as const
              ).map(([key, text]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className={labelCls}>{text}</span>
                  <input
                    inputMode="decimal"
                    value={view[key]}
                    disabled={solving}
                    onChange={(e) => set(key, e.target.value)}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
              ))}
            </div>

            <div className="grid grid-cols-[2.5rem_1fr_3.2rem] items-center gap-x-2 gap-y-1">
              <span className={labelCls}>Seat</span>
              <span className={labelCls}>Stack (chips)</span>
              <span className={`${labelCls} text-center`}>Button</span>
              {Array.from({ length: view.players }, (_, i) => (
                <div key={i} className="contents">
                  <span className="text-[11px] font-semibold text-slate-300">{labels[i]}</span>
                  <input
                    inputMode="decimal"
                    value={view.stacks[i] ?? ""}
                    disabled={solving}
                    onChange={(e) =>
                      setView((v) => {
                        const stacks = [...v.stacks];
                        stacks[i] = e.target.value;
                        return { ...v, stacks };
                      })
                    }
                    className={`${inputCls} tabular-nums`}
                  />
                  <input
                    type="radio"
                    name="button-seat"
                    checked={view.button === i}
                    disabled={solving}
                    onChange={() => set("button", i)}
                    aria-label={`Button on seat ${i + 1}`}
                    className="mx-auto h-3.5 w-3.5 accent-emerald-500"
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              The button sets everything else: {labels[sb]} posts the small blind, {labels[bb]} the
              big blind, and the action runs {order.map((s) => labels[s]).join(" → ")}.
              {view.players === 2 ? " Heads-up the button is the small blind and acts first." : ""}
            </p>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <h2 className="mb-2 text-xs font-semibold text-slate-200">Solve settings</h2>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["boardSamplePair", "Pairwise boards", "Boards behind the exact heads-up equity matrix. Built once; costs setup time, not iterations."],
                  ["boardSampleIter", "Multiway boards", "Boards averaged per iteration at 3+ way showdowns, where the value does not factorize."],
                  ["accuracy", "Target (chips)", "Per-player exploitability to stop at."],
                  ["maxIterations", "Max iterations", ""],
                ] as const
              ).map(([key, text, why]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className={labelCls} title={why}>
                    {text}
                  </span>
                  <input
                    inputMode="decimal"
                    value={view[key]}
                    disabled={solving}
                    onChange={(e) => set(key, e.target.value)}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
              ))}
            </div>
          </section>

          {issues.length > 0 && (
            <ul className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-300">{error}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void solve()}
              disabled={solving || issues.length > 0}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {solving ? "Solving…" : "Solve"}
            </button>
            <button type="button" onClick={downloadConfig} className={buttonCls} disabled={solving}>
              Download config
            </button>
            {solving && job && (
              <span className="text-[11px] tabular-nums text-slate-400">
                {job.status} · {(elapsed / 1000).toFixed(0)}s
              </span>
            )}
          </div>
        </div>

        {/* ---- The table, then the result ---- */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <PokerTable
              size={view.players}
              seats={seats}
              potAmount={potChips}
              potLabel={`Pot ${potChips}`}
              maxWidthClassName="max-w-xl"
            />
          </div>
          {dump ? (
            <PushFoldResultPanel dump={dump} />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-800 px-4 py-10 text-center text-[11px] text-slate-500">
              {solving
                ? "Waiting for the watcher to pick this up and solve it."
                : "Solve to see each seat's jam/fold chart."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MultiwaySolver;
