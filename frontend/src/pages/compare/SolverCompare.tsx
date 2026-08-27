import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DecisionMatrix from "@/pages/solver/DecisionMatrix";
import ActionSummary from "@/pages/solver/ActionSummary";
import HandBreakdown from "@/pages/solver/HandBreakdown";
import PlayingCard from "@/components/PlayingCard";
import type { HandCellData } from "@/lib/solver/utils";
import { handClassOf, comboKey, type ComboDetail, type ComboRow } from "@/lib/solver/comboDetail";
import { combosForHand, expandHandCombos } from "@/lib/solver/aggregates";
import {
  heatColor,
  normalizeToRange,
  type MatrixDisplayData,
  type ValueRange,
} from "@/lib/solver/matrixDisplayMode";
import { HAND_ORDER } from "@/lib/solver/handOrder";
import { authedFetch } from "@/lib/api";
import type { MoneyOpts } from "@/pages/solver/boardDisplay";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import TreeBuilding, { Check, inputCls } from "@/components/TreeBuilding";
import {
  applyViewToBuilder,
  buildEngineConfig,
  builderToView,
  cloneBuilder,
  DEFAULT_BUILDER,
  type BuilderState,
  type EngineConfigResult,
} from "./builderState";
import { parseBoardCards, pioClipboardCodec } from "./treeConfigText";
import { pioRangeCodec } from "@/lib/solver/rangeTokens";
import PipelineTimingPanel, {
  secs,
  type ClientMarks,
  type JobTimings,
  type PipelineRun,
} from "./PipelineTimingPanel";
import {
  decodeNode,
  joinHands,
  parseHtc,
  type DecodedNode,
  type HtcDoc,
  type JoinedHand,
} from "./htcDecode";

/**
 * Hidden verification page (/compare, no nav entry): htsolver's own per-hand
 * results, optionally next to PioSolver's for an accuracy check.
 *
 * Each solver writes its OWN binary .htc payload (see htcDecode.ts), and
 * PioSolver is opt-in per run - the mid-term plan is to drop it entirely, so
 * an engine-only run must not pay for it. That shapes this page: EVERY
 * Pio-dependent element is conditional, and a run with no Pio payload
 * renders one full-width grid with no gate badge and no diff columns.
 *
 * Two ways in:
 *  - Build a spot in the tree builder and "Solve & Compare" - the compare
 *    watcher solves it with htsolver, plus Pio when the job asked for it.
 *    htsolver's payload renders first; Pio's merges in when it arrives.
 *  - Drop one or two .htc files produced by `engine_compare.py --ht-out /
 *    --pio-out` - works anywhere, including the deployed site.
 *
 * Reading the numbers: only the game VALUE of a 2p zero-sum spot is unique;
 * per-hand strategies (and, via blockers, per-hand EVs) may legitimately
 * differ between two exact equilibria. The correctness verdict is the
 * cross-check badge (Pio's own evaluator rating the htsolver strategy), and
 * it only exists when that gate was requested; the per-hand view is for
 * seeing where and how the two solutions differ, by eye.
 */

/* ---------- the two payloads' summary shapes ---------- */

type CompareNode = DecodedNode;

/** htsolver's payload header. Everything here comes from the artifact, so it
 *  exists whether or not Pio ran. */
interface HtSummary {
  solver: "ht";
  ht: {
    iterations: number;
    nashconv: number;
    exploitable_chips?: number;
    exploitable_pct_pot?: number | null;
    ev: number[];
  };
  timing?: {
    ht_solve_s?: number | null;
    ht_setup_s?: number | null;
    ht_threads?: number | null;
    ht_iterations?: number | null;
    meta_load_s?: number | null;
    dump_load_s?: number | null;
    ht_extract_s?: number | null;
  };
  memory?: { ht_peak_bytes?: number | null };
  sampled?: boolean;
  runouts?: number | null;
  decision_nodes?: number;
  detail_nodes?: number;
}

/** PioSolver's payload header. Present only when Pio ran; its `detail_nodes`
 *  is 0 when Pio solved but its per-hand rows were not extracted. */
interface PioSummary {
  solver: "pio";
  source?: string;
  pio: { ev_oop: number | null; ev_ip: number | null; exploitable: number | null };
  cross_check: {
    /** "none" when no gate was asked for - which is not the same as failing. */
    gate?: "cross_exploitability" | "root_ev" | "none";
    ht_exploitable_per_pio: number | null;
    ht_ev_per_pio: (number | null)[];
    root_ev_diff?: number | null;
    threshold: number;
    pass: boolean | null;
  };
  timing?: {
    pio_solve_s?: number | null;
    pio_setup_s?: number | null;
    pio_spawn_s?: number | null;
    pio_extract_s?: number | null;
    cross_check_s?: number | null;
    accuracy_chips?: number | null;
  };
  memory?: { pio_peak_bytes?: number | null; pio_baseline_bytes?: number | null };
  detail_nodes?: number;
}

