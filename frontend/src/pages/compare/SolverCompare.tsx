import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PlayingCard from "@/components/PlayingCard";
import { authedFetch } from "@/lib/api";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import TreeBuilding, { inputCls } from "@/components/TreeBuilding";
import {
  applyViewToBuilder,
  buildEngineConfig,
  builderToView,
  cloneBuilder,
  DEFAULT_BUILDER,
  type BuilderState,
} from "./builderState";
import { parseBoardCards, pioClipboardCodec } from "./treeConfigText";
import { pioRangeCodec } from "@/lib/solver/rangeTokens";
import PipelineTimingPanel, {
  secs,
  type ClientMarks,
  type JobTimings,
  type PipelineRun,
} from "./PipelineTimingPanel";

/**
 * Hidden verification page (/compare, no nav entry): htsolver vs PioSolver
 * gates, solve-cost comparison, and pipeline timing for the same spot.
 *
 * Two ways in:
 *  - Build a spot in the tree builder and "Solve & Compare" - the compare
 *    watcher solves it with htsolver, then builds + solves the IDENTICAL
 *    tree in Pio (validated node-for-node, --gate-only) and uploads the
 *    summary.
 *  - Drop a JSON produced by `watcher/engine_compare.py --json-out` - works
 *    anywhere, including the deployed site.
 *
 * Reading the numbers: only the game VALUE of a 2p zero-sum spot is unique;
 * per-hand strategies (and, via blockers, per-hand EVs) may legitimately
 * differ between two exact equilibria. The correctness verdict is the
 * cross-check badge (Pio's own evaluator rating the htsolver strategy).
 * Per-combo detail is no longer rendered here - eyeball specific hands in
 * the /solutions viewer instead.
 */

/* ---------- the harness's JSON shapes ---------- */

interface CompareDoc {
  kind: string;
  schema: number;
  generated_utc?: string;
  spot: { board: string; pot: number; chip_scale?: number; config_hash: string; cfr: string };
  summary: {
    ht: {
      iterations: number;
      nashconv: number;
      exploitable_chips?: number;
      ev: number[];
    };
    pio: { ev_oop: number | null; ev_ip: number | null; exploitable: number | null };
    cross_check: {
      gate?: "cross_exploitability" | "root_ev";
      ht_exploitable_per_pio: number | null;
      ht_ev_per_pio: (number | null)[];
      root_ev_diff?: number | null;
      threshold: number;
      pass: boolean;
    };
    /** Null in gate-only docs, where the diagnostics never ran. */
    mean_l1: number | null;
    mean_ev_diff: number | null;
    /** False when Pio's line frequencies gave the per-hand diagnostics
     *  nothing to normalize against, which happens on boards where its
     *  global frequencies underflow to zero. The two means above are then
     *  placeholders, not measurements. Absent in older comparison JSON,
     *  where they were always real. */
    diagnostics_weighted?: boolean;
    /** True when the run skipped per-hand diagnostics entirely (the compare
     *  watcher's fast path). Absent in older comparison JSON. */
    gate_only?: boolean;
    /** Wall clock for both solvers on the same tree at the same accuracy
     *  target (added by engine_compare.py; absent in older comparison JSON). */
    timing?: {
      ht_solve_s: number | null;
      ht_setup_s?: number | null;
      ht_threads?: number | null;
      ht_iterations?: number | null;
      pio_solve_s: number | null;
      pio_setup_s?: number | null;
      accuracy_chips?: number | null;
      /* Harness phases around the two solves (absent in older JSON); the
       * pipeline panel reads them from the job row, but a hand-loaded file
       * carries them here too. */
      meta_load_s?: number | null;
      dump_load_s?: number | null;
      pio_spawn_s?: number | null;
      compare_loop_s?: number | null;
      cross_check_s?: number | null;
    };
    /** Peak working set of each solver PROCESS over building and solving the
     *  tree - the same OS counter on both sides. Absent in older JSON. */
    memory?: {
      ht_peak_bytes: number | null;
      pio_peak_bytes: number | null;
      pio_baseline_bytes?: number | null;
    };
    sampled?: boolean;
    runouts?: number | null;
    decision_nodes?: number;
    compared_nodes?: number;
    detail_nodes?: number;
  };
  /** Per-combo detail. Empty in gate-only docs and no longer rendered here -
   *  hands are eyeballed in the /solutions viewer instead. Kept in the type
   *  so hand-loaded full docs still parse. */
  nodes?: unknown[];
}

