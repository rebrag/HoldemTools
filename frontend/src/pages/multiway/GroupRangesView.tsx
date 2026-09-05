// src/pages/multiway/GroupRangesView.tsx
//
// A saved group, opened rather than simulated: every seat's chart for every
// solve in it, on ONE screen. One card per solve in rotation order, one Plate
// per seat in acting order, over the felt backdrop the /solutions multi-range
// views use - so a four-solve, four-way group reads as a 4x4 board of the
// pair's opening strategies.
//
// Each card walks its own line. A plate's colour key takes that action for
// that seat (folding everyone in between first, or rewinding to the seat if
// it already acted), and the card's other plates turn into the reactions:
// the seat now on the spot lights up, folded seats fade, the pot moves.
// Reset puts the card back on "it folds to each seat". The big blind gets no
// decision on that line, so its plate holds face-down cards until someone
// jams.
//
// From lg the page is a fixed-height workbench, so the cards are laid out to
// FIT: the compact Plate (matrix beside a narrow sidebar) is sized from the
// height and width actually available, and the solve's caption sits beside
// its plates rather than above them. Below lg the page scrolls and the wide
// Plate stacks two abreast.
import React, { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { CardBack } from "@/components/PokerTableSeat";
import { PokerTableBackdrop } from "@/components/PokerTableSurface";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import useElementSize from "@/hooks/useElementSize";
import ColorKey from "@/pages/solver/ColorKey";
import DecisionMatrix from "@/pages/solver/DecisionMatrix";
import Plate, { type PlateZoomPayload } from "@/pages/solver/Plate";
import { isOpenable, type CompareJob, type JobSpot } from "./compareJob";
import {
  actingOrder,
  buildLineModel,
  chipScale,
  conditionedJsonDataFor,
  fileForSeat,
  fmtBb,
  jsonDataFor,
  lineHandlers,
  nodeForSeat,
  seatLabelsOf,
  type LineModel,
} from "./lineModel";
import { jointNodeFor } from "@/lib/sessionSim/orbits";
import {
  conditionedGridForCards,
  idsOfCodes,
  jointForDump,
  jsonDataFromCells,
} from "./jointCharts";
import PartnerHandPicker from "./PartnerHandPicker";
import PartnerHandSelect from "./PartnerHandSelect";
import { actionLabels, fmtCount, type DumpNode, type PushFoldDump } from "./pushfoldResult";
import type { SolveGroup } from "./solveGroupsApi";
import { spotTitle } from "./solveIdentity";
import { PhaseBadge } from "./SolvesDrawer";
import type { LoadedDump } from "./useDumps";

/** What a plate hands the overlay: its zoom payload plus the card it is in. */
type ZoomTarget = PlateZoomPayload & { caption: string; partnerText: string };

/* ---------- geometry ---------- */

/* Between solve cards, and between the plates inside one. */
const CARD_GAP = 8;
const PLATE_GAP = 6;
/* A card's own chrome: p-2 and a 1px border. */
const CARD_PAD = 8;
const CARD_BORDER = 1;
/* The caption column beside a fitted card's plates. */
const CAPTION_W = 132;
const CAPTION_GAP = 8;
/* The caption is five short lines; a card cannot be shorter than that, so a
 * row too low for it means the view has to scroll. */
const CAPTION_MIN_H = 96;
/* The compact Plate: matrix, a 4px gap, the sidebar, and a 1px border each
 * side. The sidebar holds the seat header, the partner select and the key. */
const SIDEBAR_W = 76;
const PLATE_EXTRA_W = 4 + 2 * 1;
const PLATE_EXTRA_H = 2 * 1;
/* Below this the 13x13 grid stops being a chart; the view scrolls instead. */
const MIN_DM = 72;
/* Below-lg fallback: the wide plate's narrowest readable width. */
const MIN_PLATE_PX = 150;

const LG_QUERY = "(min-width: 1024px)";
const subscribeLg = (onChange: () => void) => {
  const mq = window.matchMedia(LG_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
/** The page's workbench breakpoint: from lg the cards' container has a
 *  definite height to fit into; below it the page scrolls. */
const useIsLg = () =>
  useSyncExternalStore(
    subscribeLg,
    () => window.matchMedia(LG_QUERY).matches,
    () => false
  );

interface FitLayout {
  /** Solve cards per row. */
  perRow: number;
  /** Matrix side, px. */
  dm: number;
  /** The matrix could not be kept readable; the container scrolls. */
  clamped: boolean;
}

/** The biggest matrix that lets every card sit on screen: try one, two and
 *  three cards per row and keep whichever leaves the most room per plate. */
const fitLayout = (width: number, height: number, cards: number, seats: number): FitLayout => {
  let best: FitLayout | null = null;
  for (let perRow = 1; perRow <= Math.min(3, cards); perRow += 1) {
    const rows = Math.ceil(cards / perRow);
    const rowInner = (height - (rows - 1) * CARD_GAP) / rows - 2 * CARD_PAD - 2 * CARD_BORDER;
    const dmByH = rowInner - PLATE_EXTRA_H;
    const cardW = (width - (perRow - 1) * CARD_GAP) / perRow;
    const platesW = cardW - 2 * CARD_PAD - 2 * CARD_BORDER - CAPTION_W - CAPTION_GAP;
    const dmByW = (platesW - (seats - 1) * PLATE_GAP) / seats - SIDEBAR_W - PLATE_EXTRA_W;
    const dm = Math.floor(Math.min(dmByH, dmByW));
    if (!best || dm > best.dm) best = { perRow, dm, clamped: rowInner < CAPTION_MIN_H };
  }
  const chosen = best ?? { perRow: 1, dm: MIN_DM, clamped: true };
  return chosen.dm < MIN_DM ? { ...chosen, dm: MIN_DM, clamped: true } : chosen;
};

const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
/** "31.7M", "800k": an iteration count that fits a caption line. */
const shortCount = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

/* One node for every plate that has no decision, so the memoized Plate sees
 * the same prop each render. */
const NO_DECISION = (
  <div className="flex flex-col items-center gap-2 px-2 text-center text-[10px] text-slate-300">
    <div className="flex gap-1">
      <CardBack w={30} />
      <CardBack w={30} />
    </div>
    <span>No decision yet.</span>
  </div>
);

/* Stands in for the partner select on the plates of a card that has one, so
 * every matrix in the card starts at the same height (wide layout only; the
 * compact sidebar stacks nothing above the matrix). */
const HEADER_SPACER = <div aria-hidden="true" className="h-[23px]" />;

const smallBtn =
  "rounded border border-slate-700 bg-slate-950/50 px-1.5 py-0.5 text-[10px] text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40";

/* ---------- one seat ---------- */

const GroupPlate = React.memo(
  ({
    dump,
    path,
    seat,
    alive,
    isActive,
    isHero,
    isButton,
    playerBet,
    maxBet,
    pot,
    compact,
    dm,
    reserveHeader,
    onActionClick,
    caption,
    onZoom,
  }: {
    dump: PushFoldDump;
    path: number[];
    seat: number;
    alive: boolean;
    isActive: boolean;
    isHero: boolean;
    isButton: boolean;
    playerBet: number;
    maxBet: number;
    pot: number;
    compact: boolean;
    dm: number;
    reserveHeader: boolean;
    onActionClick: (action: string, file: string) => void;
    /** The card this plate sits in, named for the zoom overlay. */
    caption: string;
    onZoom: (zoom: ZoomTarget) => void;
  }) => {
    /* The seat's decision along the card's line: where it already acted,
     * that node; where it is still to act, the node it reaches if everyone
     * before it folds. Null for the big blind with nobody in the pot. */
    const node: DumpNode | null = useMemo(
      () => nodeForSeat(dump, path, seat),
      [dump, path, seat]
    );
    const rollup = node ? dump.metadata.team_rollup?.[String(node.node_id)] : undefined;
    /* Exact joint rows where the payload has them: the partner's cards
     * condition the chart; otherwise the partner's class does. */
    const joint = useMemo(() => jointForDump(dump), [dump]);
    const jointNode = node ? jointNodeFor(joint, node) : null;
    const [partnerClass, setPartnerClass] = useState<number | null>(null);
    const [partnerCards, setPartnerCards] = useState<string[]>([]);
    const partnerSeat = jointNode?.partner ?? rollup?.partner;
    const partnerLabel =
      partnerSeat != null ? seatLabelsOf(dump)[partnerSeat] ?? `P${partnerSeat}` : "";

    /* The chart, and whether the partner ever reaches this node with the
     * cards typed - when not, the chart shown is the marginal and the picker
     * says so, because a chart that silently did not change reads as a
     * broken input. */
    const { data, unreached, rare, coverage } = useMemo(() => {
      if (!node) {
        return { data: jsonDataFor(dump, null, seat), unreached: false, rare: false, coverage: 1 };
      }
      const ids = idsOfCodes(partnerCards);
      if (joint && jointNode && ids.length > 0) {
        const chart = conditionedGridForCards(node, joint, jointNode, ids);
        const scale = chipScale(dump);
        return {
          data: jsonDataFromCells(
            seatLabelsOf(dump)[seat] ?? `P${seat}`,
            (dump.metadata.stacks?.[seat] ?? 0) / scale,
            chart.cells,
            actionLabels(node),
            scale
          ),
          unreached: chart.unreached,
          rare: chart.rare,
          coverage: chart.coverage,
        };
      }
      if (!jointNode && rollup && partnerClass != null) {
        return {
          data: conditionedJsonDataFor(dump, node, rollup, partnerClass, seat),
          unreached: false,
          rare: false,
          coverage: 1,
        };
      }
      return { data: jsonDataFor(dump, node, seat), unreached: false, rare: false, coverage: 1 };
    }, [dump, node, joint, jointNode, rollup, partnerClass, partnerCards, seat]);

    const header = useMemo(
      () =>
        jointNode ? (
          <PartnerHandPicker
            dense
            cards={partnerCards}
            onChange={setPartnerCards}
            partnerLabel={partnerLabel}
            note={
              unreached
                ? "never here with those - showing the average"
                : rare
                  ? `rarely here with those: ${Math.round(coverage * 100)}% of hands have data, rest is average`
                  : null
            }
          />
        ) : rollup ? (
          <PartnerHandSelect
            dense
            rollup={rollup}
            partnerLabel={partnerLabel}
            value={partnerClass}
            onChange={setPartnerClass}
          />
        ) : reserveHeader && !compact ? (
          HEADER_SPACER
        ) : undefined,
      [jointNode, rollup, partnerLabel, partnerClass, partnerCards, unreached, rare, coverage, reserveHeader, compact]
    );

    /* A click on the matrix opens it large. The payload carries the grid
     * the plate is showing - conditioned or not - so the zoom shows exactly
     * what was clicked. */
    const partnerText = partnerCards.length > 0 ? `${partnerLabel} holds ${partnerCards.join(" ")}` : "";
    const handleZoom = useCallback(
      (payload: PlateZoomPayload) => onZoom({ ...payload, caption, partnerText }),
      [onZoom, caption, partnerText]
    );

    return (
      <Plate
        file={fileForSeat(seat)}
        plateId={`${dump.metadata.solve_id ?? "solve"}:${seat}`}
        onPlateZoom={handleZoom}
        data={data}
        onActionClick={onActionClick}
        alive={alive}
        isActive={isActive}
        isHero={isHero}
        isButton={isButton}
        playerBet={playerBet}
        pot={pot}
        maxBet={maxBet}
        heightMode="full"
        header={header}
        placeholder={node ? undefined : NO_DECISION}
        performant
        compact={compact}
        dmWidthPx={compact ? dm : undefined}
        sidebarWidthPx={compact ? SIDEBAR_W : undefined}
      />
    );
  }
);
GroupPlate.displayName = "GroupPlate";

/* ---------- one solve ---------- */

/** "CO jams · BTN folds": the card's line in words. */
const lineText = (model: LineModel): string =>
  model.steps
    .map((s) => `${seatLabel(model, s.seat)} ${s.label === "ALLIN" ? "jams" : "folds"}`)
    .join(" · ");
const seatLabel = (model: LineModel, seat: number): string =>
  Object.keys(model.seatOf).find((k) => model.seatOf[k] === seat) ?? `P${seat}`;

const GroupSolveRow = ({
  index,
  jobId,
  job,
  loaded,
  fit,
  cols,
  onOpenJob,
  onZoom,
}: {
  index: number;
  jobId: string;
  job: CompareJob | undefined;
  loaded: LoadedDump | undefined;
  onZoom: (zoom: ZoomTarget) => void;
  /** Fitted (compact plates beside a caption) or flowing (wide plates under
   *  a caption) - see the file comment. */
  fit: FitLayout | null;
  /** Flowing layout: plates per row. */
  cols: number;
  onOpenJob: (id: string, path?: number[]) => void;
}) => {
  const dump = loaded && "dump" in loaded ? loaded.dump : null;
  const [path, setPath] = useState<number[]>([]);
  const model = useMemo(() => (dump ? buildLineModel(dump, path) : null), [dump, path]);
  const handlers = useMemo(
    () => (dump && model ? lineHandlers(dump, path, setPath, model.seatOf) : null),
    [dump, model, path]
  );

  const meta = dump?.metadata;
  const scale = dump ? chipScale(dump) : 1;
  const teamSeats = useMemo(() => meta?.team?.seats ?? [], [meta]);
  const teamName = meta ? teamSeats.map((s) => meta.seats[s] ?? s).join("+") : null;
  const order = useMemo(() => (dump ? actingOrder(dump) : []), [dump]);
  const button = meta?.preflop?.button;
  const maxBet = model ? Math.max(0, ...Object.values(model.playerBets)) : 0;
  const pot = model?.node ? model.node.pot / scale : (meta?.pot ?? 0) / scale;
  const atRoot = path.length === 0;

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

  /* The caption: who this solve is, how far it got, what the line is, and
   * the two things to do with it. One block, laid out as a column beside
   * the plates when fitted and as a wrapping row above them otherwise. */
  const caption = (
    <>
      <span className="flex items-center gap-1.5">
        <span className="tabular-nums text-slate-500">{index + 1}</span>
        <PhaseBadge spot={job?.spot} detail={false} />
        {teamName && <span className="font-medium text-amber-300">team {teamName}</span>}
      </span>
      {meta && (
        <span className="flex min-w-0 items-baseline gap-1.5 tabular-nums text-slate-500">
          {meta.solve_id && (
            <span className="truncate font-mono text-slate-400" title={meta.solve_id}>
              {meta.solve_id}
            </span>
          )}
          <span className="shrink-0" title={`${fmtCount(meta.iterations)} iterations`}>
            {shortCount(meta.iterations)} iters
          </span>
        </span>
      )}
      {meta && (
        <span className="flex items-baseline gap-1.5 tabular-nums">
          {meta.team && (
            <span className="text-amber-300/90" title="The pair's summed EV per hand, in big blinds.">
              EV {signed(meta.team.ev_chips / scale)} bb
            </span>
          )}
          <span className="text-slate-400">pot {fmtBb(pot)}</span>
        </span>
      )}
      {model && (
        <span
          className={`leading-snug ${atRoot ? "text-slate-500" : "text-emerald-300"}`}
          title="The line this card is on. Click a plate's colour key to take that action for that seat."
        >
          {atRoot ? "folds to each seat" : lineText(model)}
        </span>
      )}
      {status}
      {dump && (
        <span className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            disabled={atRoot}
            onClick={() => setPath([])}
            className={smallBtn}
            title="Back to the start: every seat's chart as if it folded to them"
          >
            Reset line
          </button>
          {job && isOpenable(job) && (
            <button
              type="button"
              onClick={() => onOpenJob(jobId, path)}
              className="rounded border border-emerald-700/70 bg-slate-950/50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/10"
              title="Open this solve on its own, at this line"
            >
              Open
            </button>
          )}
        </span>
      )}
    </>
  );

  const plates =
    dump && model && handlers
      ? order.map((seat) => {
          const label = seatLabel(model, seat);
          return (
            <GroupPlate
              key={seat}
              dump={dump}
              path={path}
              seat={seat}
              alive={model.alivePlayers[label] ?? true}
              /* Only once a line is taken: at the root every card would
                 otherwise pulse its first actor, which says nothing (the
                 root view is four separate fold-to charts, not one line)
                 and keeps four rings animating on an idle screen. */
              isActive={!atRoot && label === model.activePlayer}
              isHero={teamSeats.includes(seat)}
              isButton={button != null && seat === button}
              playerBet={model.playerBets[label] ?? 0}
              maxBet={maxBet}
              pot={pot}
              compact={!!fit}
              dm={fit?.dm ?? 0}
              reserveHeader={teamSeats.length > 0}
              onActionClick={handlers.onActionClick}
              caption={`${index + 1} · team ${teamName ?? ""} · ${
                atRoot ? "folds to each seat" : lineText(model)
              }`}
              onZoom={onZoom}
            />
          );
        })
      : null;

  return (
    <section className="relative min-w-0 overflow-hidden rounded-xl border border-slate-800/70 p-2">
      <PokerTableBackdrop className="opacity-70" />
      {fit ? (
        <div className="relative z-10 flex items-start" style={{ gap: CAPTION_GAP }}>
          <div
            className="flex shrink-0 flex-col gap-1 text-[10px]"
            style={{ width: CAPTION_W }}
          >
            {caption}
          </div>
          {plates && (
            <div className="flex min-w-0 items-start" style={{ gap: PLATE_GAP }}>
              {plates.map((p, i) => (
                <div key={order[i]} style={{ width: fit.dm + SIDEBAR_W + PLATE_EXTRA_W }}>
                  {p}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="relative z-10 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            {caption}
          </div>
          {plates && (
            <div
              className="relative z-10 grid"
              style={{ gap: CARD_GAP, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {plates}
            </div>
          )}
        </>
      )}
    </section>
  );
};

/* ---------- the group ---------- */

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
  const isLg = useIsLg();
  const { ref, width, height } = useElementSize<HTMLDivElement>({ hysteresis: 6 });
  /* The plate clicked, shown large: the compact canvases are for the
   * overview, this is for reading a strategy. */
  const [zoom, setZoom] = useState<ZoomTarget | null>(null);
  const seats = useMemo(() => {
    let n = 0;
    for (const id of group.jobIds) {
      const l = loaded[id];
      if (l && "dump" in l) n = Math.max(n, l.dump.metadata.seats.length);
    }
    return n || 2;
  }, [group.jobIds, loaded]);
  const cards = group.jobIds.length;

  /* Fit from lg, where the container's height is definite; below it the
   * height measured is the content's own, which is nothing to fit into. */
  const fit = useMemo(
    () => (isLg && width > 0 && height > 0 ? fitLayout(width, height, cards, seats) : null),
    [isLg, width, height, cards, seats]
  );
  /* Flowing layout: as many wide plates across as stay readable. */
  const cols =
    width > 0
      ? Math.max(1, Math.min(seats, Math.floor((width + CARD_GAP) / (MIN_PLATE_PX + CARD_GAP))))
      : 2;
  const spot = group.jobIds
    .map((id) => jobsById.get(id)?.spot)
    .find((s): s is JobSpot => s != null);

  const rows = group.jobIds.map((id, i) => (
    <GroupSolveRow
      key={`${id}-${i}`}
      index={i}
      jobId={id}
      job={jobsById.get(id)}
      loaded={loaded[id]}
      fit={fit}
      cols={cols}
      onOpenJob={onOpenJob}
      onZoom={setZoom}
    />
  ));

  return (
    <section
      className={`flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3 ${className}`}
    >
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-white">{group.name}</h2>
        <span className="text-[11px] text-slate-500">
          {cards === 1 ? "1 solve" : `${cards} solves`} · every seat{"'"}s chart as if it folded
          to them; a colour key plays that action and the other seats react
        </span>
        {spot && <span className="text-[11px] text-slate-300">{spotTitle(spot)}</span>}
      </div>
      {/* The measured box. From lg it is the leftover height and the cards
          are packed into it; it only scrolls when even the smallest readable
          matrix would not fit. */}
      <ResponsiveDrawer
        open={zoom != null}
        onClose={() => setZoom(null)}
        zClassName="z-[80]"
        desktopMaxWidthClassName="sm:max-w-3xl"
        ariaLabel="Range, enlarged"
      >
        {zoom && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-slate-300">
              <span className="text-sm font-semibold text-white">{zoom.position}</span>
              <span className="tabular-nums">{fmtBb(zoom.stackBB)}</span>
              {zoom.playerBet > 0 && (
                <span className="tabular-nums text-slate-400">bet {fmtBb(zoom.playerBet)}</span>
              )}
              <span className="text-slate-500">{zoom.caption}</span>
              {zoom.partnerText && <span className="text-emerald-300">{zoom.partnerText}</span>}
            </div>
            {/* The full matrix: labels, hover EVs in big blinds, sized to the
                viewport's height so the whole grid stays on screen. */}
            <div className="mx-auto w-full" style={{ maxWidth: "min(100%, 76vh)" }}>
              <DecisionMatrix gridData={zoom.grid} heightMode="full" />
            </div>
            <div className="mx-auto w-full" style={{ maxWidth: "min(100%, 76vh)" }}>
              <ColorKey data={zoom.grid} sizeRef={1} />
            </div>
          </div>
        )}
      </ResponsiveDrawer>
      <div
        ref={ref}
        className={`min-h-0 flex-1 ${fit && !fit.clamped ? "overflow-hidden" : "overflow-y-auto"}`}
      >
        {fit ? (
          <div
            className="grid"
            style={{ gap: CARD_GAP, gridTemplateColumns: `repeat(${fit.perRow}, minmax(0, 1fr))` }}
          >
            {rows}
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: CARD_GAP }}>
            {rows}
          </div>
        )}
      </div>
    </section>
  );
};

export default GroupRangesView;