/** What the page has loaded. Either half may be absent: an engine-only run
 *  has no Pio payload at all, and the htsolver half arrives first. */
interface Loaded {
  ht: HtcDoc | null;
  pio: HtcDoc | null;
}

/* ---------- helpers ---------- */

/** Raw harness labels -> readable labels, amounts in chips ("Bet 50",
 *  "Raise to 400") - the harness's unit, matching the bNNN node ids. */
const displayLabels = (node: CompareNode): string[] => {
  const lastSeg = node.id.split(":").pop() ?? "";
  const facing = lastSeg.startsWith("b");
  return node.actions.map((a) => {
    if (a === "f") return "Fold";
    if (a === "c") return facing ? "Call" : "Check";
    const amount = Number(a.slice(1));
    return facing ? `Raise to ${amount}` : `Bet ${amount}`;
  });
};

interface SolverView {
  labels: string[];
  grid: HandCellData[];
  comboDetail: ComboDetail;
  /** This solver's OWN reach per class: each file carries its own range, so
   *  a grid's cell heights describe the solver it belongs to. */
  reachByHand: Map<string, number>;
  evMin: number;
  evMax: number;
}

/** One solver's 169-class grid + ComboDetail from its own per-hand rows.
 *  Aggregation is range-weighted with a plain-mean fallback - the same rule
 *  as the schema-4 pipeline. */
const buildSolverView = (node: CompareNode): SolverView => {
  const labels = displayLabels(node);
  const nActions = labels.length;

  interface Agg {
    w: number;
    n: number;
    freqW: number[];
    freqPlain: number[];
    evW: number;
    evWSum: number;
  }
  const byClass = new Map<string, Agg>();
  const byCombo = new Map<string, ComboRow>();
  let evMin = Infinity;
  let evMax = -Infinity;

  for (const hand of node.hands) {
    const c1 = hand.hand.slice(0, 2);
    const c2 = hand.hand.slice(2, 4);
    const cls = handClassOf(c1, c2);
    let agg = byClass.get(cls);
    if (!agg) {
      agg = {
        w: 0,
        n: 0,
        freqW: Array(nActions).fill(0),
        freqPlain: Array(nActions).fill(0),
        evW: 0,
        evWSum: 0,
      };
      byClass.set(cls, agg);
    }
    agg.w += hand.reach;
    agg.n += 1;

    if (hand.ev != null) {
      agg.evW += hand.reach * hand.ev;
      agg.evWSum += hand.reach;
      if (hand.reach > 0) {
        if (hand.ev < evMin) evMin = hand.ev;
        if (hand.ev > evMax) evMax = hand.ev;
      }
    }
    for (let k = 0; k < nActions; k++) {
      agg.freqW[k] += hand.reach * hand.freq[k];
      agg.freqPlain[k] += hand.freq[k];
    }
    const actions: ComboRow["actions"] = {};
    for (let k = 0; k < nActions; k++) {
      actions[labels[k]] = {
        freq: hand.freq[k],
        ev: hand.action_ev?.[k] ?? null,
        evLoss: null,
      };
    }
    byCombo.set(comboKey(c1, c2), {
      key: comboKey(c1, c2),
      weight: hand.reach,
      equity: null,
      ev: hand.ev,
      matchups: null,
      actions,
    });
  }

  const reachByHand = new Map<string, number>();
  const grid: HandCellData[] = [];
  for (const [cls, agg] of byClass) {
    reachByHand.set(cls, agg.w / combosForHand(cls));
    const actions: Record<string, number> = {};
    const evs: Record<string, number> = {};
    const ev = agg.evWSum > 0 ? agg.evW / agg.evWSum : null;
    for (let k = 0; k < nActions; k++) {
      actions[labels[k]] = agg.w > 0 ? agg.freqW[k] / agg.w : agg.freqPlain[k] / agg.n;
      if (ev != null) evs[labels[k]] = ev;
    }
    grid.push({ hand: cls, actions, evs });
  }

  return {
    labels,
    grid,
    comboDetail: { actor: "oop", actions: labels, byCombo },
    reachByHand,
    evMin,
    evMax,
  };
};

/** EV-heat stripes for one solver over a SHARED range (so the two grids'
 *  colors are directly comparable - buildMatrixDisplayData would normalize
 *  each grid to its own range). */
