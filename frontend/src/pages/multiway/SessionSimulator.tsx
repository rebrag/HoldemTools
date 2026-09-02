// src/pages/multiway/SessionSimulator.tsx
//
// "What does playing this look like?" for a hand-sharing team: pick the
// solves the team rotates through (hand k plays solve k mod n - two solves
// is a pair sitting across the table, four is adjacent seats), deal
// hundreds of thousands of hands with each solve's own strategies, then
// bootstrap sessions to see the shape of a session, how deep the downswings
// run, and how often a bankroll dies.
//
// Always mounted (the drawer unmounts its children while closed, and a run
// must survive closing it); the heavy work lives in workers behind
// useSessionSimulation.
import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import { compilePolicy, spotSignature, validateRotation, type RotationCandidate } from "@/lib/sessionSim/compilePolicy";
import { MAX_SESSIONS } from "@/lib/sessionSim/analyzeSessions";
import type { SessionAnalysis } from "@/lib/sessionSim/types";
import { fmtCount, type PushFoldDump } from "./pushfoldResult";
import { MAX_HANDS_PER_SOLVE, useSessionSimulation } from "./useSessionSimulation";

const SessionFanChart = lazy(() => import("./SessionFanChart"));
const DrawdownChart = lazy(() => import("./DrawdownChart"));

/** A Recent row the simulator can add: the page labels it. */
export interface SimulatorJob {
  id: string;
  label: string;
}

interface RotationEntry {
  key: number;
  jobId: string;
  label: string;
}

type Loaded = { dump: PushFoldDump } | { error: string };

const chip =
  "rounded-full border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[10px] text-slate-300";
const labelCls = "text-[10px] font-medium uppercase tracking-wide text-slate-500";
const inputCls =
  "w-full rounded border border-slate-700 bg-slate-800/70 px-2 py-1 text-xs text-slate-200 tabular-nums";
const smallBtn =
  "rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40";

const num = (s: string) => Number(s.trim());
const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
const pct = (p: number, digits = 1) => `${(100 * p).toFixed(digits)}%`;

const parseBankrolls = (s: string): number[] =>
  Array.from(
    new Set(
      s
        .split(/[,\s]+/)
        .map((t) => Number(t))
        .filter((v) => Number.isFinite(v) && v > 0)
        .map((v) => Math.round(v))
    )
  ).sort((a, b) => a - b);

