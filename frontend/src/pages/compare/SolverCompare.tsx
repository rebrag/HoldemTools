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

/**
 * Hidden verification page (/compare, no nav entry): htsolver and PioSolver
 * side by side, per hand, for the same spot.
 *
 * Two ways in:
 *  - Build a spot in the tree builder and "Solve & Compare" - the local dev
 *    API solves it with htsolver, then builds + solves the IDENTICAL tree in
 *    Pio (validated node-for-node) and returns the comparison. Dev machine
 *    only (the endpoint 404s when Engine:LocalSolutionsDir is unset).
 *  - Drop a JSON produced by `watcher/engine_compare.py --json-out` - works
 *    anywhere, including the deployed site.
 *
 * Reading the numbers: only the game VALUE of a 2p zero-sum spot is unique;
 * per-hand strategies (and, via blockers, per-hand EVs) may legitimately
 * differ between two exact equilibria. The correctness verdict is the
 * cross-check badge (Pio's own evaluator rating the htsolver strategy); the
 * per-hand view is for seeing where and how the two solutions differ.
 */

/* ---------- the harness's JSON shapes ---------- */

interface CompareHand {
  hand: string; // "9h9c", higher card first
  reach: number;
  ht: { freq: number[]; ev: number; action_ev?: (number | null)[] };
  pio: { freq: number[]; ev: number | null; action_ev?: (number | null)[] };
  l1: number;
}

interface CompareNode {
  id: string; // colon form, "r:0:b100"
  actor: number;
  position: string; // "OOP" | "IP"
  actions: string[]; // raw labels: "f" | "c" | "bNNN"
  hands: CompareHand[];
}

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
    mean_l1: number;
    mean_ev_diff: number;
    sampled?: boolean;
    runouts?: number | null;
    decision_nodes?: number;
    compared_nodes?: number;
    detail_nodes?: number;
  };
  nodes: CompareNode[];
}

/* ---------- helpers ---------- */

const parseBoard = (board: string): string[] =>
  (board.match(/[2-9TJQKA][hdcs]/gi) ?? []).map(
    (c) => c[0].toUpperCase() + c[1].toLowerCase()
  );

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
  grid: HandCellData[];
  comboDetail: ComboDetail;
}

interface NodeView {
  labels: string[];
  ht: SolverView;
  pio: SolverView;
  reachByHand: Map<string, number>;
  /** Shared EV range over BOTH solvers' combos, so heat colors compare. */
  evRange: ValueRange | null;
}

/** Per-solver 169-class grid + ComboDetail from the comparison rows.
 *  Aggregation is range-weighted with a plain-mean fallback - the same rule
 *  as the schema-4 pipeline. */
