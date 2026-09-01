// src/pages/multiway/MultiwaySolver.tsx
//
// The multiway preflop workbench: build an N-seat jam-or-fold tree, queue it
// to htsolver, and read the resulting push/fold charts back.
//
// Laid out after /compare - a workbench that owns the viewport rather than a
// document, with the tree builder in a ResponsiveDrawer. It used to be a
// two-column grid with the builder in flow, and since that builder is ~370
// lines tall and the grid only engaged at xl, the charts sat below the fold
// on everything narrower than a wide desktop.
//
// URL-only, no navbar slot, following /compare's precedent for solver-engine
// surfaces. The engine-core tabs live at the top of the builder drawer - both
// engine pages render EngineCoreTabs there - which is what says which core a
// tree is being built for and what makes the two reachable from each other.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EngineCoreTabs from "@/components/EngineCoreTabs";
import PokerTable from "@/components/PokerTable";
import type { PokerTableSeatData } from "@/components/PokerTableSeat";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import { authedFetch } from "@/lib/api";
import MultiwayTreeBuilder from "./MultiwayTreeBuilder";
import PushFoldResultPanel from "./PushFoldResultPanel";
import type { PushFoldDump } from "./pushfoldResult";
import {
  DEFAULT_VIEW,
  actionOrder,
  blindSeats,
  buildMultiwayConfig,
  effectiveBb,
  potChips,
  seatLabels,
  validate,
  viewFromDump,
  type MultiwayView,
} from "./multiwayView";

type JobStatus = "Queued" | "Claimed" | "Running" | "Uploading" | "Done" | "Failed";
interface CompareJob {
  id: string;
  mode?: string;
  board?: string | null;
  status: JobStatus;
  error?: string | null;
  hasHtResult?: boolean;
  createdAtUtc?: string;
  completedAtUtc?: string | null;
}

const ago = (iso?: string | null): string => {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
};

const STATUS_TONE: Record<JobStatus, string> = {
  Queued: "text-slate-400",
  Claimed: "text-slate-300",
  Running: "text-sky-300",
  Uploading: "text-sky-300",
  Done: "text-emerald-400",
  Failed: "text-red-400",
};

const TERMINAL: JobStatus[] = ["Done", "Failed"];
const POLL_MS = 3000;
const DEADLINE_MS = 20 * 60 * 1000;