const SessionSimulator = ({
  jobs,
  fetchDump,
  current,
}: {
  jobs: SimulatorJob[];
  fetchDump: (id: string) => Promise<PushFoldDump>;
  /** The result on screen, so "Add current" needs no refetch. */
  current: { id: string; dump: PushFoldDump } | null;
}) => {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<RotationEntry[]>([]);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [nextKey, setNextKey] = useState(1);
  const [handsPerSession, setHandsPerSession] = useState("10000");
  const [sessions, setSessions] = useState("2000");
  const [handsPerSolve, setHandsPerSolve] = useState("200000");
  const [bankrollsText, setBankrollsText] = useState("100, 200, 300, 500");
  const [seed, setSeed] = useState("20260901");
  const sim = useSessionSimulation();

  const ensureLoaded = useCallback(
    (id: string) => {
      if (current && current.id === id) {
        setLoaded((cur) => (cur[id] ? cur : { ...cur, [id]: { dump: current.dump } }));
        return;
      }
      setLoaded((cur) => {
        if (cur[id]) return cur;
        void fetchDump(id)
          .then((dump) => setLoaded((c) => ({ ...c, [id]: { dump } })))
          .catch((e: unknown) =>
            setLoaded((c) => ({ ...c, [id]: { error: e instanceof Error ? e.message : String(e) } }))
          );
        return cur;
      });
    },
    [current, fetchDump]
  );

  const addJob = useCallback(
    (job: SimulatorJob) => {
      setEntries((cur) => [...cur, { key: nextKey, jobId: job.id, label: job.label }]);
      setNextKey((k) => k + 1);
      ensureLoaded(job.id);
    },
    [ensureLoaded, nextKey]
  );

  const move = (index: number, delta: number) =>
    setEntries((cur) => {
      const next = [...cur];
      const j = index + delta;
      if (j < 0 || j >= next.length) return cur;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  const remove = (index: number) => setEntries((cur) => cur.filter((_, i) => i !== index));

  /* Compiled once per distinct payload; a rotation may list one solve
   * twice and it costs nothing the second time. */
  const candidates = useMemo<RotationCandidate[]>(() => {
    const compiled = new Map<string, RotationCandidate>();
    return entries.map((e) => {
      const hit = compiled.get(e.jobId);
      if (hit) return { ...hit, label: e.label };
      const state = loaded[e.jobId];
      let candidate: RotationCandidate;
      if (!state) {
        candidate = { label: e.label, policy: null, signature: null, loading: true };
      } else if ("error" in state) {
        candidate = { label: e.label, policy: null, signature: null, error: state.error };
      } else {
        try {
          candidate = {
            label: e.label,
            policy: compilePolicy(state.dump),
            signature: spotSignature(state.dump),
          };
        } catch (err) {
          candidate = {
            label: e.label,
            policy: null,
            signature: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      compiled.set(e.jobId, candidate);
      return candidate;
    });
  }, [entries, loaded]);

  const bankrolls = useMemo(() => parseBankrolls(bankrollsText), [bankrollsText]);
  const issues = useMemo(() => {
    const out = validateRotation(candidates);
    if (!(num(handsPerSession) >= 1)) out.push("Hands per session must be at least 1.");
    if (!(num(sessions) >= 1) || num(sessions) > MAX_SESSIONS) {
      out.push(`Sessions must be between 1 and ${MAX_SESSIONS.toLocaleString("en-US")}.`);
    }
    if (!(num(handsPerSolve) >= 1000) || num(handsPerSolve) > MAX_HANDS_PER_SOLVE) {
      out.push(
        `Hands per solve must be between 1,000 and ${MAX_HANDS_PER_SOLVE.toLocaleString("en-US")}.`
      );
    }
    if (bankrolls.length === 0) out.push("Give at least one bankroll in bb, e.g. 100, 200, 300.");
    if (!Number.isFinite(num(seed))) out.push("Seed must be a number.");
    return out;
  }, [candidates, handsPerSession, sessions, handsPerSolve, bankrolls, seed]);

  const running = sim.phase === "simulating" || sim.phase === "analyzing";
  const run = () => {
    if (issues.length > 0 || running) return;
    sim.run(
      candidates.map((c) => c.policy!),
      {
        handsPerSolve: num(handsPerSolve),
        handsPerSession: num(handsPerSession),
        sessions: num(sessions),
        bankrolls,
        seed: num(seed) >>> 0,
      }
    );
  };

  const result = sim.result;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-medium text-slate-200 transition-colors hover:border-emerald-600 hover:text-emerald-300"
        title="Play the solved strategies hand by hand: session shape, bb/100, downswings and bust odds for a team rotating through solves."
      >
        Session simulator
        {running && !open && (
          <span className="ml-1.5 tabular-nums text-slate-400">{Math.round(sim.progress * 100)}%</span>
        )}
      </button>

      <ResponsiveDrawer
        open={open}
        onClose={() => setOpen(false)}
        scrollMode="custom"
        desktopMaxWidthClassName="sm:max-w-4xl"
        zClassName="z-[70]"
        ariaLabel="Session simulator"
      >
        <div className="flex h-[88vh] max-h-[88vh] flex-col">
          <div className="border-b border-slate-800 px-4 py-3 pr-12">
            <h2 className="text-sm font-semibold text-slate-100">Session simulator</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Every seat plays its solved strategy, the team its conditioned charts; every hand is a
              fresh deal with stacks reset. Hand k plays solve k mod n, so two solves alternate
              seatings - a pair across the table - and four cycle adjacent seats.
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
            {/* ---------- rotation ---------- */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold text-slate-200">Rotation</h3>
                <select
                  value=""
                  disabled={running}
                  onChange={(e) => {
                    const job = jobs.find((j) => j.id === e.target.value);
                    if (job) addJob(job);
                  }}
                  className="rounded border border-slate-700 bg-slate-800/70 px-1.5 py-0.5 text-[11px] text-slate-200"
                  aria-label="Add a solve from Recent"
                >
                  <option value="">Add from Recent…</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.label}
                    </option>
                  ))}
                </select>
                {current && (
                  <button
                    type="button"
                    disabled={running}
                    onClick={() =>
                      addJob({
                        id: current.id,
                        label:
                          jobs.find((j) => j.id === current.id)?.label ??
                          current.dump.metadata.solve_id ??
                          current.id,
                      })
                    }
                    className={smallBtn}
                  >
                    Add the open solve
                  </button>
                )}
              </div>
              {entries.length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  No solves yet. Add the hand-sharing team solves the pair rotates through, in
                  order.
                </p>
              ) : (
                <ol className="space-y-1">
                  {entries.map((e, i) => {
                    const c = candidates[i];
                    const p = c.policy;
                    return (
                      <li
                        key={e.key}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-2 py-1 text-[11px]"
                      >
                        <span className="w-4 tabular-nums text-slate-500">{i + 1}</span>
                        {p ? (
                          <>
                            <span className="rounded-full border border-amber-800 px-2 py-0.5 text-amber-300">
                              team {p.meta.pairingLabel}
                            </span>
                            <span className="font-mono text-slate-300">{p.meta.solveId}</span>
                            <span className="tabular-nums text-slate-500">
                              {fmtCount(p.meta.iterations)} iters
                            </span>
                          </>
                        ) : c.loading ? (
                          <span className="text-slate-500">{e.label} · loading…</span>
                        ) : (
                          <span className="text-red-400">{e.label} · {c.error}</span>
                        )}
                        <span className="ml-auto flex items-center gap-1">
                          <button type="button" disabled={running || i === 0} onClick={() => move(i, -1)} className={smallBtn} aria-label="Move up">
                            ↑
                          </button>
                          <button type="button" disabled={running || i === entries.length - 1} onClick={() => move(i, 1)} className={smallBtn} aria-label="Move down">
                            ↓
                          </button>
                          <button type="button" disabled={running} onClick={() => remove(i)} className={smallBtn} aria-label="Remove">
                            ×
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            {/* ---------- parameters ---------- */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <h3 className="mb-2 text-xs font-semibold text-slate-200">Session</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(
                  [
                    ["Hands per session", handsPerSession, setHandsPerSession, "One session's length. Downswings and busts are measured inside it."],
                    ["Sessions", sessions, setSessions, "How many sessions to bootstrap; more means smoother percentiles."],
                    ["Hands per solve", handsPerSolve, setHandsPerSolve, "Hands dealt with each solve. Sessions draw from this pool, so it bounds how well the tails are known."],
                    ["Bankrolls (bb)", bankrollsText, setBankrollsText, "Comma-separated. A session busts a bankroll when its result touches minus that much at any hand."],
                    ["Seed", seed, setSeed, "Same seed, same numbers - on any machine."],
                  ] as const
                ).map(([label, value, set, why]) => (
                  <label key={label} className="flex flex-col gap-1">
                    <span className={labelCls} title={why}>
                      {label}
                    </span>
                    <input
                      value={value}
                      disabled={running}
                      inputMode="decimal"
                      onChange={(e) => set(e.target.value)}
                      className={inputCls}
                    />
                  </label>
                ))}
              </div>
            </section>

            {issues.length > 0 && entries.length > 0 && (
              <ul className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {running ? (
                <button type="button" onClick={sim.cancel} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-amber-700 hover:text-amber-300">
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={run}
                  disabled={issues.length > 0}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Run
                </button>
              )}
              {running && (
                <div className="flex min-w-[12rem] flex-1 items-center gap-2 text-[11px] text-slate-400">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(sim.progress * 100)}%` }} />
                  </div>
                  <span className="tabular-nums">
                    {sim.phase === "simulating" ? "dealing" : "sessions"} · {Math.round(sim.progress * 100)}%
                  </span>
                </div>
              )}
              {sim.error && <p className="text-[11px] text-red-400">{sim.error}</p>}
            </div>

            {result && <Results result={result} bankrolls={bankrolls} />}
          </div>
        </div>
      </ResponsiveDrawer>
    </>
  );
};

const Results = ({ result, bankrolls }: { result: SessionAnalysis; bankrolls: number[] }) => {
  const H = result.handsPerSession;
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={chip} title="Team win rate over the rotation, both members combined, with its standard error.">
            <span className="text-slate-200">{signed(result.bbPer100)}</span> ± {result.bbPer100Se.toFixed(1)} bb/100
          </span>
          <span className={chip} title="Standard deviation of one hand's team result under the rotation.">
            sd {result.sdPerHandBb.toFixed(2)} bb/hand
          </span>
          <span className={chip} title="Share of dealt hands that reached a showdown.">
            {result.showdownPct.toFixed(1)}% showdowns
          </span>
          <span className={chip}>
            {fmtCount(result.sessions)} sessions × {fmtCount(H)} hands
          </span>
        </div>
        <table className="mt-2 w-full text-[11px] tabular-nums">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1 pr-2 font-medium">#</th>
              <th className="py-1 pr-2 font-medium">Pairing</th>
              <th className="py-1 pr-2 font-medium">Solve</th>
              <th className="py-1 pr-2 text-right font-medium">Share</th>
              <th className="py-1 pr-2 text-right font-medium">Simulated bb/100</th>
              <th className="py-1 pr-2 text-right font-medium" title="The artifact's own sampled team EV. Simulated and artifact should agree within a couple of standard errors; a bigger gap means the payload and the play disagree.">
                Artifact EV
              </th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {result.perEntry.map((e, i) => (
              <tr key={`${e.solveId}-${i}`} className="border-t border-slate-800/70">
                <td className="py-1 pr-2 text-slate-500">{i + 1}</td>
                <td className="py-1 pr-2 text-amber-300">team {e.pairingLabel}</td>
                <td className="py-1 pr-2 font-mono text-slate-400">{e.solveId}</td>
                <td className="py-1 pr-2 text-right text-slate-500">{pct(e.weight, 0)}</td>
                <td className="py-1 pr-2 text-right">
                  {signed(e.bbPer100)} <span className="text-slate-500">± {e.bbPer100Se.toFixed(1)}</span>
                </td>
                <td className="py-1 pr-2 text-right text-slate-400">{signed(e.artifactBbPer100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <h3 className="mb-1 text-xs font-semibold text-slate-200">Team result over a {fmtCount(H)}-hand session</h3>
        <p className="mb-2 text-[11px] text-slate-500">
          Big blinds, both members combined. The bands are where {fmtCount(result.sessions)} simulated
          sessions sit; the amber line is one of them.
        </p>
        <Suspense fallback={<div className="h-[280px] text-[11px] text-slate-500">Loading chart…</div>}>
          <SessionFanChart fan={result.fan} bankroll={bankrolls[0]} animate />
        </Suspense>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.finalResult.percentiles.map((p) => (
            <span key={p.p} className={chip} title={`${p.p}th percentile of the session's final result`}>
              p{p.p} <span className="text-slate-200">{signed(p.value, 0)}</span>
            </span>
          ))}
          <span className={chip} title="Sessions that ended below zero.">losing sessions {pct(result.finalResult.pLoss)}</span>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <h3 className="mb-1 text-xs font-semibold text-slate-200">Bankroll</h3>
        <p className="mb-2 text-[11px] text-slate-500">
          Bust means the session's cumulative result touched minus the bankroll at some hand. The
          long-run figure is the Brownian-motion risk of ruin for this win rate and variance, with no
          session limit - an approximation, not a simulation.
        </p>
        <table className="w-full text-[11px] tabular-nums">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1 pr-2 font-medium">Bankroll</th>
              <th className="py-1 pr-2 text-right font-medium">Bust within {fmtCount(H)} hands</th>
              <th className="py-1 pr-2 text-right font-medium">Long-run risk of ruin</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {result.bankrolls.map((b) => (
              <tr key={b.bankroll} className="border-t border-slate-800/70">
                <td className="py-1 pr-2">{b.bankroll} bb</td>
                <td className="py-1 pr-2 text-right">
                  {pct(b.bustP)} <span className="text-slate-500">± {pct(b.bustHalf)}</span>
                </td>
                <td className="py-1 pr-2 text-right text-slate-400">{pct(b.ruinLongRun, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <h3 className="mb-1 text-xs font-semibold text-slate-200">Chance of a downswing at least this deep</h3>
        <p className="mb-2 text-[11px] text-slate-500">
          Biggest peak-to-trough fall of the team's result inside a session, for the full session
          and shorter stretches of it.
        </p>
        <Suspense fallback={<div className="h-[260px] text-[11px] text-slate-500">Loading chart…</div>}>
          <DrawdownChart curves={result.drawdown} bankrolls={bankrolls} animate />
        </Suspense>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Downswing of at least</th>
                {result.drawdown.map((d) => (
                  <th key={d.hands} className="py-1 pr-2 text-right font-medium">
                    {fmtCount(d.hands)} hands
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {result.drawdown[0].atLeast.map((row, i) => (
                <tr key={row.threshold} className="border-t border-slate-800/70">
                  <td className="py-1 pr-2">{row.threshold} bb</td>
                  {result.drawdown.map((d) => (
                    <td key={d.hands} className="py-1 pr-2 text-right">
                      {pct(d.atLeast[i].p)}
                    </td>
                  ))}
                </tr>
              ))}
              {result.drawdown[0].percentiles.map((row, i) => (
                <tr key={`p${row.p}`} className="border-t border-slate-800/70 text-slate-400">
                  <td className="py-1 pr-2">{row.p}th percentile</td>
                  {result.drawdown.map((d) => (
                    <td key={d.hands} className="py-1 pr-2 text-right">
                      {Math.round(d.percentiles[i].value)} bb
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default SessionSimulator;
