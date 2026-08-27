/** Waterfall breakdown of one compare-pipeline run: where the wall clock
 *  went between clicking "Solve & compare" and seeing results.
 *
 *  Every duration comes from a single clock (watcher perf_counter, browser
 *  performance.now(), or the API server for queue wait); the "~" rows are
 *  derived remainders that absorb what no single clock can see - poll
 *  granularity, python startup, and clock skew between the three machines. */

export interface JobTimings {
  schema?: number | null;
  // Watcher (perf_counter around subprocesses).
  engine_solve_s?: number | null;
  compare_total_s?: number | null;
  upload_s?: number | null;
  // Harness phases, harvested from each payload's header.
  ht_extract_s?: number | null;
  pio_extract_s?: number | null;
  // Engine self-report, harvested from the artifact meta.
  ht_solve_s?: number | null;
  ht_setup_s?: number | null;
  ht_threads?: number | null;
  ht_iterations?: number | null;
  // engine_compare.py child phases, harvested from summary.timing.
  meta_load_s?: number | null;
  dump_load_s?: number | null;
  pio_spawn_s?: number | null;
  pio_setup_s?: number | null;
  pio_solve_s?: number | null;
  compare_loop_s?: number | null;
  cross_check_s?: number | null;
  accuracy_chips?: number | null;
}

/** Client-side marks from performance.now(), never stored server-side. */
export interface ClientMarks {
  submitMs?: number;
  fetchHeadersMs?: number;
  downloadParseMs?: number;
  renderMs?: number;
  /** Fetch + merge of PioSolver's payload, which arrives after the page has
   *  already rendered htsolver's. Absent on engine-only runs. */
  pioMergeMs?: number;
  totalMs?: number;
}

/** The structural slice of CompareJob the panel needs. */
export interface PipelineJob {
  id: string;
  mode: "compare" | "publish";
  createdAtUtc: string;
  claimedAtUtc: string | null;
  completedAtUtc: string | null;
  timings: JobTimings | null;
}

export interface PipelineRun {
  job: PipelineJob;
  marks: ClientMarks;
}

/** Wall-clock, readable at both ends of the range this page sees (a river
 *  solve is under a second; a Pio flop solve is minutes). */
export const secs = (v: number): string =>
  v >= 60
    ? `${Math.floor(v / 60)}m ${Math.round(v % 60)}s`
    : v >= 10
      ? `${v.toFixed(1)}s`
      : `${v.toFixed(2)}s`;

type Source = "client" | "server" | "engine" | "pio" | "watcher";

interface Row {
  key: string;
  label: string;
  seconds: number;
  source: Source;
  note?: string;
  /** Derived remainder rather than a direct measurement. */
  approx?: boolean;
}

const BAR: Record<Source, string> = {
  client: "bg-amber-400/80",
  server: "bg-violet-400/80",
  engine: "bg-emerald-400/80",
  pio: "bg-sky-400/80",
  watcher: "bg-slate-400/70",
};

const TAG: Record<Source, string> = {
  client: "text-amber-300/80",
  server: "text-violet-300/80",
  engine: "text-emerald-300/80",
  pio: "text-sky-300/80",
  watcher: "text-slate-400",
};

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const spanSecs = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const d = (Date.parse(b) - Date.parse(a)) / 1000;
  return Number.isFinite(d) && d >= 0 ? d : null;
};

