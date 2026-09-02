// src/pages/multiway/SolvesDrawer.tsx
//
// Every saved solve, with room to tell them apart. The page's Recent strip
// is one line and can only ever show the last few; this is the whole
// library, sectioned by spot (seats, stacks, blinds, button) with each row
// saying which phase it is and where the team sits - the things a
// "4-way · Done" chip cannot. The user's saved groups sit at the top, since
// a group is the thing you come here to play in the session simulator.
//
// Rows open, stop and delete exactly as the strip's chips do; the page
// passes the same callbacks to both.
import { useMemo, useState } from "react";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import { fmtCount } from "./pushfoldResult";
import {
  ago,
  isFinished,
  isOpenable,
  jobTime,
  STATUS_TONE,
  type CompareJob,
  type JobSpot,
} from "./compareJob";
import { phaseOf, spotKey, spotTitle } from "./solveIdentity";
import type { SolveGroup } from "./solveGroupsApi";

export interface SolveActions {
  onOpen: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}

/** The phase pill: amber for a team solve, slate for the baseline. The one
 *  glyph every list on the page shares, so a solve reads the same in the
 *  strip, the drawer and the simulator. */
export const PhaseBadge = ({
  spot,
  detail = true,
  className = "",
}: {
  spot: JobSpot | null | undefined;
  /** Also print what follows the badge ("baseline", "team SB+BB"). */
  detail?: boolean;
  className?: string;
}) => {
  const phase = phaseOf(spot);
  if (!phase) return null;
  return (
    <span
      title={phase.long}
      className={`inline-flex items-center gap-1 whitespace-nowrap text-[10px] ${className}`}
    >
      <span
        className={`rounded px-1 py-px font-semibold leading-tight ${
          phase.phase === 2
            ? "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-700/60"
            : "bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-600/60"
        }`}
      >
        {phase.short}
      </span>
      {detail && (
        <span className={phase.phase === 2 ? "text-amber-200/90" : "text-slate-400"}>
          {phase.what}
        </span>
      )}
    </span>
  );
};

const smallBtn =
  "rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40";
const pill = (active: boolean) =>
  `rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
    active
      ? "border-emerald-600/70 bg-emerald-500/10 text-emerald-200"
      : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
  }`;

type PhaseFilter = "all" | "1" | "2";