/* ---------- job pipeline (executed by the compare watcher) ---------- */

interface CompareJob {
  id: string;
  mode: "compare" | "publish";
  board: string | null;
  status: "Queued" | "Claimed" | "Running" | "Uploading" | "Done" | "Failed";
  error: string | null;
  resultStacks: string | null;
  resultNodeName: string | null;
  createdAtUtc: string;
  claimedAtUtc: string | null;
  completedAtUtc: string | null;
  /** Per-stage wall times from the watcher; null for pre-instrumentation jobs. */
  timings: JobTimings | null;
}

const TERMINAL_STATUSES = ["Done", "Failed"];

const solutionsUrl = (job: CompareJob): string =>
  `/solutions?open=${encodeURIComponent(
    `${job.resultStacks}|${job.resultNodeName}|${job.board}`
  )}`;

/* ---------- page ---------- */

const SolverCompare = () => {
  const [doc, setDoc] = useState<CompareDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [builder, setBuilder] = useState<BuilderState>(() => cloneBuilder(DEFAULT_BUILDER));
  const [builderOpen, setBuilderOpen] = useState(false);
  const [solving, setSolving] = useState(false);
  const [runLog, setRunLog] = useState<string | null>(null);
  const [jobs, setJobs] = useState<CompareJob[]>([]);
  const [activeJob, setActiveJob] = useState<CompareJob | null>(null);
  const [publishedJob, setPublishedJob] = useState<CompareJob | null>(null);
  // The last run's stage-by-stage wall clock; survives the poll loop's
  // cleanup so the panel stays up with the results.
  const [pipeline, setPipeline] = useState<PipelineRun | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  useEffect(() => {
    // Reset on mount: StrictMode's dev double-mount runs the cleanup once,
    // and a latched ref would silently kill every poll loop.
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const setB = <K extends keyof BuilderState>(key: K, value: BuilderState[K]) =>
    setBuilder((cur) => ({ ...cur, [key]: value }));

  const acceptDoc = useCallback((parsed: CompareDoc) => {
    if (parsed.kind !== "htsolver_pio_comparison") {
      throw new Error("Not a comparison file - generate one with engine_compare.py --json-out");
    }
    setDoc(parsed);
    setBuilderOpen(false);
    setError(null);
  }, []);

  const loadFile = useCallback(
    (file: File) => {
      setPipeline(null); // a hand-loaded file has no pipeline run behind it
      file
        .text()
        .then((text) => acceptDoc(JSON.parse(text) as CompareDoc))
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    },
    [acceptDoc]
  );

  const refreshJobs = useCallback(async () => {
    try {
      const resp = await authedFetch("/api/enginecompare");
      if (resp.ok) setJobs((await resp.json()) as CompareJob[]);
    } catch {
      /* signed out or offline; the list just stays empty */
    }
  }, []);
  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  const loadJobResult = useCallback(
    async (job: CompareJob, opts: { submitMs?: number; tClickMs?: number } = {}) => {
      setError(null);
      try {
        const t0 = performance.now();
        const resp = await authedFetch(`/api/enginecompare/${job.id}/result`);
        if (!resp.ok) throw new Error(await resp.text());
        const t1 = performance.now();
        const parsed = (await resp.json()) as CompareDoc;
        const t2 = performance.now();
        acceptDoc(parsed);
        // Two rAFs bracket the commit + paint of the accepted doc: the first
        // fires before the frame, the second after it was presented. Finite
        // and event-driven - no idle cost.
        const t3 = await new Promise<number>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))
        );
        const marks: ClientMarks = {
          submitMs: opts.submitMs,
          fetchHeadersMs: t1 - t0,
          downloadParseMs: t2 - t1,
          renderMs: t3 - t2,
          totalMs: opts.tClickMs == null ? undefined : t3 - opts.tClickMs,
        };
        setPipeline({ job, marks });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [acceptDoc]
  );

  /** Queue a job for the compare watcher and poll it to completion. */
  const submitJob = useCallback(
    async (mode: "compare" | "publish") => {
      setError(null);
      setRunLog(null);
      let payload: { config: object; pioAccuracyPct: number };
      try {
        payload = buildEngineConfig(builder);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      setSolving(true);
      setPublishedJob(null);
      setPipeline(null);
      try {
        const tClick = performance.now();
        const createResp = await authedFetch("/api/enginecompare", {
          method: "POST",
          body: JSON.stringify({ ...payload, mode }),
        });
        if (createResp.status === 403) {
          throw new Error("Publishing to the solutions library is admin-only.");
        }
        if (!createResp.ok) throw new Error(await createResp.text());
        let job = (await createResp.json()) as CompareJob;
        const submitMs = performance.now() - tClick;
        setActiveJob(job);
        void refreshJobs();

        // Poll until the watcher finishes. Stops on unmount; the job keeps
        // running server-side and stays in the Recent runs list.
        const deadline = Date.now() + 20 * 60 * 1000;
        while (!TERMINAL_STATUSES.includes(job.status)) {
          if (cancelledRef.current || Date.now() > deadline) return;
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const poll = await authedFetch(`/api/enginecompare/${job.id}`);
          if (!poll.ok) throw new Error(await poll.text());
          job = (await poll.json()) as CompareJob;
          setActiveJob(job);
        }
        void refreshJobs();
        if (job.status === "Failed") {
          throw new Error(job.error ?? "The compare watcher reported a failure.");
        }
        if (mode === "compare") {
          await loadJobResult(job, { submitMs, tClickMs: tClick });
        } else {
          setPublishedJob(job);
          setPipeline({ job, marks: { submitMs, totalMs: performance.now() - tClick } });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSolving(false);
        setActiveJob(null);
      }
    },
    [builder, refreshJobs, loadJobResult]
  );

  const downloadConfig = useCallback(() => {
    try {
      const { config } = buildEngineConfig(builder);
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "htsolver_config.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [builder]);

  const board = useMemo(() => (doc ? parseBoardCards(doc.spot.board) : []), [doc]);
  const chips = (v: number | null | undefined): string => (v == null ? "-" : v.toFixed(2));
  const megabytes = (v: number | null | undefined): string =>
    v == null ? "n/a" : v >= 1024 ** 3 ? `${(v / 1024 ** 3).toFixed(2)} GB` : `${Math.round(v / 1024 ** 2)} MB`;

  const cross = doc?.summary.cross_check;
  const timing = doc?.summary.timing;
  const memory = doc?.summary.memory;
  /** Pio's cost divided by htsolver's: > 1 means htsolver won. Null whenever
   *  either side is missing, which is the pre-solved-.cfr case. */
  const ratioOf = (ht?: number | null, pio?: number | null): number | null =>
    ht != null && ht > 0 && pio != null ? pio / ht : null;
  const speedup = ratioOf(timing?.ht_solve_s, timing?.pio_solve_s);
  const memRatio = ratioOf(memory?.ht_peak_bytes, memory?.pio_peak_bytes);

  return (
    <div className="mx-auto max-w-7xl px-3 py-6 text-slate-200">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-white">Solver comparison</h1>
        <span className="text-xs text-slate-500">
          <span className="font-medium text-emerald-400">htsolver</span> vs{" "}
          <span className="font-medium text-sky-400">PioSolver</span>, same tree
        </span>
        <button
          type="button"
          onClick={() => setBuilderOpen(true)}
          className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500"
        >
          Tree builder
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800/60"
        >
          Load JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) loadFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {/* Recent runs stay on the page: they are how a previous comparison
          gets re-opened, which belongs next to the results rather than
          inside the builder. */}
      {jobs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-500">Recent runs</span>
          {jobs.slice(0, 12).map((job) => (
            <button
              key={job.id}
              type="button"
              disabled={job.status !== "Done"}
              title={
                job.status === "Failed"
                  ? job.error ?? "failed"
                  : job.mode === "publish"
                    ? "Published solve - opens /solutions"
                    : "Load this comparison"
              }
              onClick={() => {
                if (job.status !== "Done") return;
                if (job.mode === "publish") window.location.href = solutionsUrl(job);
                else void loadJobResult(job);
              }}
              className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                job.status === "Done"
                  ? "border-slate-600 text-slate-200 hover:border-emerald-500 hover:bg-emerald-500/10"
                  : job.status === "Failed"
                    ? "border-red-900 text-red-400"
                    : "border-slate-700 text-slate-500"
              }`}
            >
              {job.board ?? "?"} · {job.mode === "publish" ? "publish" : "compare"} ·{" "}
              {job.status}
            </button>
          ))}
        </div>
      )}

      {/* A queued job outlives the modal, so its status has to live on the
          page too - closing the builder must not look like it stopped. */}
      {solving && !builderOpen && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-2 text-xs text-slate-300">
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-emerald-400"
          />
          Solving{activeJob ? ` · ${activeJob.status}` : ""} - this keeps running if you
          leave the page.
        </p>
      )}
      {publishedJob && (
        <p className="mt-3 text-xs text-emerald-300">
          Published to the solutions library:{" "}
          <a className="underline" href={solutionsUrl(publishedJob)}>
            open {publishedJob.board} in /solutions
          </a>
        </p>
      )}
      {pipeline && pipeline.job.mode === "publish" && (
        <PipelineTimingPanel job={pipeline.job} marks={pipeline.marks} />
      )}

      {/* ---------- tree builder (PioViewer-style), in a modal so opening it
           does not push the comparison down the page ---------- */}
      <ResponsiveDrawer
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        scrollMode="custom"
        desktopMaxWidthClassName="sm:max-w-5xl"
        zClassName="z-[70]"
        ariaLabel="Tree building parameters"
      >
        <div className="flex max-h-[90vh] flex-col">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold tracking-tight text-white">
              Tree building parameters
            </h2>
            <p className="text-[11px] text-slate-500">
              Both solvers get this exact tree, node for node.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            <TreeBuilding
              value={builderToView(builder)}
              onChange={(v) => setBuilder((cur) => applyViewToBuilder(cur, v))}
              disabled={solving}
              boardMaxCards={5}
              boardVariant="inline"
              showNoThreeBet
              showMaxRaises
              showPreflopAggressor
              showClearAllSizes
              clipboard={pioClipboardCodec}
              rangeCodec={pioRangeCodec}
            />

            {/* Solve settings - ours, not PioViewer's tree builder. */}
            <div className="mt-3 flex flex-wrap items-start gap-x-8 gap-y-3 border-t border-slate-800 pt-3">
              <fieldset>
                <legend className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  Stop when this accuracy is reached
                </legend>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
                  {(["pct", "chips"] as const).map((mode) => (
                    <label
                      key={mode}
                      className="flex cursor-pointer items-center gap-1.5 transition-colors hover:text-slate-100"
                    >
                      <input
                        type="radio"
                        name="accuracy-mode"
                        checked={builder.accuracyMode === mode}
                        onChange={() => setB("accuracyMode", mode)}
                        className="accent-emerald-500"
                      />
                      <input
                        className={`${inputCls} w-16 tabular-nums`}
                        value={builder.accuracyMode === mode ? builder.accuracy : ""}
                        onChange={(e) => {
                          setB("accuracyMode", mode);
                          setB("accuracy", e.target.value);
                        }}
                        aria-label={mode === "pct" ? "Accuracy, % of pot" : "Accuracy, chips"}
                      />
                      {mode === "pct" ? "% of the pot" : "chips"}
                    </label>
                  ))}
                </div>
                <p className="mt-1 max-w-md text-[10px] leading-relaxed text-slate-500">
                  The real target, applied to both solvers - htsolver stops once its
                  self-reported per-player exploitability drops below it, and Pio solves
                  the same tree to the same number. It is what makes the two solve times
                  and memory peaks comparable.
                </p>
              </fieldset>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  Max iterations (safety cap)
                </span>
                <input
                  className={`${inputCls} w-24 tabular-nums`}
                  value={builder.maxIterations}
                  onChange={(e) => setB("maxIterations", e.target.value)}
                />
                <span className="max-w-[15rem] text-[10px] leading-relaxed text-slate-500">
                  Not a target - a stop-loss. If a tree never reaches the accuracy above,
                  this ends the run instead of letting it grind forever.
                </span>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={downloadConfig}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800/60"
              title="Save the htsolver config to run manually"
            >
              Download config
            </button>
            <button
              type="button"
              onClick={() => void submitJob("publish")}
              disabled={solving}
              title="htsolver only: publish the solve to the Solutions library (admin)"
              className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:border-emerald-500 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Solve & Publish
            </button>
            <button
              type="button"
              onClick={() => void submitJob("compare")}
              disabled={solving}
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {solving && (
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                />
              )}
              {solving ? "Working..." : "Solve & Compare"}
            </button>
          </div>
          {solving && (
            <p className="px-4 pb-3 text-[11px] text-slate-500">
              Queued for the compare watcher (the machine with both solvers). Closing this
              does not stop it - the result lands in Recent runs.
            </p>
          )}
        </div>
      </ResponsiveDrawer>

      {error && (
        <p className="mt-3 whitespace-pre-wrap rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* ---------- empty state: drop zone ---------- */}
      {!doc && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) loadFile(file);
          }}
          className="mt-6 flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-slate-700 bg-slate-800/30 px-6 py-10 text-slate-400 transition-colors hover:border-emerald-500"
        >
          <span className="font-medium">
            ...or drop a comparison JSON here (engine_compare.py --json-out)
          </span>
        </button>
      )}

      {/* ---------- loaded state ---------- */}
      {doc && cross && (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-1.5">
              {board.map((c) => (
                <PlayingCard key={c} code={c} width={34} />
              ))}
            </div>
            <div className="text-sm text-slate-300">
              Pot {doc.spot.pot} chips
              <span className="mx-2 text-slate-600">·</span>
              <span className="text-slate-500">{doc.spot.cfr}</span>
            </div>
            <span
              className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${
                cross.pass ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
              }`}
              title={
                cross.gate === "root_ev"
                  ? "Sampled tree: gate is root-EV agreement (cross-exploitability needs a full strategy upload)"
                  : "Pio's own evaluator rating the htsolver strategy's exploitability"
              }
            >
              {cross.gate === "root_ev"
                ? `root-EV gate ${cross.pass ? "PASS" : "FAIL"} · Δ ${
                    cross.root_ev_diff ?? "?"
                  } chips (sampled ${doc.summary.runouts ?? "?"} runouts)`
                : `cross-check ${cross.pass ? "PASS" : "FAIL"} · ${
                    cross.ht_exploitable_per_pio ?? "?"
                  } chips exploitable per Pio`}
            </span>
          </div>

          {/* What the tree COST each solver: the headline when the point is
              comparing the two on one tree at one accuracy target. */}
          {(timing?.ht_solve_s != null || memory?.ht_peak_bytes != null) && (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr_1fr_auto]">
                {(
                  [
                    {
                      key: "time",
                      label: "Solve time",
                      ht: timing?.ht_solve_s == null ? null : secs(timing.ht_solve_s),
                      pio: timing?.pio_solve_s == null ? null : secs(timing.pio_solve_s),
                      htNote: [
                        `${timing?.ht_iterations ?? doc.summary.ht.iterations} iters`,
                        timing?.ht_threads ? `${timing.ht_threads} threads` : null,
                        // Sub-10ms setup would just read "setup 0.00s".
                        timing?.ht_setup_s != null && timing.ht_setup_s >= 0.01
                          ? `setup ${secs(timing.ht_setup_s)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                      pioNote:
                        timing?.pio_solve_s == null
                          ? "loaded from a pre-solved .cfr"
                          : timing.pio_setup_s != null
                            ? `tree build ${secs(timing.pio_setup_s)}`
                            : "",
                      ratio: speedup,
                      win: "faster",
                      lose: "slower",
                    },
                    {
                      key: "memory",
                      label: "Peak memory",
                      ht: memory?.ht_peak_bytes == null ? null : megabytes(memory.ht_peak_bytes),
                      pio: memory?.pio_peak_bytes == null ? null : megabytes(memory.pio_peak_bytes),
                      htNote: "whole process, peak working set",
                      pioNote:
                        memory?.pio_baseline_bytes != null
                          ? `${megabytes(memory.pio_baseline_bytes)} of that is idle baseline`
                          : "whole process, peak working set",
                      ratio: memRatio,
                      win: "leaner",
                      lose: "heavier",
                    },
                  ] as const
                ).map((row) => (
                  <div key={row.key} className="contents">
                    <div className="self-center text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      {row.label}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-xl font-semibold tabular-nums leading-none tracking-tight text-emerald-400">
                          {row.ht ?? "n/a"}
                        </span>
                        <span className="text-xs text-slate-400">htsolver</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{row.htNote}</div>
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-xl font-semibold tabular-nums leading-none tracking-tight text-sky-400">
                          {row.pio ?? "n/a"}
                        </span>
                        <span className="text-xs text-slate-400">PioSolver</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{row.pioNote}</div>
                    </div>
                    <div className="self-center">
                      {row.ratio != null && (
                        <span
                          className={`inline-block rounded-lg px-2.5 py-1 text-center ${
                            row.ratio >= 1
                              ? "bg-emerald-500/10 text-emerald-300"
                              : "bg-amber-500/10 text-amber-300"
                          }`}
                        >
                          <span className="block text-base font-semibold tabular-nums leading-none tracking-tight">
                            {(row.ratio >= 1 ? row.ratio : 1 / row.ratio) >= 10
                              ? (row.ratio >= 1 ? row.ratio : 1 / row.ratio).toFixed(0)
                              : (row.ratio >= 1 ? row.ratio : 1 / row.ratio).toFixed(1)}
                            x
                          </span>
                          <span className="mt-0.5 block text-[10px] opacity-80">
                            htsolver {row.ratio >= 1 ? row.win : row.lose}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 border-t border-slate-800 pt-2 text-[11px] leading-relaxed text-slate-500">
                Same tree, same accuracy target
                {timing?.accuracy_chips != null
                  ? ` (${timing.accuracy_chips} chips exploitable per player)`
                  : ""}
                . Time excludes tree building on both sides; memory is the peak working
                set of each solver process, which does include it.
              </p>
            </div>
          )}

          {pipeline && pipeline.job.mode === "compare" && (
            <PipelineTimingPanel job={pipeline.job} marks={pipeline.marks} />
          )}

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-lg bg-slate-800/60 p-2.5">
              <div className="text-slate-500">Root EV chips (OOP / IP)</div>
              <div className="mt-0.5">
                <span className="font-medium text-emerald-400">htsolver</span>{" "}
                {chips(doc.summary.ht.ev[0])} / {chips(doc.summary.ht.ev[1])}
              </div>
              <div>
                <span className="font-medium text-sky-400">Pio</span>{" "}
                {chips(doc.summary.pio.ev_oop)} / {chips(doc.summary.pio.ev_ip)}
              </div>
            </div>
            <div className="rounded-lg bg-slate-800/60 p-2.5">
              <div className="text-slate-500">Exploitable for (chips)</div>
              <div className="mt-0.5">
                <span className="font-medium text-emerald-400">htsolver</span>{" "}
                {chips(doc.summary.ht.exploitable_chips ?? doc.summary.ht.nashconv / 2)}{" "}
                <span className="text-slate-500">self</span> ·{" "}
                {cross.ht_exploitable_per_pio ?? "?"} <span className="text-slate-500">per Pio</span>
              </div>
              <div>
                <span className="font-medium text-sky-400">Pio</span>{" "}
                {doc.summary.pio.exploitable ?? "?"}{" "}
                <span className="text-slate-500">own solve</span>
              </div>
            </div>
            <div className="rounded-lg bg-slate-800/60 p-2.5">
              <div className="text-slate-500">htsolver solve</div>
              <div className="mt-0.5">
                {doc.summary.ht.iterations} iters · NashConv {doc.summary.ht.nashconv.toFixed(3)}
              </div>
            </div>
            <div className="rounded-lg bg-slate-800/60 p-2.5">
              <div className="text-slate-500">Per-hand diagnostics</div>
              <div className="mt-0.5">
                {doc.summary.gate_only ? (
                  <span
                    className="text-slate-500"
                    title="This run skipped the per-hand comparison entirely (the watcher's fast path). The cross-check badge above is the correctness statement; eyeball specific hands in the /solutions viewer."
                  >
                    skipped (gate-only)
                  </span>
                ) : doc.summary.diagnostics_weighted === false ||
                  doc.summary.mean_l1 == null ||
                  doc.summary.mean_ev_diff == null ? (
                  <span
                    className="text-slate-500"
                    title="Pio reported zero global frequency on every line of this board, so there was no weight to normalize the per-hand comparison against. The cross-check badge above is unaffected - it is the correctness statement."
                  >
                    unavailable on this board
                  </span>
                ) : (
                  <>
                    mean L1 {doc.summary.mean_l1.toFixed(3)} · mean |ΔEV|{" "}
                    {doc.summary.mean_ev_diff.toFixed(2)}
                  </>
                )}
              </div>
            </div>
          </div>

          {runLog && (
            <details className="mt-4 text-xs text-slate-500">
              <summary className="cursor-pointer">Solver run log</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900/70 p-3 text-[11px]">
                {runLog}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
};

export default SolverCompare;