const buildNodeView = (node: CompareNode): NodeView => {
  const labels = displayLabels(node);
  const nActions = labels.length;

  interface Agg {
    w: number;
    n: number;
    freqW: [number[], number[]];
    freqPlain: [number[], number[]];
    evW: [number, number];
    evWSum: [number, number];
  }
  const byClass = new Map<string, Agg>();
  const byCombo: [Map<string, ComboRow>, Map<string, ComboRow>] = [new Map(), new Map()];
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
        freqW: [Array(nActions).fill(0), Array(nActions).fill(0)],
        freqPlain: [Array(nActions).fill(0), Array(nActions).fill(0)],
        evW: [0, 0],
        evWSum: [0, 0],
      };
      byClass.set(cls, agg);
    }
    agg.w += hand.reach;
    agg.n += 1;

    const solvers = [hand.ht, hand.pio] as const;
    solvers.forEach((solver, s) => {
      if (solver.ev != null) {
        agg!.evW[s] += hand.reach * solver.ev;
        agg!.evWSum[s] += hand.reach;
        if (hand.reach > 0) {
          if (solver.ev < evMin) evMin = solver.ev;
          if (solver.ev > evMax) evMax = solver.ev;
        }
      }
      for (let k = 0; k < nActions; k++) {
        agg!.freqW[s][k] += hand.reach * solver.freq[k];
        agg!.freqPlain[s][k] += solver.freq[k];
      }
      const actions: ComboRow["actions"] = {};
      for (let k = 0; k < nActions; k++) {
        actions[labels[k]] = {
          freq: solver.freq[k],
          ev: solver.action_ev?.[k] ?? null,
          evLoss: null,
        };
      }
      byCombo[s].set(comboKey(c1, c2), {
        key: comboKey(c1, c2),
        weight: hand.reach,
        equity: null,
        ev: solver.ev,
        matchups: null,
        actions,
      });
    });
  }

  const reachByHand = new Map<string, number>();
  const grids: [HandCellData[], HandCellData[]] = [[], []];
  for (const [cls, agg] of byClass) {
    reachByHand.set(cls, agg.w / combosForHand(cls));
    for (const s of [0, 1] as const) {
      const actions: Record<string, number> = {};
      const evs: Record<string, number> = {};
      const ev = agg.evWSum[s] > 0 ? agg.evW[s] / agg.evWSum[s] : null;
      for (let k = 0; k < nActions; k++) {
        actions[labels[k]] =
          agg.w > 0 ? agg.freqW[s][k] / agg.w : agg.freqPlain[s][k] / agg.n;
        if (ev != null) evs[labels[k]] = ev;
      }
      grids[s].push({ hand: cls, actions, evs });
    }
  }

  return {
    labels,
    ht: { grid: grids[0], comboDetail: { actor: "oop", actions: labels, byCombo: byCombo[0] } },
    pio: { grid: grids[1], comboDetail: { actor: "oop", actions: labels, byCombo: byCombo[1] } },
    reachByHand,
    evRange: evMin <= evMax ? { min: evMin, max: evMax } : null,
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

/* ---------- tree builder ---------- */

interface StreetInputs {
  ipBets: string;
  ipRaises: string;
  oopBets: string;
  oopDonks: string;
  oopRaises: string;
}

interface BuilderState {
  board: string;
  pot: string;
  stacks: string;
  oopRange: string;
  ipRange: string;
  flop: StreetInputs;
  turn: StreetInputs;
  river: StreetInputs;
  preflopAggressor: "none" | "ip" | "oop";
  addAllin: boolean;
  allinThresholdPct: string; // of effective stack
  maxRaises: string;
  accuracyMode: "pct" | "chips";
  accuracy: string;
  maxIterations: string;
}

const DEFAULT_STREET: StreetInputs = {
  ipBets: "50",
  ipRaises: "100",
  oopBets: "50",
  oopDonks: "",
  oopRaises: "100",
};

const DEFAULT_BUILDER: BuilderState = {
  board: "9c 5d Jc 7s 9h",
  pot: "100",
  stacks: "400",
  oopRange: "100%",
  ipRange: "100%",
  flop: { ...DEFAULT_STREET },
  turn: { ...DEFAULT_STREET },
  river: { ...DEFAULT_STREET, ipBets: "50 100", oopBets: "50 100" },
  preflopAggressor: "none",
  addAllin: true,
  allinThresholdPct: "90",
  maxRaises: "3",
  accuracyMode: "pct",
  accuracy: "0.02",
  maxIterations: "20000",
};

const FULL_RANGE = (() => {
  const ranks = "AKQJT98765432";
  const tokens: string[] = [];
  for (let i = 0; i < 13; i++) {
    tokens.push(ranks[i] + ranks[i]);
    for (let j = i + 1; j < 13; j++) {
      tokens.push(ranks[i] + ranks[j] + "s", ranks[i] + ranks[j] + "o");
    }
  }
  return tokens.join(",");
})();

const expandRange = (text: string): string =>
  text.trim() === "100%" || text.trim() === "" ? FULL_RANGE : text.trim();

/** Build the engine config + accuracy from the form; throws with a readable
 *  message on invalid input. */
const buildConfig = (b: BuilderState): { config: object; pioAccuracyPct: number } => {
  const board = parseBoard(b.board);
  if (board.length < 3 || board.length > 5) {
    throw new Error("Board needs 3 (flop solve), 4 (turn), or 5 (river) cards.");
  }
  if (new Set(board).size !== board.length) throw new Error("Board has duplicate cards.");
  const pot = Number(b.pot);
  const stacks = Number(b.stacks);
  if (!(pot > 0)) throw new Error("Starting pot must be positive.");
  if (!(stacks >= 0)) throw new Error("Effective stacks cannot be negative.");
  const nums = (text: string): number[] =>
    text.split(/[\s,]+/).filter(Boolean).map((x) => {
      const v = Number(x);
      if (!(v > 0)) throw new Error(`Bad size "${x}" - sizes are % of pot.`);
      return v;
    });

  const allinThreshold = Math.min(1.5, Math.max(0.1, Number(b.allinThresholdPct) / 100 || 0.9));
  const maxRaises = Math.max(0, Math.min(20, Number(b.maxRaises) || 3));
  const streetSizing = (s: StreetInputs) => {
    // "Add allin": an oversized entry clamps to the effective stack. Donks
    // only get one when some donk size is configured (an empty donk list
    // deliberately means "no leading into the aggressor").
    const withAllin = (sizes: number[], always: boolean) =>
      b.addAllin && (always || sizes.length > 0) ? [...sizes, 10000] : sizes;
    return {
      ip: { bets: withAllin(nums(s.ipBets), true), raises: withAllin(nums(s.ipRaises), true) },
      oop: {
        bets: withAllin(nums(s.oopBets), true),
        donks: withAllin(nums(s.oopDonks), false),
        raises: withAllin(nums(s.oopRaises), true),
      },
      allin_threshold: allinThreshold,
      max_raises: maxRaises,
    };
  };

  const betSizing: Record<string, unknown> = { river: streetSizing(b.river) };
  if (board.length <= 4) betSizing.turn = streetSizing(b.turn);
  if (board.length === 3) betSizing.flop = streetSizing(b.flop);

  const accuracy = Number(b.accuracy);
  if (!(accuracy > 0)) throw new Error("Accuracy must be positive.");
  const accuracyPct = b.accuracyMode === "pct" ? accuracy : (accuracy / pot) * 100;

  return {
    pioAccuracyPct: accuracyPct,
    config: {
      schema: 1,
      game: "nlhe",
      board: board.join(" "),
      pot,
      chip_scale: 100,
      players: [
        { seat: "OOP", stack: stacks, range: expandRange(b.oopRange) },
        { seat: "IP", stack: stacks, range: expandRange(b.ipRange) },
      ],
      bet_sizing: betSizing,
      preflop_aggressor: b.preflopAggressor,
      algorithm: { update: "dcfr" },
      qre: { mode: "nash" },
      budget: {
        iterations: Math.max(100, Number(b.maxIterations) || 20000),
        target_exploitable_pct: accuracyPct,
        checkpoint_every: 250,
      },
      memory_limit_gb: 12,
      threads: 0,
    },
  };
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
  completedAtUtc: string | null;
}

const TERMINAL_STATUSES = ["Done", "Failed"];

const solutionsUrl = (job: CompareJob): string =>
  `/solutions?open=${encodeURIComponent(
    `${job.resultStacks}|${job.resultNodeName}|${job.board}`
  )}`;

/* ---------- page ---------- */

type SortKey = "evDiff" | "l1" | "reach" | "hand";
type DisplayMode = "strategy" | "ev";

const inputCls =
  "rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-1 text-sm text-slate-200 " +
  "focus:border-emerald-500 focus:outline-none";

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 text-xs text-slate-400">
    {label}
    {children}
  </label>
);