const buildEvDisplay = (
  detail: ComboDetail,
  board: string[],
  evRange: ValueRange | null
): MatrixDisplayData | null => {
  if (!evRange) return null;
  const blocked = new Set(board);
  const stripesByHand = new Map<string, string[]>();
  for (const hand of HAND_ORDER) {
    const stripes: string[] = [];
    for (const [c1, c2] of expandHandCombos(hand)) {
      if (blocked.has(c1) || blocked.has(c2)) continue;
      const row = detail.byCombo.get(comboKey(c1, c2));
      stripes.push(
        row && row.weight > 0 && row.ev != null
          ? heatColor(normalizeToRange(row.ev, evRange))
          : "transparent"
      );
    }
    if (stripes.length) stripesByHand.set(hand, stripes);
  }
  return { mode: "ev", stripesByHand, solidByHand: null, evRange };
};

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
  disablePio: boolean;
  disableCompare: boolean;
  disableCrossCheck: boolean;
  /** Which payloads exist, so the page knows what to fetch. */
  hasHtResult: boolean;
  hasPioResult: boolean;
  /** A pre-split job whose single merged payload this build cannot read. */
  legacyResult: boolean;
}

const TERMINAL_STATUSES = ["Done", "Failed"];

const solutionsUrl = (job: CompareJob): string =>
  `/solutions?open=${encodeURIComponent(
    `${job.resultStacks}|${job.resultNodeName}|${job.board}`
  )}`;

/* ---------- page ---------- */

type SortKey = "evDiff" | "l1" | "reach" | "hand";
type DisplayMode = "strategy" | "ev";

