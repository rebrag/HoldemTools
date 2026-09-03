// src/pages/multiway/GroupRangesView.tsx
//
// A saved group, opened rather than simulated: every seat's chart for every
// solve in it, as if the action folded to that seat. One row per solve in
// rotation order, one Plate per seat in acting order, over the same felt
// backdrop the /solutions multi-range views use - so a four-solve, four-way
// group reads as a 4x4 board of the pair's opening strategies. The big blind
// gets no decision when it folds to them, so its plate holds face-down
// cards instead of a matrix.
//
// Team seats carry the partner-hand select at the top of their plate; the
// colour key under any plate opens that solve at that node with that action
// taken, which is how a chart here becomes a line to walk.
import React, { useCallback, useMemo, useState } from "react";
import { CardBack } from "@/components/PokerTableSeat";
import { PokerTableBackdrop } from "@/components/PokerTableSurface";
import useElementSize from "@/hooks/useElementSize";
import Plate from "@/pages/solver/Plate";
import { isOpenable, type CompareJob, type JobSpot } from "./compareJob";
import {
  actingOrder,
  chipScale,
  conditionedJsonDataFor,
  fileForSeat,
  fmtBb,
  foldToNode,
  jsonDataFor,
  pathWithSeatAction,
  seatLabelsOf,
} from "./lineModel";
import PartnerHandSelect from "./PartnerHandSelect";
import { fmtCount, type PushFoldDump } from "./pushfoldResult";
import type { SolveGroup } from "./solveGroupsApi";
import { spotTitle } from "./solveIdentity";
import { PhaseBadge } from "./SolvesDrawer";
import type { LoadedDump } from "./useDumps";

/* The narrowest a 13x13 grid stays readable at; the row packs as many plates
 * as fit at that width, up to one per seat. */
const MIN_PLATE_PX = 150;
const GAP_PX = 8;

const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

/* One node for every plate that has no decision, so the memoized Plate sees
 * the same prop each render. */
const NO_DECISION = (
  <div className="flex flex-col items-center gap-2 px-2 text-center text-[10px] text-slate-300">
    <div className="flex gap-1">
      <CardBack w={34} />
      <CardBack w={34} />
    </div>
    <span>No decision: it folds to the big blind.</span>
  </div>
);

/* Stands in for the partner select on the plates of a row that has one, so
 * every matrix in the row starts at the same height. Sized to the dense
 * select's row. */
const HEADER_SPACER = <div aria-hidden="true" className="h-[23px]" />;

const GroupPlate = React.memo(
  ({
    dump,
    seat,
    jobId,
    isHero,
    isButton,
    reserveHeader,
    onOpenJob,
  }: {
    dump: PushFoldDump;
    seat: number;
    jobId: string;
    isHero: boolean;
    isButton: boolean;
    /** The row has team seats: keep this plate's matrix level with theirs. */
    reserveHeader: boolean;
    onOpenJob: (id: string, path?: number[]) => void;
  }) => {
    const target = useMemo(() => foldToNode(dump, seat), [dump, seat]);
    const rollup = target ? dump.metadata.team_rollup?.[String(target.node.node_id)] : undefined;
    const [partnerClass, setPartnerClass] = useState<number | null>(null);
    const partnerLabel = rollup
      ? seatLabelsOf(dump)[rollup.partner] ?? `P${rollup.partner}`
      : "";

    const data = useMemo(() => {
      if (!target) return jsonDataFor(dump, null, seat);
      if (rollup && partnerClass != null) {
        return conditionedJsonDataFor(dump, target.node, rollup, partnerClass, seat);
      }
      return jsonDataFor(dump, target.node, seat);
    }, [dump, target, rollup, partnerClass, seat]);

    const scale = chipScale(dump);
    const node = target?.node ?? dump.nodes["0"];
    const commit = node?.commit ?? [];
    const playerBet = (commit[seat] ?? 0) / scale;
    const maxBet = commit.length > 0 ? Math.max(...commit) / scale : 0;
    const pot = (node?.pot ?? 0) / scale;

    const onActionClick = useCallback(
      (action: string) => {
        const path = pathWithSeatAction(dump, [], seat, action);
        if (path) onOpenJob(jobId, path);
      },
      [dump, seat, jobId, onOpenJob]
    );

    const header = useMemo(
      () =>
        rollup ? (
          <PartnerHandSelect
            dense
            rollup={rollup}
            partnerLabel={partnerLabel}
            value={partnerClass}
            onChange={setPartnerClass}
          />
        ) : reserveHeader ? (
          HEADER_SPACER
        ) : undefined,
      [rollup, partnerLabel, partnerClass, reserveHeader]
    );

    return (
      <Plate
        file={fileForSeat(seat)}
        plateId={`${jobId}:${seat}`}
        data={data}
        onActionClick={onActionClick}
        alive
        isActive={false}
        isHero={isHero}
        isButton={isButton}
        playerBet={playerBet}
        pot={pot}
        maxBet={maxBet}
        heightMode="full"
        header={header}
        placeholder={target ? undefined : NO_DECISION}
      />
    );
  }
);
GroupPlate.displayName = "GroupPlate";