const SolverCompare = () => {
  const [doc, setDoc] = useState<CompareDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nodeIndex, setNodeIndex] = useState(0);
  const [selectedHand, setSelectedHand] = useState<string | null>(null);
  const [hoverHand, setHoverHand] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("evDiff");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("strategy");
  const [builder, setBuilder] = useState<BuilderState>(DEFAULT_BUILDER);
  const [builderOpen, setBuilderOpen] = useState(true);
  const [solving, setSolving] = useState(false);
  const [runLog, setRunLog] = useState<string | null>(null);
  const [jobs, setJobs] = useState<CompareJob[]>([]);
  const [activeJob, setActiveJob] = useState<CompareJob | null>(null);
  const [publishedJob, setPublishedJob] = useState<CompareJob | null>(null);
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
    setNodeIndex(0);
    setSelectedHand(null);
    setHoverHand(null);
    setBuilderOpen(false);
    setError(null);
  }, []);

  const loadFile = useCallback(
    (file: File) => {
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
    async (job: CompareJob) => {
      setError(null);
      try {
        const resp = await authedFetch(`/api/enginecompare/${job.id}/result`);
        if (!resp.ok) throw new Error(await resp.text());
        acceptDoc((await resp.json()) as CompareDoc);
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
        payload = buildConfig(builder);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      setSolving(true);
      setPublishedJob(null);
      try {
        const createResp = await authedFetch("/api/enginecompare", {
          method: "POST",
          body: JSON.stringify({ ...payload, mode }),
        });
        if (createResp.status === 403) {
          throw new Error("Publishing to the solutions library is admin-only.");
        }
        if (!createResp.ok) throw new Error(await createResp.text());
        let job = (await createResp.json()) as CompareJob;
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
          await loadJobResult(job);
        } else {
          setPublishedJob(job);
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
      const { config } = buildConfig(builder);
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

  const chipScale = doc?.spot.chip_scale ?? 100;
  // Everything on this page displays in chips (mode "money" = plain numbers,
  // no bb suffix); bbSize still calibrates the bet-label color ramp.
  const money: MoneyOpts = useMemo(
    () => ({ mode: "money", bbSize: chipScale }),
    [chipScale]
  );
  const node = doc?.nodes[nodeIndex] ?? null;
  const view = useMemo(() => (node ? buildNodeView(node) : null), [node]);
  const board = useMemo(() => (doc ? parseBoard(doc.spot.board) : []), [doc]);

  const displayData = useMemo(() => {
    if (!view || displayMode !== "ev") return { ht: null, pio: null };
    return {
      ht: buildEvDisplay(view.ht.comboDetail, board, view.evRange),
      pio: buildEvDisplay(view.pio.comboDetail, board, view.evRange),
    };
  }, [view, displayMode, board]);

  const breakdownHand = hoverHand ?? selectedHand;

  const tableRows = useMemo(() => {
    if (!node) return [];
    let rows = node.hands;
    if (selectedHand) {
      rows = rows.filter(
        (h) => handClassOf(h.hand.slice(0, 2), h.hand.slice(2, 4)) === selectedHand
      );
    }
    const evDiff = (h: CompareHand) =>
      h.pio.ev == null ? 0 : Math.abs(h.ht.ev - h.pio.ev);
    const sorted = [...rows];
    if (sortKey === "evDiff") sorted.sort((a, b) => evDiff(b) - evDiff(a));
    else if (sortKey === "l1") sorted.sort((a, b) => b.l1 * b.reach - a.l1 * a.reach);
    else if (sortKey === "reach") sorted.sort((a, b) => b.reach - a.reach);
    else sorted.sort((a, b) => a.hand.localeCompare(b.hand));
    return sorted;
  }, [node, selectedHand, sortKey]);

  const shownRows = tableRows.slice(0, 200);
  const chips = (v: number | null | undefined): string => (v == null ? "-" : v.toFixed(2));
  const pct = (f: number): string => `${Math.round(f * 1000) / 10}`;

  const onSelect = useCallback(
    (hand: string) => setSelectedHand((cur) => (cur === hand ? null : hand)),
    []
  );

  const onActionClick = useCallback(
    (label: string) => {
      if (!doc || !node || !view) return;
      const k = view.labels.indexOf(label);
      if (k < 0) return;
      const childId = `${node.id}:${node.actions[k]}`;
      const idx = doc.nodes.findIndex((n) => n.id === childId);
      if (idx >= 0) {
        setNodeIndex(idx);
        setSelectedHand(null);
        setHoverHand(null);
      }
    },
    [doc, node, view]
  );

  const cross = doc?.summary.cross_check;

  return (
    <div className="mx-auto max-w-7xl px-3 py-6 text-slate-200">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-white">Solver comparison</h1>
        <span className="text-xs text-slate-500">
          <span className="font-medium text-emerald-400">htsolver</span> vs{" "}
          <span className="font-medium text-sky-400">PioSolver</span>, per hand
        </span>
        <button
          type="button"
          onClick={() => setBuilderOpen((o) => !o)}
          className="ml-auto rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
        >
          {builderOpen ? "Hide tree builder" : "Tree builder"}
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
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

      {/* ---------- tree builder (PioViewer-style) ---------- */}
      {builderOpen && (
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Board (5 cards, rivers only)">
              <input
                className={inputCls}
                value={builder.board}
                onChange={(e) => setB("board", e.target.value)}
                placeholder="9c 5d Jc 7s 9h"
              />
            </Field>
            <Field label="Starting pot (chips)">
              <input
                className={inputCls}
                value={builder.pot}
                onChange={(e) => setB("pot", e.target.value)}
              />
            </Field>
            <Field label="Effective stacks (chips)">
              <input
                className={inputCls}
                value={builder.stacks}
                onChange={(e) => setB("stacks", e.target.value)}
              />
            </Field>
            <Field label="Max raises per street">
              <input
                className={inputCls}
                value={builder.maxRaises}
                onChange={(e) => setB("maxRaises", e.target.value)}
              />
            </Field>
            <Field label="OOP range (tokens or 100%)">
              <input
                className={inputCls}
                value={builder.oopRange}
                onChange={(e) => setB("oopRange", e.target.value)}
                placeholder="100%  |  AA,KK,AKs:0.5,..."
              />
            </Field>
            <Field label="IP range (tokens or 100%)">
              <input
                className={inputCls}
                value={builder.ipRange}
                onChange={(e) => setB("ipRange", e.target.value)}
              />
            </Field>
            <Field label="Preflop aggressor (gates OOP donk sizes)">
              <select
                className={inputCls}
                value={builder.preflopAggressor}
                onChange={(e) =>
                  setB("preflopAggressor", e.target.value as BuilderState["preflopAggressor"])
                }
              >
                <option value="none">none</option>
                <option value="ip">IP</option>
                <option value="oop">OOP</option>
              </select>
            </Field>
          </div>

          {/* Per-street sizing, PioViewer-style. Sections follow the board:
              3 cards shows flop+turn+river, 4 shows turn+river, 5 river only. */}
          <div className="mt-3 space-y-2">
            {(
              [
                ["flop", "Flop", 3],
                ["turn", "Turn", 4],
                ["river", "River", 5],
              ] as const
            ).map(([key, name, minLen]) => {
              const boardLen = parseBoard(builder.board).length;
              if (boardLen > minLen) return null;
              const street = builder[key];
              const setStreet = (field: keyof StreetInputs, value: string) =>
                setB(key, { ...street, [field]: value });
              return (
                <div key={key} className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <div className="text-xs font-semibold text-slate-300">{name}</div>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    {(
                      [
                        ["ipBets", "IP bet sizes %"],
                        ["ipRaises", "IP raise sizes %"],
                        ["oopBets", "OOP bet sizes %"],
                        ["oopDonks", "OOP donk sizes %"],
                        ["oopRaises", "OOP raise sizes %"],
                      ] as const
                    ).map(([field, label]) => (
                      <Field key={field} label={label}>
                        <input
                          className={inputCls}
                          value={street[field]}
                          onChange={(e) => setStreet(field, e.target.value)}
                          placeholder={field === "oopDonks" ? "(empty = no donks)" : "50 100"}
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={builder.addAllin}
                onChange={(e) => setB("addAllin", e.target.checked)}
                className="accent-emerald-500"
              />
              Add allin
            </label>
            <Field label="All-in threshold (% of effective stack)">
              <input
                className={`${inputCls} w-20`}
                value={builder.allinThresholdPct}
                onChange={(e) => setB("allinThresholdPct", e.target.value)}
              />
            </Field>

            {/* Accuracy settings, PioViewer-style */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
              <div className="text-xs font-medium text-slate-300">
                Stop calculation if desired accuracy reached
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="accuracy-mode"
                    checked={builder.accuracyMode === "pct"}
                    onChange={() => setB("accuracyMode", "pct")}
                    className="accent-emerald-500"
                  />
                  <input
                    className={`${inputCls} w-20`}
                    value={builder.accuracyMode === "pct" ? builder.accuracy : ""}
                    onChange={(e) => {
                      setB("accuracyMode", "pct");
                      setB("accuracy", e.target.value);
                    }}
                  />
                  % of the pot
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="accuracy-mode"
                    checked={builder.accuracyMode === "chips"}
                    onChange={() => setB("accuracyMode", "chips")}
                    className="accent-emerald-500"
                  />
                  <input
                    className={`${inputCls} w-20`}
                    value={builder.accuracyMode === "chips" ? builder.accuracy : ""}
                    onChange={(e) => {
                      setB("accuracyMode", "chips");
                      setB("accuracy", e.target.value);
                    }}
                  />
                  chips
                </label>
                <Field label="Max iterations (htsolver)">
                  <input
                    className={`${inputCls} w-24`}
                    value={builder.maxIterations}
                    onChange={(e) => setB("maxIterations", e.target.value)}
                  />
                </Field>
              </div>
              <p className="mt-1 text-[10px] text-slate-600">
                Applied to both solvers: htsolver stops when its self-reported per-player
                exploitability drops below this; Pio solves to the same accuracy.
              </p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={downloadConfig}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
                title="Save the htsolver config to run manually"
              >
                Download config
              </button>
              <button
                type="button"
                onClick={() => void submitJob("publish")}
                disabled={solving}
                title="htsolver only: publish the solve to the Solutions library (admin)"
                className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500 disabled:opacity-50"
              >
                Solve & Publish
              </button>
              <button
                type="button"
                onClick={() => void submitJob("compare")}
                disabled={solving}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {solving ? "Working..." : "Solve & Compare"}
              </button>
            </div>
          </div>
          {solving && (
            <p className="mt-2 text-xs text-slate-500">
              Queued for the compare watcher (the machine with both solvers).
              {activeJob ? ` Status: ${activeJob.status}.` : ""} htsolver takes under a
              second; Pio usually takes a minute or two. Leaving this page keeps the job
              running - it stays in Recent runs.
            </p>
          )}
          {publishedJob && (
            <p className="mt-2 text-xs text-emerald-300">
              Published to the solutions library:{" "}
              <a className="underline" href={solutionsUrl(publishedJob)}>
                open {publishedJob.board} in /solutions
              </a>
            </p>
          )}

          {/* Recent runs */}
          {jobs.length > 0 && (
            <div className="mt-4 border-t border-slate-800 pt-3">
              <div className="text-xs font-medium text-slate-400">Recent runs</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                    className={`rounded-lg border px-2 py-1 text-[11px] ${
                      job.status === "Done"
                        ? "border-slate-600 text-slate-200 hover:border-emerald-500"
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
            </div>
          )}
        </div>
      )}

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

          <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
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
                mean L1 {doc.summary.mean_l1.toFixed(3)} · mean |ΔEV|{" "}
                {doc.summary.mean_ev_diff.toFixed(2)}
              </div>
              {doc.summary.compared_nodes != null &&
                doc.summary.detail_nodes != null &&
                doc.summary.detail_nodes < doc.summary.compared_nodes && (
                  <div className="text-slate-500">
                    detail: {doc.summary.detail_nodes} most-reached of{" "}
                    {doc.summary.compared_nodes} compared nodes
                  </div>
                )}
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
              {doc.nodes.map((n, i) => (
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
              disabled={nodeIndex >= doc.nodes.length - 1}
              onClick={() => setNodeIndex((i) => Math.min(doc.nodes.length - 1, i + 1))}
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

          {/* side-by-side: matrix + action summary + hand breakdown */}
          {view && (
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              {(
                [
                  ["htsolver", view.ht, displayData.ht, "text-emerald-400"],
                  ["PioSolver", view.pio, displayData.pio, "text-sky-400"],
                ] as const
              ).map(([name, solverView, solverDisplay, color]) => (
                <div key={name}>
                  <div className={`mb-1 text-sm font-medium ${color}`}>{name}</div>
                  <DecisionMatrix
                    gridData={solverView.grid}
                    heightMode="normalized"
                    reachByHand={view.reachByHand}
                    displayData={solverDisplay}
                    money={money}
                    selectedHand={selectedHand}
                    onHandSelect={onSelect}
                    onHandHover={setHoverHand}
                  />
                  <div className="mt-2">
                    <ActionSummary
                      data={solverView.grid}
                      sizeRef={chipScale}
                      onActionClick={onActionClick}
                      compact
                    />
                  </div>
                  <div className="mt-2 h-64">
                    <HandBreakdown
                      data={solverView.grid}
                      hand={breakdownHand}
                      board={board}
                      comboDetail={solverView.comboDetail}
                      displayMode={displayMode}
                      evRange={view.evRange}
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
            Cell heights use htsolver's reach at this node for both grids; EV heat shares one
            color scale across both solvers. Click an action panel to walk into that line;
            hover or click a hand class for its combos.
          </p>

          {/* per-combo table */}
          {node && view && (
            <div className="mt-5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-slate-300">
                  Per-combo comparison{selectedHand ? ` — ${selectedHand}` : ""}
                </h2>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className={`ml-auto ${inputCls} text-xs`}
                  aria-label="Sort combos"
                >
                  <option value="evDiff">Sort by |ΔEV|</option>
                  <option value="l1">Sort by reach·L1</option>
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
                      {view.labels.map((label) => (
                        <th key={label} className="px-2 py-1.5">
                          {label}
                          <span className="block font-normal text-slate-600">ht% / pio%</span>
                        </th>
                      ))}
                      <th className="px-2 py-1.5">
                        EV chips
                        <span className="block font-normal text-slate-600">ht / pio</span>
                      </th>
                      <th className="px-2 py-1.5">ΔEV chips</th>
                      <th className="px-2 py-1.5">L1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((h) => {
                      const diff = h.pio.ev == null ? null : h.ht.ev - h.pio.ev;
                      const diffBad = diff != null && Math.abs(diff) > doc.spot.pot * 0.02;
                      return (
                        <tr key={h.hand} className="border-t border-slate-800/70">
                          <td className="px-2 py-1 text-left font-medium text-slate-200">
                            {h.hand}
                          </td>
                          <td className="px-2 py-1 text-slate-400">{h.reach.toFixed(3)}</td>
                          {view.labels.map((label, k) => (
                            <td key={label} className="px-2 py-1">
                              <span className="text-emerald-300">{pct(h.ht.freq[k])}</span>
                              <span className="text-slate-600"> / </span>
                              <span className="text-sky-300">{pct(h.pio.freq[k])}</span>
                            </td>
                          ))}
                          <td className="px-2 py-1">
                            <span className="text-emerald-300">{chips(h.ht.ev)}</span>
                            <span className="text-slate-600"> / </span>
                            <span className="text-sky-300">{chips(h.pio.ev)}</span>
                          </td>
                          <td
                            className={`px-2 py-1 ${
                              diffBad ? "font-semibold text-amber-400" : "text-slate-400"
                            }`}
                          >
                            {diff == null ? "-" : diff.toFixed(2)}
                          </td>
                          <td className="px-2 py-1 text-slate-500">{h.l1.toFixed(3)}</td>
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