const PipelineTimingPanel = ({ job, marks }: PipelineRun) => {
  const t = job.timings ?? {};
  const rows: Row[] = [];
  const push = (
    key: string,
    label: string,
    seconds: number | null,
    source: Source,
    note?: string,
    approx = false
  ) => {
    if (seconds == null) return;
    rows.push({ key, label, seconds: Math.max(0, seconds), source, note, approx });
  };
  const ms = (v: number | undefined): number | null => (v == null ? null : v / 1000);

  push("submit", "Submit", ms(marks.submitMs), "client", "POST /api/enginecompare round trip");
  push(
    "queue",
    "Queue wait",
    spanSecs(job.createdAtUtc, job.claimedAtUtc),
    "server",
    "job created until the watcher claimed it (includes the watcher's 5s claim poll)"
  );

  const engineNote = [
    num(t.ht_setup_s) != null ? `setup ${secs(t.ht_setup_s as number)}` : null,
    num(t.ht_solve_s) != null ? `solve ${secs(t.ht_solve_s as number)}` : null,
    num(t.ht_threads) != null ? `${t.ht_threads} threads` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  push("engine", "Engine solve", num(t.engine_solve_s), "engine", engineNote || undefined);

  const engineDump =
    num(t.meta_load_s) != null || num(t.dump_load_s) != null
      ? (num(t.meta_load_s) ?? 0) + (num(t.dump_load_s) ?? 0)
      : null;
  push("dump", "Engine dump", engineDump, "engine", "dump-json export + parse");
  push(
    "htrows",
    "htsolver rows",
    num(t.ht_extract_s),
    "engine",
    "per-hand strategy and EV read out of the engine dump, then packed"
  );
  push("spawn", "Pio spawn", num(t.pio_spawn_s), "pio", "PioSolver process start");
  push("build", "Pio tree build", num(t.pio_setup_s), "pio", "set_range + add_line + build_tree");
  push("piosolve", "Pio solve", num(t.pio_solve_s), "pio");
  push("piorows", "Pio rows", num(t.pio_extract_s), "pio", "per-node, per-hand UPI queries");
  push(
    "cross",
    "Cross-check",
    num(t.cross_check_s),
    "pio",
    "action map + engine strategy uploaded to Pio + calc_results"
  );

  const compareTotal = num(t.compare_total_s);
  if (compareTotal != null) {
    const childSum = [
      engineDump,
      num(t.ht_extract_s),
      num(t.pio_spawn_s),
      num(t.pio_setup_s),
      num(t.pio_solve_s),
      num(t.pio_extract_s),
      num(t.cross_check_s),
    ].reduce<number>((acc, v) => acc + (v ?? 0), 0);
    push(
      "harness",
      "Harness overhead",
      compareTotal - childSum,
      "watcher",
      "python startup, imports, payload writes",
      true
    );
  }

  push(
    "upload",
    job.mode === "publish" ? "Publish (export + upload)" : "Upload",
    num(t.upload_s),
    "watcher",
    job.mode === "publish"
      ? "artifact POST + server-side schema-4 export"
      : "gzip + upload to ADLS"
  );

  const watcherSpan = spanSecs(job.claimedAtUtc, job.completedAtUtc);
  const watcherAttrib =
    (num(t.engine_solve_s) ?? 0) + (compareTotal ?? 0) + (num(t.upload_s) ?? 0);
  if (watcherSpan != null && watcherAttrib > 0) {
    push(
      "watcher",
      "Watcher overhead",
      watcherSpan - watcherAttrib,
      "watcher",
      "claim handoff, report round trips, clock skew",
      true
    );
  }

  push("fetch", "Fetch result", ms(marks.fetchHeadersMs), "client", "result proxy, time to headers");
  push(
    "parse",
    "Download + parse",
    ms(marks.downloadParseMs),
    "client",
    "htsolver payload: body download, gunzip, header parse (fetch cannot separate them)"
  );
  push("render", "Render", ms(marks.renderMs), "client", "React render to painted frame");

  const total = ms(marks.totalMs);
  if (total != null) {
    const attributed = rows.reduce((acc, r) => acc + r.seconds, 0);
    push(
      "slack",
      "Poll slack",
      total - attributed,
      "client",
      "3s status-poll granularity plus whatever clock skew pushed out of the other rows",
      true
    );
  }
  // After the total: this lands once htsolver's half is already on screen, so
  // it is not part of the click-to-results measurement above.
  push(
    "piomerge",
    "Pio detail (after render)",
    ms(marks.pioMergeMs),
    "client",
    "PioSolver payload fetched and merged once the engine result was already showing"
  );

  const maxS = rows.reduce((acc, r) => Math.max(acc, r.seconds), 0);

  return (
    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Pipeline timing
        </h3>
        {total != null && (
          <span className="text-sm font-semibold tabular-nums text-white">
            {secs(total)} click to results
          </span>
        )}
      </div>

      {job.timings == null && (
        <p className="mt-1 text-[11px] text-slate-500">
          No stage timings - this job predates the instrumentation.
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-2 space-y-1">
          {rows.map((row) => (
            <div
              key={row.key}
              title={row.note}
              className="grid grid-cols-[7.5rem_1fr_4rem] items-center gap-2 sm:grid-cols-[9.5rem_1fr_4.5rem_3.5rem]"
            >
              <span className="truncate text-[11px] text-slate-400">{row.label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800/80">
                {row.seconds > 0 && maxS > 0 && (
                  <div
                    className={`h-full rounded-full ${BAR[row.source]}`}
                    style={{ width: `${Math.max(1.5, (row.seconds / maxS) * 100)}%` }}
                  />
                )}
              </div>
              <span className="text-right text-[11px] tabular-nums text-slate-200">
                {row.approx ? "~" : ""}
                {secs(row.seconds)}
              </span>
              <span className={`hidden text-right text-[10px] sm:block ${TAG[row.source]}`}>
                {row.source}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 border-t border-slate-800 pt-2 text-[11px] leading-relaxed text-slate-500">
        Each stage is timed on its own machine's clock; hover a row for what it covers.
        Rows marked ~ are remainders, not measurements - they soak up poll intervals
        (3s status poll, 5s watcher claim poll) and clock differences.
      </p>
    </div>
  );
};

export default PipelineTimingPanel;
