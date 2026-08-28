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
import PostflopLine from "@/pages/solver/PostflopLine";
import TreeBuilding, { Check, inputCls } from "@/components/TreeBuilding";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import {
  buildChildIndex,
  buildCompareLine,
  segmentForLabel,
  ROOT_ID,
} from "./compareLineNodes";
import TreeLibrary from "./TreeLibrary";
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
import { ALL_CARDS } from "@/components/treeBuildingView";
import { displayLabelWith } from "./actionLabels";
import { isCardSegment, priorStreetCommitChips } from "@/lib/solver/postflopNode";
import PostflopCardPicker from "@/components/PostflopCardPicker";
import { pioRangeCodec } from "@/lib/solver/rangeTokens";
import PipelineTimingPanel, {
  secs,
  type ClientMarks,
  type JobTimings,
  type PipelineRun,
} from "./PipelineTimingPanel";
import {
  decodeNode,
  parseHtc,
  type DecodedNode,
  type HtcDoc,
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
    /* QRE solves only. `exploitable_*` above stays the PLAIN measurement,
     * which on a QRE solve plateaus at a lambda-dependent floor by design -
     * the gap is what such a solve converges on and stops against. Both
     * travel so the plateau reads as intended rather than as a stall. */
    mode?: "nash" | "qre";
    lambda?: number[] | null;
    qre_gap_chips?: number | null;
    qre_gap_pct_pot?: number | null;
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
const buildSolverView = (
  node: CompareNode,
  label: (segment: string, parentId: string) => string
): SolverView => {
  const labels = node.actions.map((a) => label(a, node.id));
  const nActions = labels.length;

  interface Agg {
    w: number;
    n: number;
    freqW: number[];
    freqPlain: number[];
    evW: number;
    evWSum: number;
    actionEvW: number[];
    actionEvWSum: number[];
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
        // Per-action EV, reach-weighted per action: a hand can carry an EV
        // for one action and null for another, so each needs its own
        // denominator rather than sharing the node EV's.
        actionEvW: Array(nActions).fill(0),
        actionEvWSum: Array(nActions).fill(0),
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
      const aev = hand.action_ev?.[k];
      if (aev != null) {
        agg.actionEvW[k] += hand.reach * aev;
        agg.actionEvWSum[k] += hand.reach;
      }
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
      // The EV of TAKING this action, not the node's strategy-weighted value.
      // Assigning the node EV to every action made the tooltip read as though
      // every action were worth the same - actively wrong, and most visibly so
      // on a QRE solve, where actions are deliberately NOT equalized (a Nash
      // solve makes in-support actions indifferent, which is what hid this).
      if (agg.actionEvWSum[k] > 0) {
        evs[labels[k]] = agg.actionEvW[k] / agg.actionEvWSum[k];
      } else if (ev != null) {
        evs[labels[k]] = ev;
      }
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

type DisplayMode = "strategy" | "ev";

const SolverCompare = () => {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nodeIndex, setNodeIndex] = useState(0);
  const [selectedHand, setSelectedHand] = useState<string | null>(null);
  const [hoverHand, setHoverHand] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("strategy");
  /** The open runout picker, when an action closed a street and the payload
   *  carries more than one card for it. */
  const [picker, setPicker] = useState<{
    chanceNodeId: string;
    street: "turn" | "river";
  } | null>(null);
  /* The cost panels are reference material, not the thing being looked at.
   * Collapsed they are one line, which is what buys the grids the vertical
   * space to fit a screen; the choice is remembered because a workbench that
   * forgets how you set it up is a worse workbench. */
  const [metricsOpen, setMetricsOpen] = useLocalStorageState<boolean>(
    "compareMetricsOpen",
    false,
    (raw) => raw === "1",
    (v) => (v ? "1" : "0")
  );
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
  // The form is asking for a QRE solve. Pio is not applicable to one, and the
  // accuracy target means the QRE gap rather than plain exploitability.
  const qreSelected = builder.updateRule === "qre";
  // The loaded RESULT was a QRE solve. Not the same question as the one above:
  // the form can have moved on since the run.
  const htIsQre = htSummary?.ht.mode === "qre";
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
        // Carried so the line strip can list a node's options without
        // re-deriving them from the directory, which cannot see a chance-node
        // child. See compareLineNodes.CompareNodeRef.
        actions: n.actions,
      })) ?? [],
    [loaded]
  );

  const chipScale = spot?.chip_scale ?? 100;
  // Everything on this page displays in chips (mode "money" = plain numbers,
  // no bb suffix). The colour ramp does NOT read bbSize any more - this page
  // has no big blind to calibrate against, so every ramp consumer below is
  // given an explicit sizeRef={currentPot} sizeUnit="pct" instead (see
  // currentPot). money.bbSize survives only as PostflopLine's fallback pot
  // reference for a node that somehow lacks its own potMoney.
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

  /** This payload's action formatter. One instance for the whole page: every
   *  grid, panel and line tile has to agree, and the two solvers' columns are
   *  joined on its output. */
  const displayLabel = useMemo(
    () => displayLabelWith(spot?.effective_stack),
    [spot?.effective_stack]
  );

  const htView = useMemo(
    () => (htNode ? buildSolverView(htNode, displayLabel) : null),
    [htNode, displayLabel]
  );
  const pioView = useMemo(
    () => (pioNode ? buildSolverView(pioNode, displayLabel) : null),
    [pioNode, displayLabel]
  );
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

  const chips = (v: number | null | undefined): string => (v == null ? "-" : v.toFixed(2));
  const megabytes = (v: number | null | undefined): string =>
    v == null ? "n/a" : v >= 1024 ** 3 ? `${(v / 1024 ** 3).toFixed(2)} GB` : `${Math.round(v / 1024 ** 2)} MB`;

  /* ---------- the line strip ----------
   * All of it comes off the node directory the header already carries: a node
   * id IS its own line (see compareLineNodes.ts), so browsing the tree needs
   * no extra state beyond the nodeIndex the page already had. */

  const nodeById = useMemo(
    () => new Map(nodeDir.map((n) => [n.id, n])),
    [nodeDir]
  );
  const childIndex = useMemo(() => buildChildIndex(nodeDir), [nodeDir]);
  const currentNodeId = nodeDir[nodeIndex]?.id ?? ROOT_ID;
  const line = useMemo(
    () => buildCompareLine(currentNodeId, nodeById, displayLabel, spot?.pot ?? 0),
    [currentNodeId, nodeById, displayLabel, spot?.pot]
  );

  /**
   * Pot facing the CURRENT node - the root pot plus what both seats have
   * committed on completed streets. This is the colour ramp's reference for
   * every grid/panel/card that renders the current node's OWN options
   * (DecisionMatrix, ActionSummary, HandBreakdown, and the line strip's
   * active card); a visited node further back in the strip carries its own
   * potMoney instead, since the pot at THAT point was smaller.
   *
   * /compare calibrates the ramp on percent of this pot rather than on big
   * blinds - unlike every /solver view, its trees have no big blind at all,
   * and percent of pot is literally how the tree builder specifies sizes.
   */
  const currentPot = useMemo(
    () => (spot ? spot.pot + 2 * priorStreetCommitChips(currentNodeId) : 0),
    [spot, currentNodeId]
  );

  /** The board as it stood at the ROOT. A 5-card board is a river solve, so
   *  the strip's first card has to say RIVER and show all five - calling it
   *  FLOP would name a decision the tree does not contain. */
  const rootLabel =
    board.length >= 5 ? "RIVER" : board.length === 4 ? "TURN" : "FLOP";

  const jumpToNode = useCallback(
    (id: string) => {
      const idx = nodeDir.findIndex((n) => n.id === id);
      if (idx < 0) return;
      setNodeIndex(idx);
      setSelectedHand(null);
      setHoverHand(null);
    },
    [nodeDir]
  );

  /** Branch: take a different action at an earlier decision. When the child is
   *  a chance node - the action closed the street - it has no header row of
   *  its own, so land on its first runout rather than doing nothing. */
  const branchTo = useCallback(
    (parentId: string, display: string) => {
      const segment = segmentForLabel(nodeById.get(parentId), display, displayLabel);
      if (!segment) return;
      const childId = `${parentId}:${segment}`;
      if (nodeById.has(childId)) {
        jumpToNode(childId);
        return;
      }
      /* The action closed the street, so the child is the deal. A chance node
       * has no strategy and therefore no header row of its own - what IS in
       * the directory is its runouts, so offer them. */
      const runouts = (childIndex.get(childId) ?? []).filter(isCardSegment);
      if (runouts.length === 0) return;
      if (runouts.length === 1) {
        // A picker with one legal card is a dialog that asks nothing.
        jumpToNode(`${childId}:${runouts[0]}`);
        return;
      }
      setPicker({
        chanceNodeId: childId,
        // Cards already out at this point decide which street is being dealt.
        street:
          board.length + childId.split(":").filter(isCardSegment).length === 3
            ? "turn"
            : "river",
      });
    },
    [childIndex, nodeById, jumpToNode, displayLabel, board.length]
  );

  /** Runouts this payload actually carries at the open picker, and the 52-card
   *  complement it cannot offer. `usedCards` is what PostflopCardPicker dims
   *  and refuses, so the complement going in there is what makes an absent
   *  runout unpickable without the component needing to know why. */
  const pickerCards = useMemo(() => {
    if (!picker) return null;
    const available = new Set(
      (childIndex.get(picker.chanceNodeId) ?? []).filter(isCardSegment)
    );
    const used = new Set(ALL_CARDS.filter((c) => !available.has(c)));
    return { available, used };
  }, [picker, childIndex]);

  const onSelect = useCallback(
    (hand: string) => setSelectedHand((cur) => (cur === hand ? null : hand)),
    []
  );

  /**
   * Take an action at the CURRENT node - the action panels under each grid,
   * and the to-act card on the line strip.
   *
   * Delegates to branchTo rather than repeating the descent, which is what
   * gives it the chance-node fallback. It did not have one before, so on any
   * multi-street tree the action that CLOSED a street - a call, or the check
   * that checks it through - silently did nothing: its child is the deal, and
   * a chance node has no strategy and therefore no row in the header. Those
   * are exactly the trees this page exists to compare.
   */
  const onActionClick = useCallback(
    (label: string) => branchTo(currentNodeId, label),
    [branchTo, currentNodeId]
  );

  /** Pio's cost divided by htsolver's: > 1 means htsolver won. Null whenever
   *  either side is missing, which now includes every engine-only run. */
  const ratioOf = (ht?: number | null, pio?: number | null): number | null =>
    ht != null && ht > 0 && pio != null ? pio / ht : null;
  const speedup = ratioOf(timing.ht_solve_s, timing.pio_solve_s);
  const memRatio = ratioOf(memory.ht_peak_bytes, memory.pio_peak_bytes);

  /* Everything the collapsed metrics line says, as chips. Same values the
   * expanded panels use - this is a projection of them, never a second
   * derivation. */
  const metricChips: { key: string; label: string; tone?: "good" | "bad" }[] = [];
  if (spot) {
    if (timing?.ht_solve_s != null) {
      metricChips.push({
        key: "ht",
        label: `htsolver ${secs(timing.ht_solve_s)}${
          memory?.ht_peak_bytes != null ? ` · ${megabytes(memory.ht_peak_bytes)}` : ""
        }`,
      });
    }
    if (hasPio && timing?.pio_solve_s != null) {
      metricChips.push({
        key: "pio",
        label: `Pio ${secs(timing.pio_solve_s)}${
          memory?.pio_peak_bytes != null ? ` · ${megabytes(memory.pio_peak_bytes)}` : ""
        }`,
      });
    }
    if (speedup != null) {
      metricChips.push({
        key: "speedup",
        label: `${(speedup >= 1 ? speedup : 1 / speedup).toFixed(1)}x ${
          speedup >= 1 ? "faster" : "slower"
        }`,
        tone: speedup >= 1 ? "good" : "bad",
      });
    }
    if (htSummary) {
      metricChips.push({
        key: "nashconv",
        label: `NashConv ${htSummary.ht.nashconv.toFixed(3)} · ${
          htSummary.ht.iterations
        } iters`,
      });
      // A QRE solve stopped on the gap, not on NashConv, so showing NashConv
      // alone would look like a run that never converged.
      if (htIsQre) {
        const lam = htSummary.ht.lambda;
        // Show lambda back on the pot-normalized scale the form uses, not the
        // engine's raw 1/chips.
        const spotPot = spot?.pot ?? 0;
        metricChips.push({
          key: "qre",
          label: `QRE gap ${(htSummary.ht.qre_gap_chips ?? 0).toFixed(3)}${
            lam && lam.length === 2 && spotPot > 0
              ? ` · lambda ${lam.map((l) => (l * spotPot).toFixed(0)).join("/")}`
              : ""
          }`,
        });
      }
    }
    metricChips.push({
      key: "nodes",
      label: `${htSummary?.decision_nodes ?? nodeDir.length} nodes`,
    });
  }

  /** One solver's column: name, grid sized off the available HEIGHT, actions.
   *
   *  The max-width is what stops an engine-only run leaving a wide band of
   *  dead space beside a square grid: the grid can never be taller than the
   *  row, so a column wider than the row is tall is width the breakdown rail
   *  should have instead. The 19rem is the page's non-grid chrome (header,
   *  runs, cost line, line strip, footer) - an approximation on purpose, since
   *  it only decides how much leftover width the column keeps. The grid itself
   *  is sized exactly, by the wrapper below. */
  const solverColumn = (
    name: string,
    solverView: SolverView,
    solverDisplay: MatrixDisplayData | null,
    color: string
  ) => (
    <div
      key={name}
      className="flex min-h-0 min-w-0 max-w-[calc(100dvh-19rem)] flex-1 flex-col gap-1.5"
    >
      <div className={`shrink-0 text-xs font-medium ${color}`}>{name}</div>
      {/* DecisionMatrix is w-full aspect-square and its className cannot be
          overridden through the spread, so the only way to bound it by height
          is a wrapper whose width comes FROM its height. That is what keeps
          the page on one screen at any window size. */}
      <div className="flex min-h-0 flex-1 justify-center">
        <div className="h-full min-h-[200px] max-w-full aspect-square">
          <DecisionMatrix
            gridData={solverView.grid}
            heightMode="normalized"
            reachByHand={solverView.reachByHand}
            displayData={solverDisplay}
            money={money}
            sizeRef={currentPot}
            sizeUnit="pct"
            selectedHand={selectedHand}
            onHandSelect={onSelect}
            onHandHover={setHoverHand}
          />
        </div>
      </div>
      <div className="shrink-0">
        <ActionSummary
          data={solverView.grid}
          sizeRef={currentPot}
          sizeUnit="pct"
          onActionClick={onActionClick}
          compact
        />
      </div>
    </div>
  );

  const loadedSolvers = (
    [
      ["htsolver", htView, displayData.ht, "text-emerald-400"],
      ["PioSolver", pioView, displayData.pio, "text-sky-400"],
    ] as const
  ).filter(([, solverView]) => solverView != null);

  return (
    /* A workbench, not a document: the page owns the viewport below the 3rem
       navbar and lays itself out inside it, so the grids never push the
       controls off screen. Deliberately not max-w-7xl - the width is the whole
       point on a wide monitor. */
    <div className="flex h-[calc(100dvh-48px)] w-full flex-col gap-2 overflow-hidden px-3 py-2 text-slate-200">
      {/* ---------- header: identity, spot, view controls, actions ---------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-sm font-semibold tracking-tight text-white">
          Solver comparison
        </h1>
        <span className="text-[11px] text-slate-500">
          {hasPio ? (
            <>
              <span className="font-medium text-emerald-400">htsolver</span> vs{" "}
              <span className="font-medium text-sky-400">PioSolver</span>
            </>
          ) : (
            <>
              <span className="font-medium text-emerald-400">htsolver</span> only
            </>
          )}
        </span>

        {spot && (
          <>
            <span className="flex items-center gap-1">
              {board.map((c) => (
                <PlayingCard key={c} code={c} width={22} />
              ))}
            </span>
            <span className="text-[11px] tabular-nums text-slate-400">
              pot {spot.pot}
            </span>
            {pioSummary?.source && (
              <span className="text-[11px] text-slate-600">{pioSummary.source}</span>
            )}

            {!hasPio ? (
              <span
                className="rounded-full bg-slate-700/40 px-2 py-0.5 text-[11px] font-semibold text-slate-300"
                title="PioSolver was not run for this spot, so there is nothing to compare against and no correctness gate."
              >
                no gate
              </span>
            ) : cross?.gate === "none" || cross?.pass == null ? (
              <span
                className="rounded-full bg-slate-700/40 px-2 py-0.5 text-[11px] font-semibold text-slate-300"
                title="The cross-exploitability gate was not requested for this run, so no correctness verdict was produced. Root EVs are still directly comparable."
              >
                no gate (cross-check off)
              </span>
            ) : (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  cross.pass
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-red-500/15 text-red-400"
                }`}
                title={
                  cross.gate === "root_ev"
                    ? "Sampled tree: gate is root-EV agreement (cross-exploitability needs a full strategy upload)"
                    : "Pio's own evaluator rating the htsolver strategy's exploitability"
                }
              >
                {cross.gate === "root_ev"
                  ? `root-EV ${cross.pass ? "PASS" : "FAIL"} · Δ ${
                      cross.root_ev_diff ?? "?"
                    }`
                  : `cross-check ${cross.pass ? "PASS" : "FAIL"} · ${
                      cross.ht_exploitable_per_pio ?? "?"
                    }`}
              </span>
            )}

            <div className="flex overflow-hidden rounded-lg border border-slate-700 text-[11px]">
              {(["strategy", "ev"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDisplayMode(mode)}
                  className={`px-2.5 py-0.5 transition-colors ${
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
                className="rounded-lg bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300"
              >
                {selectedHand} · clear
              </button>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {spot && (
            <button
              type="button"
              onClick={() => setMetricsOpen((open) => !open)}
              aria-expanded={metricsOpen}
              className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
            >
              {metricsOpen ? "Hide cost" : "Show cost"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setBuilderOpen(true)}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500"
          >
            Tree builder
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800/60"
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
      </div>

      {/* Recent runs stay on the page: they are how a previous comparison gets
          re-opened, which belongs next to the results rather than inside the
          builder. One line that scrolls, rather than a block that wraps. */}
      {jobs.length > 0 && (
        <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto">
          <span className="shrink-0 text-[11px] font-medium text-slate-500">Recent</span>
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
                className={`shrink-0 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
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
        <p className="flex shrink-0 items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300">
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-emerald-400"
          />
          Solving{activeJob ? ` · ${activeJob.status}` : ""} - this keeps running if you
          leave the page.
        </p>
      )}
      {publishedJob && (
        <p className="shrink-0 text-xs text-emerald-300">
          Published to the solutions library:{" "}
          <a className="underline" href={solutionsUrl(publishedJob)}>
            open {publishedJob.board} in /solutions
          </a>
        </p>
      )}
      {/* A publish run loads no payload, so `spot` stays null and this would be
          unreachable from inside the spot-gated cost panel below. A compare
          run's waterfall lives there instead, with the rest of the cost. */}
      {pipeline && pipeline.job.mode === "publish" && (
        <div className="max-h-[40vh] shrink-0 overflow-y-auto">
          <PipelineTimingPanel job={pipeline.job} marks={pipeline.marks} />
        </div>
      )}
      {error && (
        <p className="max-h-24 shrink-0 overflow-y-auto whitespace-pre-wrap rounded-lg bg-red-500/10 p-2 text-xs text-red-400">
          {error}
        </p>
      )}

      {/* ---------- cost, collapsed to one line by default ---------- */}
      {spot && !metricsOpen && metricChips.length > 0 && (
        <div className="no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/50 px-2.5 py-1 text-[11px]">
          {metricChips.map((chip, i) => (
            <span key={chip.key} className="flex shrink-0 items-center gap-2">
              {i > 0 && <span className="text-slate-700">·</span>}
              <span
                className={
                  chip.tone === "good"
                    ? "font-semibold text-emerald-300"
                    : chip.tone === "bad"
                      ? "font-semibold text-amber-300"
                      : "tabular-nums text-slate-400"
                }
              >
                {chip.label}
              </span>
            </span>
          ))}
          <span className="ml-auto shrink-0 text-[10px] text-slate-600">
            root EV {chips(htSummary?.ht.ev[0])} / {chips(htSummary?.ht.ev[1])}
          </span>
        </div>
      )}

      {/* ---------- cost, expanded ---------- */}
      {spot && metricsOpen && (
        <div className="max-h-[45vh] shrink-0 overflow-y-auto">
          {/* What the tree COST each solver: the headline when the point is
              comparing the two on one tree at one accuracy target. */}
          {(timing?.ht_solve_s != null || memory?.ht_peak_bytes != null) && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
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

          {runLog && (
            <details className="mt-3 text-xs text-slate-500">
              <summary className="cursor-pointer">Solver run log</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900/70 p-3 text-[11px]">
                {runLog}
              </pre>
            </details>
          )}
        </div>
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
          className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-700 bg-slate-800/30 px-6 text-slate-400 transition-colors hover:border-emerald-500"
        >
          <span className="font-medium">...or drop one or two .htc payloads here</span>
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
          {/* The line: one card per visited node, above the grids. Clicking a
              card walks back to that decision; clicking an option on it
              branches. Same node ids htsolver and Pio both emit. */}
          {nodeDir.length > 0 && (
            <div className="shrink-0">
              <PostflopLine
                preflopLine={null}
                board={board}
                rootLabel={rootLabel}
                rootCards={board}
                potMoney={spot.pot}
                money={money}
                sizeUnit="pct"
                actorPotMoney={currentPot}
                lineNodes={line.lineNodes}
                notice={null}
                onJump={jumpToNode}
                onPickAction={branchTo}
                onExit={() => {}}
                showExit={false}
                actorSeat={nodeDir[nodeIndex]?.position}
                actions={(htView?.labels ?? pioView?.labels ?? []).map((display) => ({
                  display,
                }))}
                onActionClick={onActionClick}
              />
            </div>
          )}

          {/* One column per loaded solver, plus a shared breakdown rail. The
              rail is where the per-hand detail went when it left the columns:
              side by side it costs the grids no height, and the two solvers'
              breakdowns for the same hand end up stacked, which is the
              comparison being made. */}
          {loadedSolvers.length > 0 && (
            <div className="flex min-h-0 flex-1 gap-3 overflow-auto">
              {loadedSolvers.map(([name, solverView, solverDisplay, color]) =>
                solverColumn(name, solverView!, solverDisplay, color)
              )}
              {/* The rail takes whatever the square grids do not, so an
                  engine-only run spends the spare width on per-hand detail
                  rather than on background. Floored so it stays readable when
                  two grids are competing for the same row. */}
              <div className="flex min-w-[16rem] flex-1 flex-col gap-2">
                {loadedSolvers.map(([name, solverView, , color]) => (
                  <div key={name} className="flex min-h-0 flex-1 flex-col">
                    <div className={`shrink-0 text-[11px] font-medium ${color}`}>
                      {name}
                      {breakdownHand ? ` · ${breakdownHand}` : ""}
                    </div>
                    <div className="min-h-0 flex-1">
                      <HandBreakdown
                        data={solverView!.grid}
                        hand={breakdownHand}
                        board={board}
                        comboDetail={solverView!.comboDetail}
                        displayMode={displayMode}
                        evRange={evRange}
                        chipEv={false}
                        sizeRef={currentPot}
                        sizeUnit="pct"
                        className="h-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer: the flat node picker, kept for jumps the strip cannot
              reach (a sibling subtree it never walked into). */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <label htmlFor="compare-node">Node</label>
            <select
              id="compare-node"
              value={nodeIndex}
              onChange={(e) => {
                setNodeIndex(Number(e.target.value));
                setSelectedHand(null);
                setHoverHand(null);
              }}
              className={`${inputCls} max-w-[22rem]`}
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
              className="rounded-lg border border-slate-700 px-2 py-0.5 text-slate-400 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={nodeIndex >= nodeDir.length - 1}
              onClick={() => setNodeIndex((i) => Math.min(nodeDir.length - 1, i + 1))}
              className="rounded-lg border border-slate-700 px-2 py-0.5 text-slate-400 disabled:opacity-40"
            >
              Next
            </button>
            <span className="text-slate-600">
              Cell heights use each solver's own reach at this node
              {hasPioDetail ? "; EV heat shares one colour scale across both" : ""}. Click
              an action panel or a line card to walk the tree; hover or click a hand class
              for its combos.
            </span>
          </div>
        </>
      )}

      {/* ---------- runout picker ----------
           Opens when an action closed a street, instead of silently landing on
           the first card in the payload. A .htc carries only the runouts it was
           written with, so anything absent is dimmed and inert rather than
           offered and then failing. */}
      {picker && pickerCards && (
        <PostflopCardPicker
          street={picker.street}
          usedCards={pickerCards.used}
          extractedCards={pickerCards.available}
          pendingStreet={null}
          onPick={(card) => {
            jumpToNode(`${picker.chanceNodeId}:${card}`);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
          onCancelPending={() => setPicker(null)}
          hint={
            <>
              This payload carries {pickerCards.available.size}{" "}
              {pickerCards.available.size === 1 ? "runout" : "runouts"} for this
              street
              {htSummary?.runouts != null
                ? ` - the solve sampled ${htSummary.runouts} evenly spaced cards per
                   chance node, because the tree was too big to dump in full`
                : ""}
              . The rest are not in the file, so they cannot be opened.
            </>
          }
        />
      )}

      {/* ---------- tree builder (PioViewer-style), in a modal so opening it
           does not push the comparison down the page ---------- */}
      <ResponsiveDrawer
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        scrollMode="custom"
        desktopMaxWidthClassName="sm:max-w-[80rem]"
        zClassName="z-[70]"
        ariaLabel="Tree building parameters"
      >
        <div className="flex h-[88vh] max-h-[88vh] flex-col">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold tracking-tight text-white">
              Tree building parameters
            </h2>
            <p className="text-[11px] text-slate-500">
              htsolver solves this tree; when PioSolver is enabled it gets the identical
              tree, node for node.
            </p>
          </div>

          {/* Two columns: the form, and the tree library beside it. The
              library has to stay visible while the form is being edited - the
              whole point of it is loading a spot and then tweaking it. */}
          <div className="flex min-h-0 flex-1 gap-4 px-4 py-3">
            <div className="min-w-0 flex-1 overflow-y-auto pr-1">
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
                {qreSelected && !builder.qreAnneal && (
                  <p className="mt-1 max-w-md text-[10px] leading-relaxed text-amber-500/80">
                    For a QRE solve this is the <strong>QRE gap</strong> - exploitability
                    measured against the same bounded-rationality objective the solve is
                    minimizing. Plain exploitability is reported too, but it plateaus by
                    design and will not reach this target: the strategy is deliberately
                    not Nash. Raise lambda if you want it to.
                  </p>
                )}
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
                  htsolver settings
                </legend>
                <div className="mt-1.5 flex flex-col gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400">Update rule</span>
                    <select
                      className={`${inputCls} w-40`}
                      value={builder.updateRule}
                      disabled={solving}
                      onChange={(e) =>
                        setB("updateRule", e.target.value as BuilderState["updateRule"])
                      }
                    >
                      <option value="dcfr">dcfr (default)</option>
                      <option value="cfr_plus">cfr_plus</option>
                      <option value="rm">rm</option>
                      <option value="qre">qre (bounded rationality)</option>
                    </select>
                    {builder.updateRule !== "dcfr" && (
                      <span className="max-w-[16rem] text-[10px] leading-relaxed text-amber-500/80">
                        {builder.updateRule === "cfr_plus"
                          ? "Measured at about 2x dcfr's iterations on the turn reference."
                          : builder.updateRule === "rm"
                            ? "Plain regret matching did not reach 0.02% of pot inside 20000 iterations on the turn reference."
                            : "Solves for a quantal response equilibrium, not Nash: players pick better actions more often, not always. PioSolver is disabled for these runs - a QRE is not comparable to a Nash solve."}
                      </span>
                    )}
                  </label>

                  {builder.updateRule === "qre" && (
                    <fieldset className="rounded border border-slate-800 p-2">
                      <legend className="px-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        Rationality (lambda)
                      </legend>
                      <div className="flex flex-wrap items-end gap-3">
                        {(
                          [
                            ["qreLambdaOop", "OOP"],
                            ["qreLambdaIp", "IP"],
                          ] as const
                        ).map(([field, label]) => (
                          <label key={field} className="flex flex-col gap-1">
                            <span className="text-[10px] text-slate-400">{label}</span>
                            <input
                              className={`${inputCls} w-20 tabular-nums`}
                              value={builder[field]}
                              disabled={solving}
                              onChange={(e) => setB(field, e.target.value)}
                              aria-label={`${label} rationality lambda`}
                            />
                          </label>
                        ))}
                      </div>
                      <p className="mt-1.5 max-w-[18rem] text-[10px] leading-relaxed text-slate-500">
                        Per pot, so the same number means the same thing on any tree.
                        <strong className="text-slate-400"> 20</strong> means an action worth
                        20% more of the pot is taken about 2.7x as often. Lower is more
                        human, higher approaches Nash. Set the two differently to solve a
                        sharp player against a loose one.
                      </p>
                      <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-300">
                        <input
                          type="checkbox"
                          className="accent-emerald-500"
                          checked={builder.qreAnneal}
                          disabled={solving}
                          onChange={(e) => setB("qreAnneal", e.target.checked)}
                        />
                        Anneal lambda toward Nash
                      </label>
                      {builder.qreAnneal && (
                        <div className="mt-1.5 flex flex-wrap items-end gap-3">
                          <label className="flex flex-col gap-1">
                            <span className="text-[10px] text-slate-400">x factor</span>
                            <input
                              className={`${inputCls} w-16 tabular-nums`}
                              value={builder.qreAnnealFactor}
                              disabled={solving}
                              onChange={(e) => setB("qreAnnealFactor", e.target.value)}
                              aria-label="Anneal factor"
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[10px] text-slate-400">by iteration</span>
                            <input
                              className={`${inputCls} w-20 tabular-nums`}
                              value={builder.qreAnnealAt}
                              disabled={solving}
                              onChange={(e) => setB("qreAnnealAt", e.target.value)}
                              aria-label="Anneal by iteration"
                            />
                          </label>
                          <span className="max-w-[18rem] text-[10px] leading-relaxed text-slate-500">
                            Grows lambda toward Nash, then averages only over the iterations
                            after it settles, so the target goes back to plain
                            exploitability. Swept over 24 boards: about 1.35x fewer
                            iterations, but roughly 1.44x more cost per iteration, so wall
                            clock is a wash. Useful to experiment with, not yet a speed-up.
                          </span>
                        </div>
                      )}
                    </fieldset>
                  )}

                  <Check
                    label="Suit isomorphism"
                    checked={builder.isomorphism}
                    disabled={solving}
                    onChange={(v) => setB("isomorphism", v)}
                    title="Collapse suit-equivalent runout subtrees. Lossless, and worth 1.3-1.6x on boards with a usable permutation. Turn off only to reproduce a pre-isomorphism result."
                  />
                  <Check
                    label="Recalc schedule"
                    checked={builder.recalc && !builder.sampling}
                    disabled={solving || builder.sampling}
                    onChange={(v) => setB("recalc", v)}
                    title="Stop re-traversing runout subtrees whose values have stopped moving. On by default; disabled automatically while chance sampling is on."
                  />
                  <Check
                    label="Chance sampling"
                    checked={builder.sampling}
                    disabled={solving}
                    onChange={(v) => setB("sampling", v)}
                    title="Traverse only some of each chance node's children per iteration, scaled by n/m. Unbiased, but slower here - it exists for preflop trees."
                  />
                  {builder.sampling && (
                    <div className="ml-4 flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 text-[11px] text-slate-300">
                        <span className="text-[10px] text-slate-400">runouts</span>
                        <input
                          className={`${inputCls} w-16 tabular-nums`}
                          value={builder.samplingRunouts}
                          onChange={(e) => setB("samplingRunouts", e.target.value)}
                        />
                        <span className="text-[10px] text-slate-400">anneal by</span>
                        <input
                          className={`${inputCls} w-20 tabular-nums`}
                          value={builder.samplingAnnealAt}
                          onChange={(e) => setB("samplingAnnealAt", e.target.value)}
                        />
                      </label>
                      <span className="max-w-[16rem] text-[10px] leading-relaxed text-amber-500/80">
                        Measured 1.9-3.0x SLOWER than full enumeration on flop and turn
                        trees. It turns the recalc schedule off, and the accuracy stop
                        cannot fire until it has annealed to exact enumeration.
                      </span>
                    </div>
                  )}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  PioSolver comparison
                </legend>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <Check
                    label="Run PioSolver"
                    checked={!builder.disablePio && !qreSelected}
                    disabled={solving || qreSelected}
                    onChange={setRunPio}
                    title={
                      qreSelected
                        ? "Unavailable for QRE: a quantal response equilibrium deliberately is not Nash, so rating it against Pio would be meaningless. The harness refuses these runs."
                        : "Build and solve the identical tree in Pio. Off by default: an htsolver-only run needs no Pio process at all and is much faster."
                    }
                  />
                  <div className="ml-4 flex flex-col gap-1.5">
                    <Check
                      label="Pio per-hand results"
                      checked={!builder.disableCompare && !qreSelected}
                      disabled={solving || builder.disablePio || qreSelected}
                      onChange={(v) => setB("disableCompare", !v)}
                      title="Extract Pio's strategy and EVs node by node over UPI, so its grid can sit beside htsolver's. This is the slow part of a comparison run."
                    />
                    <Check
                      label="Cross-exploitability gate"
                      checked={!builder.disableCrossCheck && !qreSelected}
                      disabled={solving || builder.disablePio || qreSelected}
                      onChange={(v) => setB("disableCrossCheck", !v)}
                      title="Load the htsolver strategy into Pio and let Pio rate how exploitable it is. The primary correctness statement; full trees only."
                    />
                  </div>
                  <span className="max-w-[16rem] text-[10px] leading-relaxed text-slate-500">
                    {qreSelected
                      ? "Disabled while the update rule is QRE. A quantal response equilibrium is not a Nash equilibrium, so there is nothing meaningful for Pio to agree with."
                      : "Off by default: htsolver alone is the fast loop. Turn Pio on when you want an accuracy check."}
                  </span>
                </div>
              </fieldset>
            </div>
            </div>

            {/* The tree library: built-in benchmark spots and the user's own
                saved trees, one click each. Replaces the write-only
                "Benchmark spot" dropdown, whose per-preset notes were only
                ever reachable as an <option title>. */}
            <div className="flex w-64 shrink-0 flex-col border-l border-slate-800 pl-4">
              <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Trees
              </h3>
              <div className="min-h-0 flex-1">
                <TreeLibrary value={builder} onChange={setBuilder} disabled={solving} />
              </div>
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
    </div>
  );
};

export default SolverCompare;