const SolverCompare = () => {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nodeIndex, setNodeIndex] = useState(0);
  const [selectedHand, setSelectedHand] = useState<string | null>(null);
  const [hoverHand, setHoverHand] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("evDiff");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("strategy");
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
  // Which job's payloads the page is currently showing, so a slow Pio fetch
  // from an abandoned job can never land on top of a newer selection.
  const loadedJobRef = useRef<string | null>(null);
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

  /** Turning Pio off forces its two halves off too - neither can run without
   *  a Pio process. The API normalizes the same way, so a job's stored row
   *  can never claim otherwise. */
  const setRunPio = (run: boolean) =>
    setBuilder((cur) => ({
      ...cur,
      disablePio: !run,
      disableCompare: run ? cur.disableCompare : true,
      disableCrossCheck: run ? cur.disableCrossCheck : true,
    }));

  /** Accept one payload into its solver's slot.
   *
   *  A payload for the SAME spot merges beside whatever is already loaded -
   *  which is how Pio's half arrives after htsolver's, and how two files
   *  dropped one at a time combine. A payload for a different spot starts
   *  fresh, so a mismatched pair can never render as a meaningless
   *  side-by-side comparison. */
  const acceptPayload = useCallback((buf: ArrayBuffer) => {
    const htc = parseHtc(buf);
    let switchedSpot = false;
    setLoaded((cur) => {
      const existing = cur?.ht ?? cur?.pio ?? null;
      const sameSpot =
        existing != null &&
        existing.header.spot.config_hash === htc.header.spot.config_hash;
      switchedSpot = !sameSpot;
      const base: Loaded = sameSpot && cur ? cur : { ht: null, pio: null };
      return { ...base, [htc.header.solver]: htc };
    });
    if (switchedSpot) {
      setNodeIndex(0);
      setSelectedHand(null);
      setHoverHand(null);
    }
    setBuilderOpen(false);
    setError(null);
  }, []);

  const loadFiles = useCallback(
    (files: FileList) => {
      setPipeline(null); // hand-loaded files have no pipeline run behind them
      const list = Array.from(files);
      void (async () => {
        try {
          const bufs = await Promise.all(list.map((f) => f.arrayBuffer()));
          // Dropping several files at once that disagree on the spot is a
          // mistake worth naming, rather than silently keeping the last one.
          const hashes = new Set(bufs.map((b) => parseHtc(b).header.spot.config_hash));
          if (hashes.size > 1) {
            throw new Error(
              "Those payloads are from different spots (config_hash differs) - " +
                "load both halves of one run."
            );
          }
          bufs.forEach(acceptPayload);
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    },
    [acceptPayload]
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

  /** Load a finished job's payloads.
   *
   *  htsolver's half is fetched and rendered FIRST, then Pio's is merged in
   *  if it exists: the engine result is what the turnaround is measured
   *  against, and it should not wait on the larger Pio download. */
  const loadJobResult = useCallback(
    async (job: CompareJob, opts: { submitMs?: number; tClickMs?: number } = {}) => {
      setError(null);
      if (job.legacyResult) {
        setError(
          "This run predates the per-solver payload split and cannot be opened here. " +
            "Re-run the spot to regenerate it."
        );
        return;
      }
      loadedJobRef.current = job.id;
      try {
        const t0 = performance.now();
        const resp = await authedFetch(`/api/enginecompare/${job.id}/result/ht`);
        if (!resp.ok) throw new Error(await resp.text());
        const t1 = performance.now();
        const buf = await resp.arrayBuffer();
        const t2 = performance.now();
        if (loadedJobRef.current !== job.id) return; // a newer job took over
        acceptPayload(buf);
        // Two rAFs bracket the commit + paint: the first fires before the
        // frame, the second after it was presented. Finite and event-driven.
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

        if (job.hasPioResult) {
          const pioStart = performance.now();
          const pioResp = await authedFetch(`/api/enginecompare/${job.id}/result/pio`);
          if (!pioResp.ok) throw new Error(await pioResp.text());
          const pioBuf = await pioResp.arrayBuffer();
          if (loadedJobRef.current !== job.id) return;
          acceptPayload(pioBuf);
          const pioMergeMs = performance.now() - pioStart;
          setPipeline((cur) =>
            cur && cur.job.id === job.id
              ? { ...cur, marks: { ...cur.marks, pioMergeMs } }
              : cur
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [acceptPayload]
  );

  /** Queue a job for the compare watcher and poll it to completion. */
  const submitJob = useCallback(
    async (mode: "compare" | "publish") => {
      setError(null);
      setRunLog(null);
      let payload: EngineConfigResult;
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

  /* ---------- derived from whichever payloads are loaded ---------- */

  const htSummary = (loaded?.ht?.header.summary ?? null) as HtSummary | null;
  const pioSummary = (loaded?.pio?.header.summary ?? null) as PioSummary | null;
  const spot = loaded?.ht?.header.spot ?? loaded?.pio?.header.spot ?? null;
  const cross = pioSummary?.cross_check ?? null;
  /** Both halves' timing/memory merged: each file carries only its own. */
  const timing = { ...htSummary?.timing, ...pioSummary?.timing };
  const memory = { ...htSummary?.memory, ...pioSummary?.memory };
  /** Pio ran at all vs Pio extracted its per-hand rows - different questions. */
  const hasPio = loaded?.pio != null;
  const hasPioDetail = (loaded?.pio?.header.nodes.length ?? 0) > 0;

  /** The node directory, from whichever payload is present. Read straight off
   *  the header, so no hand rows are decoded to populate the picker. */
  const nodeDir = useMemo(
    () =>
      (loaded?.ht ?? loaded?.pio)?.header.nodes.map((n) => ({
        id: n.id,
        position: n.position,
      })) ?? [],
    [loaded]
  );

  const chipScale = spot?.chip_scale ?? 100;
  // Everything on this page displays in chips (mode "money" = plain numbers,
  // no bb suffix); bbSize still calibrates the bet-label color ramp.
  const money: MoneyOpts = useMemo(
    () => ({ mode: "money", bbSize: chipScale }),
    [chipScale]
  );
  /** Only the selected node's rows are decoded, per solver - the other ~1000
   *  nodes' bytes are never touched, which is what makes a full-tree payload
   *  cheap to browse. Pio's node is found BY ID: the two files need not carry
   *  the same node list. */
  const htNode = useMemo<CompareNode | null>(
    () => (loaded?.ht ? decodeNode(loaded.ht, nodeIndex) : null),
    [loaded, nodeIndex]
  );
  const pioNode = useMemo<CompareNode | null>(() => {
    const id = htNode?.id ?? nodeDir[nodeIndex]?.id;
    if (!loaded?.pio || !id) return null;
    const at = loaded.pio.header.nodes.findIndex((n) => n.id === id);
    return at >= 0 ? decodeNode(loaded.pio, at) : null;
  }, [loaded, htNode, nodeDir, nodeIndex]);

  const htView = useMemo(() => (htNode ? buildSolverView(htNode) : null), [htNode]);
  const pioView = useMemo(() => (pioNode ? buildSolverView(pioNode) : null), [pioNode]);
  const board = useMemo(() => (spot ? parseBoardCards(spot.board) : []), [spot]);

  /** Shared across whichever grids are shown, so EV heat stays comparable. */
  const evRange = useMemo<ValueRange | null>(() => {
    const present = [htView, pioView].filter(Boolean) as SolverView[];
    const min = Math.min(...present.map((v) => v.evMin));
    const max = Math.max(...present.map((v) => v.evMax));
    return present.length > 0 && min <= max ? { min, max } : null;
  }, [htView, pioView]);

  const displayData = useMemo(() => {
    if (displayMode !== "ev") return { ht: null, pio: null };
    return {
      ht: htView ? buildEvDisplay(htView.comboDetail, board, evRange) : null,
      pio: pioView ? buildEvDisplay(pioView.comboDetail, board, evRange) : null,
    };
  }, [htView, pioView, displayMode, board, evRange]);

  const breakdownHand = hoverHand ?? selectedHand;

  /** A sort that needs Pio is meaningless without it; coerce rather than
   *  syncing state in an effect. */
  const effectiveSortKey: SortKey =
    !hasPioDetail && (sortKey === "evDiff" || sortKey === "l1") ? "reach" : sortKey;

  /** The per-combo table's rows: the two solvers joined by hand string. */
  const tableRows = useMemo(() => {
    const rows = joinHands(htNode, pioNode).filter(
      (h) =>
        !selectedHand ||
        handClassOf(h.hand.slice(0, 2), h.hand.slice(2, 4)) === selectedHand
    );
    const evDiff = (h: JoinedHand) =>
      h.ht?.ev == null || h.pio?.ev == null ? 0 : Math.abs(h.ht.ev - h.pio.ev);
    const sorted = [...rows];
    if (effectiveSortKey === "evDiff") sorted.sort((a, b) => evDiff(b) - evDiff(a));
    else if (effectiveSortKey === "l1")
      sorted.sort((a, b) => (b.l1 ?? 0) * b.reach - (a.l1 ?? 0) * a.reach);
    else if (effectiveSortKey === "reach") sorted.sort((a, b) => b.reach - a.reach);
    else sorted.sort((a, b) => a.hand.localeCompare(b.hand));
    return sorted;
  }, [htNode, pioNode, selectedHand, effectiveSortKey]);

  const shownRows = tableRows.slice(0, 200);
  /** Column labels come from whichever solver's node is loaded; the join
   *  matches Pio's actions to these by label, never by position. */
  const tableLabels = htView?.labels ?? pioView?.labels ?? [];
  const chips = (v: number | null | undefined): string => (v == null ? "-" : v.toFixed(2));
  const megabytes = (v: number | null | undefined): string =>
    v == null ? "n/a" : v >= 1024 ** 3 ? `${(v / 1024 ** 3).toFixed(2)} GB` : `${Math.round(v / 1024 ** 2)} MB`;
  const pct = (f: number | null | undefined): string =>
    f == null ? "-" : `${Math.round(f * 1000) / 10}`;

  const onSelect = useCallback(
    (hand: string) => setSelectedHand((cur) => (cur === hand ? null : hand)),
    []
  );

  const onActionClick = useCallback(
    (label: string) => {
      const view = htView ?? pioView;
      const node = htNode ?? pioNode;
      if (!node || !view) return;
      const k = view.labels.indexOf(label);
      if (k < 0) return;
      const childId = `${node.id}:${node.actions[k]}`;
      const idx = nodeDir.findIndex((n) => n.id === childId);
      if (idx >= 0) {
        setNodeIndex(idx);
        setSelectedHand(null);
        setHoverHand(null);
      }
    },
    [htNode, pioNode, htView, pioView, nodeDir]
  );

  /** Pio's cost divided by htsolver's: > 1 means htsolver won. Null whenever
   *  either side is missing, which now includes every engine-only run. */
  const ratioOf = (ht?: number | null, pio?: number | null): number | null =>
    ht != null && ht > 0 && pio != null ? pio / ht : null;
  const speedup = ratioOf(timing.ht_solve_s, timing.pio_solve_s);
  const memRatio = ratioOf(memory.ht_peak_bytes, memory.pio_peak_bytes);

  return (
    <div className="mx-auto max-w-7xl px-3 py-6 text-slate-200">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-white">Solver comparison</h1>
        <span className="text-xs text-slate-500">
          {hasPio ? (
            <>
              <span className="font-medium text-emerald-400">htsolver</span> vs{" "}
              <span className="font-medium text-sky-400">PioSolver</span>, same tree
            </>
          ) : (
            <>
              <span className="font-medium text-emerald-400">htsolver</span>, engine-only run
            </>
          )}
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
          Load payload
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".htc,application/octet-stream"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) loadFiles(e.target.files);
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
          {jobs.slice(0, 12).map((job) => {
            // A compare job is openable only if its htsolver payload is
            // actually pointed at from the row. A job whose watcher uploaded
            // the blob while the API was too old to record the path is Done
            // with nothing to fetch - say so rather than 404 on click.
            const openable =
              job.status === "Done" &&
              (job.mode === "publish" || job.hasHtResult || job.legacyResult);
            return (
            <button
              key={job.id}
              type="button"
              disabled={!openable}
              title={
                job.status === "Failed"
                  ? job.error ?? "failed"
                  : job.mode === "publish"
                    ? "Published solve - opens /solutions"
                    : job.status === "Done" && !openable
                      ? "No payload recorded for this run - re-run the spot"
                      : "Load this comparison"
              }
              onClick={() => {
                if (!openable) return;
                if (job.mode === "publish") window.location.href = solutionsUrl(job);
                else void loadJobResult(job);
              }}
              className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                openable
                  ? "border-slate-600 text-slate-200 hover:border-emerald-500 hover:bg-emerald-500/10"
                  : job.status === "Failed"
                    ? "border-red-900 text-red-400"
                    : "border-slate-700 text-slate-500"
              }`}
            >
              {job.board ?? "?"} · {job.mode === "publish" ? "publish" : "compare"} ·{" "}
              {job.status === "Done" && !openable ? "no payload" : job.status}
            </button>
            );
          })}
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
              htsolver solves this tree; when PioSolver is enabled it gets the identical
              tree, node for node.
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

              <fieldset>
                <legend className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  PioSolver comparison
                </legend>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <Check
                    label="Run PioSolver"
                    checked={!builder.disablePio}
                    disabled={solving}
                    onChange={setRunPio}
                    title="Build and solve the identical tree in Pio. Off by default: an htsolver-only run needs no Pio process at all and is much faster."
                  />
                  <div className="ml-4 flex flex-col gap-1.5">
                    <Check
                      label="Pio per-hand results"
                      checked={!builder.disableCompare}
                      disabled={solving || builder.disablePio}
                      onChange={(v) => setB("disableCompare", !v)}
                      title="Extract Pio's strategy and EVs node by node over UPI, so its grid can sit beside htsolver's. This is the slow part of a comparison run."
                    />
                    <Check
                      label="Cross-exploitability gate"
                      checked={!builder.disableCrossCheck}
                      disabled={solving || builder.disablePio}
                      onChange={(v) => setB("disableCrossCheck", !v)}
                      title="Load the htsolver strategy into Pio and let Pio rate how exploitable it is. The primary correctness statement; full trees only."
                    />
                  </div>
                  <span className="max-w-[16rem] text-[10px] leading-relaxed text-slate-500">
                    Off by default: htsolver alone is the fast loop. Turn Pio on when you
                    want an accuracy check.
                  </span>
                </div>
              </fieldset>
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
      {!spot && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) loadFiles(e.dataTransfer.files);
          }}
          className="mt-6 flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-slate-700 bg-slate-800/30 px-6 py-10 text-slate-400 transition-colors hover:border-emerald-500"
        >
          <span className="font-medium">
            ...or drop one or two .htc payloads here
          </span>
          <span className="mt-1 text-[11px] text-slate-500">
            engine_compare.py --ht-out / --pio-out
          </span>
        </button>
      )}

      {/* ---------- loaded state ----------
           Gated on the SPOT, not on a Pio gate result: an engine-only run has
           no cross_check at all and must still render. */}
      {spot && (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-1.5">
              {board.map((c) => (
                <PlayingCard key={c} code={c} width={34} />
              ))}
            </div>
            <div className="text-sm text-slate-300">
              Pot {spot.pot} chips
              {pioSummary?.source && (
                <>
                  <span className="mx-2 text-slate-600">·</span>
                  <span className="text-slate-500">{pioSummary.source}</span>
                </>
              )}
            </div>
            {!hasPio ? (
              <span
                className="ml-auto rounded-full bg-slate-700/40 px-3 py-1 text-xs font-semibold text-slate-300"
                title="PioSolver was not run for this spot, so there is nothing to compare against and no correctness gate."
              >
                htsolver only
              </span>
            ) : cross?.gate === "none" || cross?.pass == null ? (
              <span
                className="ml-auto rounded-full bg-slate-700/40 px-3 py-1 text-xs font-semibold text-slate-300"
                title="The cross-exploitability gate was not requested for this run, so no correctness verdict was produced. Root EVs above are still directly comparable."
              >
                no gate (cross-check off)
              </span>
            ) : (
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
                    } chips (sampled ${htSummary?.runouts ?? "?"} runouts)`
                  : `cross-check ${cross.pass ? "PASS" : "FAIL"} · ${
                      cross.ht_exploitable_per_pio ?? "?"
                    } chips exploitable per Pio`}
              </span>
            )}
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
                        `${timing?.ht_iterations ?? htSummary?.ht.iterations ?? "?"} iters`,
                        timing?.ht_threads ? `${timing.ht_threads} threads` : null,
                        // Sub-10ms setup would just read "setup 0.00s".
                        timing?.ht_setup_s != null && timing.ht_setup_s >= 0.01
                          ? `setup ${secs(timing.ht_setup_s)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                      pioNote: !hasPio
                        ? "not run"
                        : timing?.pio_solve_s == null
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
                {chips(htSummary?.ht.ev[0])} / {chips(htSummary?.ht.ev[1])}
              </div>
              {hasPio && (
                <div>
                  <span className="font-medium text-sky-400">Pio</span>{" "}
                  {chips(pioSummary?.pio.ev_oop)} / {chips(pioSummary?.pio.ev_ip)}
                </div>
              )}
            </div>
            <div className="rounded-lg bg-slate-800/60 p-2.5">
              <div className="text-slate-500">Exploitable for (chips)</div>
              <div className="mt-0.5">
                <span className="font-medium text-emerald-400">htsolver</span>{" "}
                {chips(
                  htSummary
                    ? htSummary.ht.exploitable_chips ?? htSummary.ht.nashconv / 2
                    : null
                )}{" "}
                <span className="text-slate-500">self</span>
                {cross?.ht_exploitable_per_pio != null && (
                  <>
                    {" "}
                    · {cross.ht_exploitable_per_pio}{" "}
                    <span className="text-slate-500">per Pio</span>
                  </>
                )}
              </div>
              {hasPio && (
                <div>
                  <span className="font-medium text-sky-400">Pio</span>{" "}
                  {pioSummary?.pio.exploitable ?? "?"}{" "}
                  <span className="text-slate-500">own solve</span>
                </div>
              )}
            </div>
            <div className="rounded-lg bg-slate-800/60 p-2.5">
              <div className="text-slate-500">htsolver solve</div>
              <div className="mt-0.5">
                {htSummary?.ht.iterations ?? "?"} iters · NashConv{" "}
                {htSummary ? htSummary.ht.nashconv.toFixed(3) : "?"}
              </div>
            </div>
            <div className="rounded-lg bg-slate-800/60 p-2.5">
              <div className="text-slate-500">Run mode</div>
              <div className="mt-0.5">
                {!hasPio ? (
                  <span title="PioSolver was not run: htsolver's own per-hand results only. This is the fast iteration loop.">
                    htsolver only
                  </span>
                ) : hasPioDetail ? (
                  <span title="Both solvers' per-hand results are loaded and shown side by side.">
                    with Pio · per-hand
                  </span>
                ) : (
                  <span title="Pio solved the same tree, so its headline numbers and cost are comparable, but its per-hand rows were not extracted.">
                    with Pio · summary only
                  </span>
                )}
              </div>
              <div className="text-slate-500">
                {htSummary?.decision_nodes ?? nodeDir.length} nodes
                {hasPioDetail && pioSummary?.detail_nodes != null
                  ? ` · ${pioSummary.detail_nodes} with Pio`
                  : ""}
              </div>
            </div>
          </div>

          {/* node picker + display mode */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-500" htmlFor="compare-node">
              Node
            </label>
            <select
              id="compare-node"
              value={nodeIndex}
              onChange={(e) => {
                setNodeIndex(Number(e.target.value));
                setSelectedHand(null);
                setHoverHand(null);
              }}
              className={inputCls}
            >
              {nodeDir.map((n, i) => (
                <option key={n.id} value={i}>
                  {n.id} — {n.position} to act
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={nodeIndex === 0}
              onClick={() => setNodeIndex((i) => Math.max(0, i - 1))}
              className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={nodeIndex >= nodeDir.length - 1}
              onClick={() => setNodeIndex((i) => Math.min(nodeDir.length - 1, i + 1))}
              className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 disabled:opacity-40"
            >
              Next
            </button>
            <div className="ml-2 flex overflow-hidden rounded-lg border border-slate-700 text-xs">
              {(["strategy", "ev"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDisplayMode(mode)}
                  className={`px-3 py-1 ${
                    displayMode === mode
                      ? "bg-emerald-600 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {mode === "strategy" ? "Strategy" : "EV heat"}
                </button>
              ))}
            </div>
            {selectedHand && (
              <button
                type="button"
                onClick={() => setSelectedHand(null)}
                className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300"
              >
                {selectedHand} · clear filter
              </button>
            )}
          </div>

          {/* One grid per loaded solver: an engine-only run gets the full
              width rather than a half-empty row. */}
          {(htView || pioView) && (
            <div className={`mt-3 grid gap-4 ${htView && pioView ? "lg:grid-cols-2" : ""}`}>
              {(
                [
                  ["htsolver", htView, displayData.ht, "text-emerald-400"],
                  ["PioSolver", pioView, displayData.pio, "text-sky-400"],
                ] as const
              )
                .filter(([, solverView]) => solverView != null)
                .map(([name, solverView, solverDisplay, color]) => (
                  <div key={name}>
                    <div className={`mb-1 text-sm font-medium ${color}`}>{name}</div>
                    <DecisionMatrix
                      gridData={solverView!.grid}
                      heightMode="normalized"
                      reachByHand={solverView!.reachByHand}
                      displayData={solverDisplay}
                      money={money}
                      selectedHand={selectedHand}
                      onHandSelect={onSelect}
                      onHandHover={setHoverHand}
                    />
                    <div className="mt-2">
                      <ActionSummary
                        data={solverView!.grid}
                        sizeRef={chipScale}
                        onActionClick={onActionClick}
                        compact
                      />
                    </div>
                    <div className="mt-2 h-64">
                      <HandBreakdown
                        data={solverView!.grid}
                        hand={breakdownHand}
                        board={board}
                        comboDetail={solverView!.comboDetail}
                        displayMode={displayMode}
                        evRange={evRange}
                        chipEv={false}
                        sizeRef={chipScale}
                        className="h-full"
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
          <p className="mt-1 text-[11px] text-slate-600">
            Each grid's cell heights use that solver's own reach at this node
            {hasPioDetail ? "; EV heat shares one color scale across both" : ""}. Click an
            action panel to walk into that line; hover or click a hand class for its combos.
          </p>

          {/* per-combo table */}
          {(htNode || pioNode) && (
            <div className="mt-5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-slate-300">
                  Per-combo{hasPioDetail ? " comparison" : ""}
                  {selectedHand ? ` — ${selectedHand}` : ""}
                </h2>
                <select
                  value={effectiveSortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className={`ml-auto ${inputCls} text-xs`}
                  aria-label="Sort combos"
                >
                  {hasPioDetail && <option value="evDiff">Sort by |ΔEV|</option>}
                  {hasPioDetail && <option value="l1">Sort by reach·L1</option>}
                  <option value="reach">Sort by reach</option>
                  <option value="hand">Sort by combo</option>
                </select>
              </div>
              <div className="mt-2 overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full min-w-[720px] text-right text-xs tabular-nums">
                  <thead className="bg-slate-800/80 text-slate-400">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Combo</th>
                      <th className="px-2 py-1.5">Reach</th>
                      {tableLabels.map((label) => (
                        <th key={label} className="px-2 py-1.5">
                          {label}
                          <span className="block font-normal text-slate-600">
                            {hasPioDetail ? "ht% / pio%" : "ht%"}
                          </span>
                        </th>
                      ))}
                      <th className="px-2 py-1.5">
                        EV chips
                        <span className="block font-normal text-slate-600">
                          {hasPioDetail ? "ht / pio" : "ht"}
                        </span>
                      </th>
                      {hasPioDetail && <th className="px-2 py-1.5">ΔEV chips</th>}
                      {hasPioDetail && <th className="px-2 py-1.5">L1</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((h) => {
                      const diff =
                        h.ht?.ev == null || h.pio?.ev == null ? null : h.ht.ev - h.pio.ev;
                      const diffBad =
                        diff != null && spot != null && Math.abs(diff) > spot.pot * 0.02;
                      return (
                        <tr key={h.hand} className="border-t border-slate-800/70">
                          <td className="px-2 py-1 text-left font-medium text-slate-200">
                            {h.hand}
                          </td>
                          <td className="px-2 py-1 text-slate-400">{h.reach.toFixed(3)}</td>
                          {tableLabels.map((label, k) => (
                            <td key={label} className="px-2 py-1">
                              <span className="text-emerald-300">{pct(h.ht?.freq[k])}</span>
                              {hasPioDetail && (
                                <>
                                  <span className="text-slate-600"> / </span>
                                  <span className="text-sky-300">{pct(h.pio?.freq[k])}</span>
                                </>
                              )}
                            </td>
                          ))}
                          <td className="px-2 py-1">
                            <span className="text-emerald-300">{chips(h.ht?.ev)}</span>
                            {hasPioDetail && (
                              <>
                                <span className="text-slate-600"> / </span>
                                <span className="text-sky-300">{chips(h.pio?.ev)}</span>
                              </>
                            )}
                          </td>
                          {hasPioDetail && (
                            <td
                              className={`px-2 py-1 ${
                                diffBad ? "font-semibold text-amber-400" : "text-slate-400"
                              }`}
                            >
                              {diff == null ? "-" : diff.toFixed(2)}
                            </td>
                          )}
                          {hasPioDetail && (
                            <td className="px-2 py-1 text-slate-500">
                              {h.l1 == null ? "-" : h.l1.toFixed(3)}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {tableRows.length > shownRows.length && (
                <p className="mt-1 text-[11px] text-slate-600">
                  Showing {shownRows.length} of {tableRows.length} combos - narrow with the
                  sort or a hand-class filter.
                </p>
              )}
            </div>
          )}

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