const GroupSolveRow = ({
  index,
  jobId,
  job,
  loaded,
  cols,
  onOpenJob,
}: {
  index: number;
  jobId: string;
  job: CompareJob | undefined;
  loaded: LoadedDump | undefined;
  cols: number;
  onOpenJob: (id: string, path?: number[]) => void;
}) => {
  const dump = loaded && "dump" in loaded ? loaded.dump : null;
  const meta = dump?.metadata;
  const scale = dump ? chipScale(dump) : 1;
  const teamSeats = meta?.team?.seats ?? [];
  const teamName = meta
    ? teamSeats.map((s) => meta.seats[s] ?? s).join("+")
    : null;
  const order = dump ? actingOrder(dump) : [];
  const button = meta?.preflop?.button;

  let status: React.ReactNode = null;
  if (!job) {
    status = <span className="text-amber-400">not among your solves any more</span>;
  } else if (!isOpenable(job)) {
    status = <span className="text-slate-500">no result to show · {job.status}</span>;
  } else if (!loaded) {
    status = (
      <span className="flex items-center gap-2 text-slate-400">
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-emerald-400"
        />
        loading
      </span>
    );
  } else if ("error" in loaded) {
    status = <span className="text-red-400">{loaded.error}</span>;
  }

  return (
    <section className="relative shrink-0 overflow-hidden rounded-xl border border-slate-800/70 p-2">
      <PokerTableBackdrop className="opacity-70" />
      <div className="relative z-10 mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="tabular-nums text-slate-400">{index + 1}</span>
        <PhaseBadge spot={job?.spot} />
        {meta?.solve_id && <span className="font-mono text-slate-300">{meta.solve_id}</span>}
        {meta && (
          <span className="tabular-nums text-slate-400">{fmtCount(meta.iterations)} iters</span>
        )}
        {meta?.team && (
          <span
            className="rounded-full border border-amber-800 bg-slate-950/50 px-2 py-0.5 text-amber-300"
            title="The pair's summed EV per hand, in big blinds."
          >
            team {teamName}{" "}
            <span className="tabular-nums">{signed(meta.team.ev_chips / scale)} bb</span>
          </span>
        )}
        {meta && <span className="text-slate-400">pot {fmtBb(meta.pot / scale)}</span>}
        {status}
        {job && isOpenable(job) && (
          <button
            type="button"
            onClick={() => onOpenJob(jobId)}
            className="ml-auto rounded border border-emerald-700/70 bg-slate-950/50 px-2 py-0.5 text-[10px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/10"
            title="Open this solve on its own and walk its line"
          >
            Open
          </button>
        )}
      </div>
      {dump && (
        <div
          className="relative z-10 grid"
          style={{ gap: GAP_PX, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {order.map((seat) => (
            <GroupPlate
              key={seat}
              dump={dump}
              seat={seat}
              jobId={jobId}
              isHero={teamSeats.includes(seat)}
              isButton={button != null && seat === button}
              reserveHeader={teamSeats.length > 0}
              onOpenJob={onOpenJob}
            />
          ))}
        </div>
      )}
    </section>
  );
};

const GroupRangesView = ({
  group,
  jobsById,
  loaded,
  onOpenJob,
  className = "",
}: {
  group: SolveGroup;
  jobsById: Map<string, CompareJob>;
  loaded: Record<string, LoadedDump>;
  /** Open one member as the page's result, optionally at a line. */
  onOpenJob: (id: string, path?: number[]) => void;
  className?: string;
}) => {
  const { ref, width } = useElementSize<HTMLDivElement>({ hysteresis: 8 });
  const seatsMax = useMemo(() => {
    let n = 0;
    for (const id of group.jobIds) {
      const l = loaded[id];
      if (l && "dump" in l) n = Math.max(n, l.dump.metadata.seats.length);
    }
    return n || 2;
  }, [group.jobIds, loaded]);
  /* As many plates across as stay readable, up to one per seat: a 4-way
   * group is one row of four on a desktop pane and two-by-two on a phone. */
  const cols =
    width > 0
      ? Math.max(1, Math.min(seatsMax, Math.floor((width + GAP_PX) / (MIN_PLATE_PX + GAP_PX))))
      : 2;
  const spot = group.jobIds
    .map((id) => jobsById.get(id)?.spot)
    .find((s): s is JobSpot => s != null);

  return (
    <section
      className={`flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3 lg:overflow-y-auto ${className}`}
    >
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-white">{group.name}</h2>
        <span className="text-[11px] text-slate-500">
          {group.jobIds.length === 1 ? "1 solve" : `${group.jobIds.length} solves`} · every
          seat{"'"}s chart as if it folded to them
        </span>
        {spot && <span className="text-[11px] text-slate-300">{spotTitle(spot)}</span>}
      </div>
      <div ref={ref} className="flex flex-col gap-2">
        {group.jobIds.map((id, i) => (
          <GroupSolveRow
            key={`${id}-${i}`}
            index={i}
            jobId={id}
            job={jobsById.get(id)}
            loaded={loaded[id]}
            cols={cols}
            onOpenJob={onOpenJob}
          />
        ))}
      </div>
    </section>
  );
};

export default GroupRangesView;