/** One solve, as a row. `compact` is the chip form the group list uses. */
export const SolveRow = ({
  job,
  viewing,
  stopping,
  confirmingDelete,
  onConfirmDelete,
  actions,
}: {
  job: CompareJob;
  viewing: boolean;
  stopping: boolean;
  confirmingDelete: boolean;
  onConfirmDelete: (id: string | null) => void;
  actions: SolveActions;
}) => {
  const openable = isOpenable(job);
  const finished = isFinished(job);
  return (
    <li
      className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
        viewing ? "border-emerald-600/70 bg-emerald-500/10" : "border-slate-800 bg-slate-950/40"
      }`}
    >
      <button
        type="button"
        disabled={!openable}
        onClick={() => actions.onOpen(job.id)}
        title={job.error ?? (openable ? "Open this solve" : job.status)}
        className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-left ${
          openable ? "text-slate-200" : "cursor-not-allowed text-slate-500"
        }`}
      >
        <PhaseBadge spot={job.spot} />
        {job.spot == null && <span className="font-medium">{job.board || "preflop"}</span>}
        {job.iterations != null && (
          <span className="tabular-nums text-slate-500">{fmtCount(job.iterations)} iters</span>
        )}
        <span className="tabular-nums text-slate-500">{ago(jobTime(job))}</span>
        <span className={STATUS_TONE[job.status]}>
          {!finished && stopping ? "Stopping" : job.status}
        </span>
        {job.solveId && (
          <span className="font-mono text-[10px] text-slate-600" title="Solve id (the lineage)">
            {job.solveId}
          </span>
        )}
      </button>
      {finished ? (
        <button
          type="button"
          onClick={() => {
            if (confirmingDelete) actions.onDelete(job.id);
            else onConfirmDelete(job.id);
          }}
          onBlur={() => onConfirmDelete(null)}
          title={
            confirmingDelete
              ? "Click again to delete this solve and its stored result"
              : "Delete this solve"
          }
          aria-label="Delete this solve"
          className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
            confirmingDelete
              ? "bg-red-500/20 font-semibold text-red-300"
              : "text-slate-600 hover:bg-red-500/10 hover:text-red-300"
          }`}
        >
          {confirmingDelete ? "Sure?" : "×"}
        </button>
      ) : (
        <button
          type="button"
          disabled={stopping}
          onClick={() => actions.onStop(job.id)}
          title={
            stopping
              ? "Stopping - the engine is writing out what it solved so far"
              : "Stop this solve and keep what it has solved so far"
          }
          aria-label="Stop this solve"
          className={`shrink-0 rounded px-1.5 py-1 transition-colors ${
            stopping
              ? "cursor-default text-amber-400/60"
              : "text-slate-600 hover:bg-amber-500/10 hover:text-amber-300"
          }`}
        >
          <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden="true">
            <rect width="10" height="10" rx="1.5" fill="currentColor" />
          </svg>
        </button>
      )}
    </li>
  );
};

const GroupRow = ({
  group,
  jobsById,
  onSimulate,
  onRename,
  onDelete,
}: {
  group: SolveGroup;
  jobsById: Map<string, CompareJob>;
  onSimulate: (id: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) => {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playable = group.jobIds.filter((id) => {
    const j = jobsById.get(id);
    return j && isOpenable(j);
  }).length;

  const commitRename = async () => {
    const name = (renaming ?? "").trim();
    if (!name || name === group.name) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRename(group.id, name);
      setRenaming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950/40 px-2 py-1.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        {renaming != null ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void commitRename();
            }}
          >
            <input
              autoFocus
              value={renaming}
              disabled={busy}
              maxLength={100}
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setRenaming(null);
              }}
              aria-label="Group name"
              className="w-40 rounded border border-slate-700 bg-slate-800/70 px-1.5 py-0.5 text-[11px] text-slate-200"
            />
            <button type="submit" disabled={busy} className={smallBtn}>
              Save
            </button>
            <button type="button" disabled={busy} onClick={() => setRenaming(null)} className={smallBtn}>
              Cancel
            </button>
          </form>
        ) : (
          <span className="font-semibold text-slate-100">{group.name}</span>
        )}
        <span className="text-slate-500">
          {group.jobIds.length === 1 ? "1 solve" : `${group.jobIds.length} solves`}
          {playable < group.jobIds.length && (
            <span className="text-amber-400"> · {group.jobIds.length - playable} unavailable</span>
          )}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={playable === 0}
            onClick={() => onSimulate(group.id)}
            className="rounded border border-emerald-700/70 px-2 py-0.5 text-[10px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            title="Load this group as the session simulator's rotation"
          >
            Simulate
          </button>
          {renaming == null && (
            <button type="button" onClick={() => setRenaming(group.name)} className={smallBtn}>
              Rename
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!confirming) {
                setConfirming(true);
                return;
              }
              setBusy(true);
              void onDelete(group.id)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false));
            }}
            onBlur={() => setConfirming(false)}
            className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
              confirming
                ? "bg-red-500/20 font-semibold text-red-300"
                : "text-slate-600 hover:bg-red-500/10 hover:text-red-300"
            }`}
            title={confirming ? "Click again to delete this group (its solves stay)" : "Delete this group"}
          >
            {confirming ? "Sure?" : "×"}
          </button>
        </span>
      </div>
      {/* The rotation, in order: what the group will play. */}
      <ol className="mt-1 flex flex-wrap gap-1">
        {group.jobIds.map((id, i) => {
          const j = jobsById.get(id);
          return (
            <li
              key={`${id}-${i}`}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 ${
                j && isOpenable(j) ? "border-slate-800 bg-slate-900/60" : "border-amber-900/60 text-amber-400"
              }`}
            >
              <span className="tabular-nums text-slate-600">{i + 1}</span>
              {j ? <PhaseBadge spot={j.spot} /> : <span>not in your solves</span>}
              {j && j.spot == null && <span className="text-slate-400">{j.board || "preflop"}</span>}
            </li>
          );
        })}
      </ol>
      {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
    </li>
  );
};

const SolvesDrawer = ({
  open,
  onClose,
  jobs,
  viewingId,
  cancelling,
  actions,
  onRefresh,
  groups,
  groupsError,
  onSimulateGroup,
  onRenameGroup,
  onDeleteGroup,
}: {
  open: boolean;
  onClose: () => void;
  jobs: CompareJob[];
  viewingId: string | null;
  cancelling: Set<string>;
  actions: SolveActions;
  onRefresh: () => void;
  groups: SolveGroup[];
  groupsError: string | null;
  onSimulateGroup: (id: string) => void;
  onRenameGroup: (id: string, name: string) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
}) => {
  const [players, setPlayers] = useState<number | null>(null);
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const playerCounts = useMemo(
    () =>
      Array.from(new Set(jobs.map((j) => j.spot?.players).filter((n): n is number => n != null))).sort(
        (a, b) => a - b
      ),
    [jobs]
  );

  /* Sections: one per spot, newest solve first inside each, sections in
   * the order their newest solve was queued. A row the server could not
   * summarise lands in a trailing "Other" section rather than nowhere. */
  const sections = useMemo(() => {
    const filtered = jobs.filter((j) => {
      if (players != null && j.spot?.players !== players) return false;
      if (phase !== "all") {
        const p = phaseOf(j.spot);
        if (!p || String(p.phase) !== phase) return false;
      }
      return true;
    });
    const byKey = new Map<string, { title: string; jobs: CompareJob[] }>();
    for (const j of filtered) {
      const key = spotKey(j.spot);
      const title = j.spot ? spotTitle(j.spot) : "Other";
      const hit = byKey.get(key);
      if (hit) hit.jobs.push(j);
      else byKey.set(key, { title, jobs: [j] });
    }
    const out = Array.from(byKey.entries()).map(([key, s]) => ({ key, ...s }));
    const other = out.findIndex((s) => s.key === "");
    if (other >= 0) out.push(...out.splice(other, 1));
    return out;
  }, [jobs, players, phase]);

  const shown = sections.reduce((acc, s) => acc + s.jobs.length, 0);

  return (
    <ResponsiveDrawer
      open={open}
      onClose={onClose}
      scrollMode="custom"
      desktopMaxWidthClassName="sm:max-w-3xl"
      zClassName="z-[70]"
      ariaLabel="Saved solves"
    >
      <div className="flex h-[88vh] max-h-[88vh] flex-col">
        <div className="border-b border-slate-800 px-4 py-3 pr-12">
          <h2 className="text-sm font-semibold text-slate-100">
            Solves <span className="font-normal text-slate-500">· {jobs.length}</span>
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            P1 is a spot's no-team baseline; P2 is a hand-sharing team solved on top of it, named
            by the seats that share. Group the solves a team rotates through and the session
            simulator can load them in one go.
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {/* ---------- groups ---------- */}
          <section>
            <div className="mb-1.5 flex items-center gap-2">
              <h3 className="text-xs font-semibold text-slate-200">Groups</h3>
              <span className="text-[10px] text-slate-500">
                saved rotations for the session simulator
              </span>
            </div>
            {groupsError && <p className="mb-1 text-[10px] text-red-400">{groupsError}</p>}
            {groups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-800 px-3 py-2 text-[11px] text-slate-500">
                No groups yet. Build a rotation in the session simulator and save it as a group;
                it will be here, and in the simulator's Group picker, next time.
              </p>
            ) : (
              <ul className="space-y-1">
                {groups.map((g) => (
                  <GroupRow
                    key={g.id}
                    group={g}
                    jobsById={jobsById}
                    onSimulate={onSimulateGroup}
                    onRename={onRenameGroup}
                    onDelete={onDeleteGroup}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* ---------- filters ---------- */}
          <section>
            <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h3 className="text-xs font-semibold text-slate-200">All solves</h3>
              {playerCounts.length > 1 && (
                <span className="flex items-center gap-1" role="group" aria-label="Filter by players">
                  <button type="button" onClick={() => setPlayers(null)} className={pill(players == null)}>
                    any seats
                  </button>
                  {playerCounts.map((n) => (
                    <button key={n} type="button" onClick={() => setPlayers(n)} className={pill(players === n)}>
                      {n}-way
                    </button>
                  ))}
                </span>
              )}
              <span className="flex items-center gap-1" role="group" aria-label="Filter by phase">
                {(
                  [
                    ["all", "any phase"],
                    ["1", "P1 baseline"],
                    ["2", "P2 team"],
                  ] as const
                ).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setPhase(key)} className={pill(phase === key)}>
                    {label}
                  </button>
                ))}
              </span>
              <span className="ml-auto flex items-center gap-2 text-[10px] text-slate-500">
                {shown !== jobs.length && <span>{shown} of {jobs.length}</span>}
                <button
                  type="button"
                  onClick={onRefresh}
                  className="transition-colors hover:text-slate-300"
                >
                  Refresh
                </button>
              </span>
            </div>
            {sections.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-800 px-3 py-2 text-[11px] text-slate-500">
                {jobs.length === 0 ? "No solves yet." : "Nothing matches these filters."}
              </p>
            ) : (
              <div className="space-y-3">
                {sections.map((s) => (
                  <div key={s.key}>
                    <h4 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      {s.title}
                      <span className="ml-1.5 normal-case tracking-normal text-slate-600">
                        {s.jobs.length}
                      </span>
                    </h4>
                    <ul className="space-y-1">
                      {s.jobs.map((j) => (
                        <SolveRow
                          key={j.id}
                          job={j}
                          viewing={viewingId === j.id}
                          stopping={cancelling.has(j.id) || !!j.cancelRequestedAtUtc}
                          confirmingDelete={confirmingDelete === j.id}
                          onConfirmDelete={(id) =>
                            setConfirmingDelete((c) => (id === null ? (c === j.id ? null : c) : id))
                          }
                          actions={actions}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </ResponsiveDrawer>
  );
};

export default SolvesDrawer;