const MultiwaySolver = () => {
  const [view, setView] = useState<MultiwayView>(DEFAULT_VIEW);
  const [job, setJob] = useState<CompareJob | null>(null);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dump, setDump] = useState<PushFoldDump | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<CompareJob[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /* Open on arrival: with no result loaded the page has nothing to show, and
   * building a tree is what you came for. loadResult closes it once there is
   * a chart, so a solve ends on its answer rather than behind the form. */
  const [builderOpen, setBuilderOpen] = useState(true);
  const cancelled = useRef(false);

  /* Re-arm on mount, not just disarm on unmount. StrictMode mounts, unmounts
   * and remounts every effect in development, so a cleanup-only version sets
   * this true a tick after the first mount and never clears it - and the poll
   * loop below then bails on its first iteration, silently, leaving the page
   * looking like the solve never happened. It is wrong in production too, just
   * harder to reach: any remount would kill polling for good. */
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

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
  const pot = potChips(view);

  /* Seats are display-only in PokerTable (the whole cluster is one button), so
   * stacks are edited in the builder's list and the table shows the posted
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
    const text = await resp.text();
    // A compare-mode watcher uploads the binary per-node .htc payload to the
    // same slot. Naming that explicitly is worth a branch: the alternative is
    // a raw "Unexpected token 'H'" from JSON.parse, which says nothing about
    // what to do, and the cause - a watcher running a build without
    // handle_pushfold - is entirely actionable.
    if (text.startsWith("HTCMP")) {
      throw new Error(
        "This job was solved by a watcher build that predates the pushfold mode, so it " +
          "uploaded a compare-mode .htc payload instead of a push/fold chart. Restart the " +
          "watcher and solve again."
      );
    }
    let parsed: PushFoldDump;
    try {
      parsed = JSON.parse(text) as PushFoldDump;
    } catch {
      throw new Error("The stored result is not a push/fold payload.");
    }
    setDump(parsed);
    setViewingId(id);
    /* Move the builder onto the spot that was actually solved. The table, the
     * seat labels and the action order all read `view`, so without this a
     * 6-way chart renders beside a 4-way table left over from whatever was
     * last typed. Functional form so this callback keeps an empty dependency
     * list and is not rebuilt on every keystroke; a payload too old to carry
     * the preflop metadata returns null and the current view stands. */
    setView((cur) => viewFromDump(parsed.metadata, cur) ?? cur);
    setBuilderOpen(false);
  }, []);

  /* The queue is the durable record: the job row and its ADLS blob both
   * outlive the page, so a finished solve stays reachable after a reload
   * rather than living only in component state. Filtered to this mode - the
   * same endpoint carries /compare's postflop jobs. */
  const refreshJobs = useCallback(async () => {
    try {
      const resp = await authedFetch("/api/enginecompare?limit=50");
      if (!resp.ok) return;
      const all = (await resp.json()) as CompareJob[];
      setJobs(all.filter((j) => j.mode === "pushfold"));
    } catch {
      // A failed history fetch must not break the builder; the list simply
      // stays as it was.
    }
  }, []);

  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  const deleteJob = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const resp = await authedFetch(`/api/enginecompare/${id}`, { method: "DELETE" });
        if (!resp.ok && resp.status !== 404) {
          throw new Error((await resp.text()) || `Delete failed (${resp.status})`);
        }
        // Drop it locally rather than waiting for the refetch, so the row
        // disappears on click; the refresh below then reconciles.
        setJobs((list) => list.filter((j) => j.id !== id));
        setViewingId((current) => {
          if (current !== id) return current;
          setDump(null);
          return null;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        void refreshJobs();
      }
    },
    [refreshJobs]
  );

  const openJob = useCallback(
    async (id: string) => {
      setError(null);
      setDump(null);
      try {
        await loadResult(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [loadResult]
  );

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
      void refreshJobs();

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
      void refreshJobs();
    }
  }, [view, loadResult, refreshJobs]);

  const downloadConfig = useCallback(() => {
    const blob = new Blob([JSON.stringify(buildMultiwayConfig(view), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pushfold_${view.players}way.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [view]);

  return (
    /* A workbench, not a document: the page owns the viewport below the 3rem
       navbar and lays itself out inside it, so the charts never end up under
       the builder. The builder itself lives in the drawer at the bottom of
       this file, exactly as /compare hosts TreeBuilding. */
    <div className="flex h-[calc(100dvh-48px)] w-full flex-col gap-2 overflow-hidden px-3 py-2 text-slate-200">
      {/* ---------- header: identity, the spot, the way into the builder ---------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-sm font-semibold tracking-tight text-white">
          Multiway preflop solver
        </h1>
        <span className="text-[11px] text-slate-500">
          <span className="font-medium text-emerald-400">htsolver</span> jam-or-fold
        </span>

        {/* The spot, so the tree is legible with the builder closed. Reads
            `view`, which loadResult now moves onto whatever solve is open. */}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-slate-400">
          <span className="font-medium text-slate-300">{view.players}-way</span>
          <span>
            {view.smallBlind}/{view.bigBlind}
            {anteEach > 0 ? ` +${view.ante} ante` : ""}
          </span>
          <span>pot {pot}</span>
          {Number.isFinite(bbCount) && <span>{bbCount.toFixed(1)} bb</span>}
          <span>button {labels[view.button]}</span>
          {view.teamSeats.length === 2 && (
            <span className="rounded-full border border-amber-800 px-2 py-0.5 text-amber-300">
              team {labels[view.teamSeats[0]]}+{labels[view.teamSeats[1]]}
            </span>
          )}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setBuilderOpen(true)}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500"
          >
            Tree builder
          </button>
        </div>
      </div>

      {/* Recent solves stay on the page rather than inside the builder: they
          are how a previous solve gets re-opened, which belongs beside the
          charts - and a list inside a drawer would be unreachable from here.
          One line that scrolls, rather than a block that wraps. */}
      {jobs.length > 0 && (
        <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto">
          <span className="shrink-0 text-[11px] font-medium text-slate-500">Recent</span>
          {jobs.map((j) => {
            const openable = j.status === "Done" && j.hasHtResult !== false;
            const finished = j.status === "Done" || j.status === "Failed";
            return (
              /* Two buttons per entry rather than /compare's one, because
                 delete is a real feature here and a button cannot nest. */
              <span
                key={j.id}
                className={`inline-flex shrink-0 items-stretch overflow-hidden rounded-md border transition-colors ${
                  viewingId === j.id
                    ? "border-emerald-600/70 bg-emerald-500/10"
                    : "border-slate-700 bg-slate-950/40"
                }`}
              >
                <button
                  type="button"
                  disabled={!openable}
                  onClick={() => void openJob(j.id)}
                  title={j.error ?? (openable ? "Load this solve" : j.status)}
                  className={`flex items-center gap-2 whitespace-nowrap px-2 py-0.5 text-[11px] transition-colors ${
                    openable
                      ? "text-slate-200 hover:bg-emerald-500/10"
                      : "cursor-not-allowed text-slate-500"
                  }`}
                >
                  <span className="font-medium">{j.board || "preflop"}</span>
                  <span className="tabular-nums text-slate-500">
                    {ago(j.completedAtUtc ?? j.createdAtUtc)}
                  </span>
                  <span className={STATUS_TONE[j.status]}>{j.status}</span>
                </button>
                {/* Two clicks, not a confirm dialog: the solve is cheap to
                    re-run and a modal for every row would be worse than the
                    mistake it prevents. A running job has no delete at all -
                    the watcher would report into a row that no longer
                    exists. */}
                <button
                  type="button"
                  aria-disabled={!finished}
                  onClick={() => {
                    if (!finished) return;
                    if (confirmingDelete === j.id) void deleteJob(j.id);
                    else setConfirmingDelete(j.id);
                  }}
                  onBlur={() => setConfirmingDelete((c) => (c === j.id ? null : c))}
                  title={
                    finished
                      ? confirmingDelete === j.id
                        ? "Click again to delete this solve and its stored result"
                        : "Delete this solve"
                      : "Still running - it can be deleted once it finishes"
                  }
                  aria-label={`Delete the ${j.board || "preflop"} solve from ${ago(
                    j.completedAtUtc ?? j.createdAtUtc
                  )}`}
                  className={`shrink-0 border-l border-slate-800 px-1.5 text-[11px] transition-colors ${
                    !finished
                      ? "cursor-not-allowed text-slate-700"
                      : confirmingDelete === j.id
                        ? "bg-red-500/20 font-semibold text-red-300"
                        : "text-slate-600 hover:bg-red-500/10 hover:text-red-300"
                  }`}
                >
                  {confirmingDelete === j.id ? "Sure?" : "×"}
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={() => void refreshJobs()}
            className="shrink-0 px-1 text-[10px] text-slate-500 transition-colors hover:text-slate-300"
          >
            Refresh
          </button>
        </div>
      )}

      {/* A queued job outlives the drawer, so its status has to live on the
          page too - closing the builder must not look like it stopped. */}
      {solving && !builderOpen && (
        <p className="flex shrink-0 items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300">
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-emerald-400"
          />
          Solving{job ? ` · ${job.status}` : ""} · {(elapsed / 1000).toFixed(0)}s - this keeps
          running if you leave the page.
        </p>
      )}
      {error && !builderOpen && (
        <p className="shrink-0 rounded-lg bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300">
          {error}
        </p>
      )}

      {/* ---------- the table, then the charts ----------
           Side by side on a desktop so neither scrolls the page; stacked into
           one scroller below lg, where the table is small and the charts are
           what the height is for. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* justify-center, because the rail is as tall as the charts beside
            it and the felt is not: without it the table sits pinned to the
            top of a mostly empty card. */}
        <div className="flex shrink-0 flex-col justify-center rounded-xl border border-slate-800 bg-slate-900/40 p-3 lg:w-[20rem] xl:w-[24rem]">
          <PokerTable
            size={view.players}
            seats={seats}
            potAmount={pot}
            potLabel={`Pot ${pot}`}
            maxWidthClassName="max-w-xl"
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {dump ? (
            /* From lg the panel gets a definite height and sizes its grid from
               whatever is left after its own chrome. Below lg it stays
               auto-height and this column scrolls, which is the only thing
               that fits a 13x13 grid on a phone. */
            <PushFoldResultPanel dump={dump} className="lg:min-h-0 lg:flex-1" />
          ) : (
            <div className="flex min-h-[10rem] flex-1 items-center justify-center rounded-xl border border-dashed border-slate-800 px-4 py-10 text-center text-[11px] text-slate-500">
              {solving
                ? "Waiting for the watcher to pick this up and solve it."
                : "Solve to see each seat's jam/fold chart, or open one from Recent."}
            </div>
          )}
        </div>
      </div>

      {/* ---------- tree builder, in a drawer so opening it does not push the
           charts down the page ---------- */}
      <ResponsiveDrawer
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        scrollMode="custom"
        desktopMaxWidthClassName="sm:max-w-4xl"
        zClassName="z-[70]"
        ariaLabel="Multiway preflop tree builder"
      >
        <div className="flex h-[88vh] max-h-[88vh] flex-col">
          {/* The engine-core tabs ARE this drawer's header: they name which
              solver the tree below is being built for. /compare renders the
              same control above its own builder. */}
          <div className="border-b border-slate-800 px-4 py-3 pr-12">
            <EngineCoreTabs value="multiway" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <MultiwayTreeBuilder
              value={view}
              onChange={setView}
              disabled={solving}
              issues={issues}
              error={error}
              onSolve={() => void solve()}
              onDownloadConfig={downloadConfig}
              statusSlot={
                solving && job ? (
                  <span className="text-[11px] tabular-nums text-slate-400">
                    {job.status} · {(elapsed / 1000).toFixed(0)}s
                  </span>
                ) : null
              }
            />
          </div>
        </div>
      </ResponsiveDrawer>
    </div>
  );
};

export default MultiwaySolver;
