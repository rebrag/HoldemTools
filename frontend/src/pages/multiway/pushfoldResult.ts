// src/pages/multiway/pushfoldResult.ts
//
// Decoding for the payload a `pushfold` job returns: `engine.exe dump-json`
// over the .hta artifact, gzipped by the watcher and served through
// GET /api/enginecompare/{id}/result/ht.
//
// The 169-class rollup the engine already writes into every decision node's
// blob IS the push/fold chart, so there is no new schema here and no exporter
// involved - the schema-4 bundle path is heads-up postflop by construction
// (manifest.seats is {oop, ip}) and correctly refuses a 4-seat artifact.
import type { HandCellData } from "@/lib/solver/utils";
import { HAND_ORDER } from "@/lib/solver/handOrder";

export interface DumpRollupEntry {
  class: string;
  weight: number;
  ev: number;
  freq: number[];
}

export interface DumpNode {
  node_id: number;
  parent_id: number | null;
  kind: "decision" | "chance" | "terminal";
  action_kind: "root" | "fold" | "check_call" | "bet" | "deal";
  action_amount: number;
  pot: number;
  actor: number | null;
  num_children: number;
  first_child: number | null;
  commit: number[];
  terminal?: "fold" | "showdown";
  fold_winner?: number;
  data?: { num_actions: number; rollup_169?: DumpRollupEntry[] };
}

export interface PushFoldDump {
  metadata: {
    seats: string[];
    stacks?: number[];
    ev_chips: number[];
    final_nashconv: number | null;
    iterations: number;
    pot: number;
    chip_scale: number;
    multiway_no_nash_guarantee: boolean;
    opponent_card_removal?: string;
    solver_family?: string;
    hand_symmetry?: string;
    final_exploitable_chips?: number | null;
    /** Present only when the solve ended before its budget: "time_budget"
     *  means it hit the wall-clock ceiling and wrote what it had, so the
     *  result is usable but less converged than requested. */
    stopped_reason?: string;
    requested_iterations?: number;
    /** The solve lineage: stable across resumes, so two artifacts sharing it
     *  are the same solve at different iteration counts. */
    solve_id?: string;
    team?: {
      seats: number[];
      awareness: string;
      ev_chips: number;
      baseline_ev_chips?: number[];
      baseline_team_ev_chips?: number;
      /** Iterations phase 1 actually ran, which is not the same as the
       *  requested config.agents.baseline_iterations when the time budget
       *  cut it short. `metadata.iterations` is the TEAM phase. */
      baseline_iterations?: number;
      uplift_chips?: number;
      strategy_export: string;
    } | null;
    team_rollup?: Record<
      string,
      {
        actor: number;
        partner: number;
        num_actions: number;
        freq: number[][][];
        /** Per (partner class, own class, action): reach-weighted TEAM EV in
         *  chips (own + partner), null where the conditioning never
         *  accumulated reach. Absent on payloads older than the field. */
        ev?: (number | null)[][][];
        /** Per partner class: how often that conditioning reaches this node,
         *  relative to the node's most-reached partner class (0..1). ~0 means
         *  the partner never arrives here with that hand (e.g. "partner
         *  folded AA") and the conditioned chart is untrained noise. */
        partner_reach?: number[];
      }
    >;
    board_sample?: { iter_count: number; pair_count: number; seed: number };
    preflop?: {
      button: number;
      sb_seat: number;
      bb_seat: number;
      small_blind: number;
      big_blind: number;
      action_order: number[];
    };
    /* ---- Provenance: what was asked for, and what it cost ----
     * `config` is the engine's own canonical parsed config - the settings
     * the solve ACTUALLY ran with, not what a form was showing when it was
     * queued - so the settings view reads it rather than reconstructing
     * anything. Typed loosely on purpose: it is rendered generically, and a
     * new engine key should show up without a frontend release. */
    config?: Record<string, unknown>;
    config_hash?: string;
    solver_version?: string;
    sampled?: { seed?: number; batch?: number; lanes?: number; symmetry?: boolean };
    threads?: number;
    wall_time_s?: number;
    setup_time_s?: number;
    export_time_s?: number;
    peak_rss_bytes?: number;
    solve_peak_rss_bytes?: number;
    node_count?: number;
    decision_node_count?: number;
    hand_universe?: number;
    effective_stack?: number;
  };
  nodes: Record<string, DumpNode>;
}

/** A number with thousands separators, or "-" for nothing. Iteration counts
 *  in the tens of millions are unreadable otherwise, which is half of why
 *  "100000000 iters" was ambiguous in the first place. */
export const fmtCount = (n: number | undefined | null): string =>
  n == null || !Number.isFinite(n) ? "-" : n.toLocaleString("en-US");

/** Settings actually used, flattened into labelled rows for display. Reads
 *  metadata.config (the engine's canonical copy) with measured values from
 *  metadata itself, so "requested" and "ran" can disagree visibly - which is
 *  the whole point when a time budget cut a phase short. */
export interface SettingRow {
  label: string;
  value: string;
  note?: string;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asNum = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

export const settingsRows = (meta: PushFoldDump["metadata"]): SettingRow[] => {
  const cfg = asRecord(meta.config);
  const budget = asRecord(cfg.budget);
  const agents = asRecord(cfg.agents);
  const algorithm = asRecord(cfg.algorithm);
  const sampledCfg = asRecord(algorithm.sampled);
  const preflop = asRecord(cfg.preflop);
  const rows: SettingRow[] = [];
  const push = (label: string, value: string | number | undefined, note?: string) => {
    if (value === undefined || value === "") return;
    rows.push({ label, value: String(value), note });
  };

  push("Solve ID", meta.solve_id, "continues when re-solved with this id");
  const team = meta.team;
  const reqIters = asNum(budget.iterations);
  // The ambiguity this view exists to kill: with a team, `iterations` is the
  // TEAM phase and the baseline is a separate budget entirely.
  push(
    team ? "Max iterations (team phase)" : "Max iterations",
    fmtCount(reqIters),
    reqIters != null && meta.iterations !== reqIters
      ? `ran ${fmtCount(meta.iterations)}`
      : "ran in full"
  );
  if (team) {
    const reqBase = asNum(agents.baseline_iterations);
    push(
      "Baseline iterations (phase 1)",
      fmtCount(reqBase ?? reqIters),
      reqBase == null ? "defaulted to max iterations" : undefined
    );
    if (team.baseline_iterations != null && team.baseline_iterations !== (reqBase ?? reqIters)) {
      rows[rows.length - 1].note = `ran ${fmtCount(team.baseline_iterations)}`;
    }
    push("Hand-sharing team", team.seats.map((s) => meta.seats?.[s] ?? s).join(" + "));
    push("Opponents", team.awareness === "unaware" ? "don't know (unaware)" : "know (aware)");
  }
  if (meta.stopped_reason) {
    push("Stopped early", meta.stopped_reason.replace("_", " "), "wrote what it had");
  }
  push("Wall-clock budget", asNum(budget.max_seconds), "seconds");
  push("Target accuracy", asNum(budget.target_nashconv), "chips");
  push("Checkpoint every", fmtCount(asNum(budget.checkpoint_every)));

  push("Solver core", meta.solver_family ?? String(algorithm.family ?? ""));
  push("Seed", asNum(sampledCfg.seed) ?? meta.sampled?.seed);
  push("Batch", fmtCount(asNum(sampledCfg.batch) ?? meta.sampled?.batch));
  push("Lanes", asNum(sampledCfg.lanes) ?? meta.sampled?.lanes);
  push("Hand symmetry", meta.hand_symmetry);

  push("Players", meta.seats?.length);
  push("Blinds", `${preflop.small_blind ?? "?"} / ${preflop.big_blind ?? "?"}`);
  const ante = asNum(preflop.ante);
  if (ante) push("Ante", ante);
  push("Stacks", meta.stacks?.join(", "));
  push("Button", meta.seats?.[meta.preflop?.button ?? -1]);
  push("Starting pot", meta.pot);

  push("Pairwise boards", fmtCount(meta.board_sample?.pair_count));
  push("Measuring boards", fmtCount(meta.board_sample?.iter_count));
  push("Board sample seed", meta.board_sample?.seed);

  push("Threads", meta.threads);
  const wall = meta.wall_time_s;
  if (wall != null) push("Solve time", `${wall.toFixed(1)} s`);
  if (meta.setup_time_s != null) push("Setup time", `${meta.setup_time_s.toFixed(1)} s`);
  if (meta.export_time_s != null) push("Export time", `${meta.export_time_s.toFixed(1)} s`);
  if (meta.peak_rss_bytes != null) {
    push("Peak memory", `${(meta.peak_rss_bytes / (1024 * 1024)).toFixed(0)} MB`);
  }
  push("Engine version", meta.solver_version);
  push("Config hash", meta.config_hash);
  return rows;
};

/** Jam-or-fold trees offer fold first whenever there is something to call, so
 *  the jam is always the last action. Naming them here keeps the colour
 *  mapping in lib/solver/constants (where ALLIN and Fold already live)
 *  rather than inventing a second vocabulary. */
/** The engine's 169-class grid convention (cards/combos.hpp): row-major
 *  13x13, ranks A..2 descending, i < j suited, i > j offsuit. team_rollup
 *  indexes cells by this raw class index, so the name table is mirrored
 *  here rather than assumed. */
const RANKS_DESC = "AKQJT98765432";
export const CLASS_NAMES: string[] = Array.from({ length: 169 }, (_, c) => {
  const i = Math.floor(c / 13);
  const j = c % 13;
  const hi = RANKS_DESC[Math.min(i, j)];
  const lo = RANKS_DESC[Math.max(i, j)];
  if (i === j) return `${hi}${lo}`;
  return `${hi}${lo}${i < j ? "s" : "o"}`;
});
const CLASS_INDEX = new Map(CLASS_NAMES.map((name, i) => [name, i]));

/** The conditioned chart for a hand-sharing team: the actor's strategy at
 *  this node GIVEN the partner's hand class. freq carries the first
 *  num_actions-1 frequencies; the last is one minus the rest. When the
 *  payload carries conditioned EVs (`ev`, per cell per action, TEAM chips -
 *  own plus partner), they land in the tooltip; older payloads simply have
 *  no EVs here. */
export const conditionedGridFor = (
  node: DumpNode,
  rollup: { num_actions: number; freq: number[][][]; ev?: (number | null)[][][] },
  partnerClass: number
): HandCellData[] => {
  const labels = actionLabels(node);
  const prow = rollup.freq[partnerClass] ?? [];
  const erow = rollup.ev?.[partnerClass];
  return HAND_ORDER.map((hand) => {
    const oc = CLASS_INDEX.get(hand);
    const fr = oc != null ? prow[oc] ?? [] : [];
    const ev = oc != null ? erow?.[oc] : undefined;
    const actions: Record<string, number> = {};
    const evs: Record<string, number> = {};
    let sum = 0;
    labels.forEach((label, i) => {
      if (i < labels.length - 1) {
        const v = fr[i] ?? 0;
        actions[label] = v;
        sum += v;
      }
      const e = ev?.[i];
      if (e != null) evs[label] = e;
    });
    if (labels.length > 0) {
      actions[labels[labels.length - 1]] =
        labels.length === 1 ? fr[0] ?? 1 : Math.max(0, 1 - sum);
    }
    return { hand, actions, evs };
  });
};

export const actionLabels = (node: DumpNode): string[] =>
  node.num_children === 2 ? ["Fold", "ALLIN"] : ["ALLIN"];

/** The node's 169-class chart, in the shape DecisionMatrix consumes. */
export const gridFor = (node: DumpNode): HandCellData[] => {
  const rollup = node.data?.rollup_169 ?? [];
  const labels = actionLabels(node);
  const byClass = new Map(rollup.map((r) => [r.class, r]));
  return HAND_ORDER.map((hand) => {
    const entry = byClass.get(hand);
    const actions: Record<string, number> = {};
    const evs: Record<string, number> = {};
    labels.forEach((label, i) => {
      actions[label] = entry?.freq[i] ?? 0;
      if (entry) evs[label] = entry.ev;
    });
    return { hand, actions, evs };
  });
};

/** Combos taking `action` as a percent of the 1326, weighting each class by
 *  how many combos it has. This is the number push/fold charts are quoted
 *  in, so it is what the panel shows beside each grid. */
export const actionPct = (node: DumpNode, action: string): number => {
  const labels = actionLabels(node);
  const index = labels.indexOf(action);
  if (index < 0) return 0;
  const byClass = new Map((node.data?.rollup_169 ?? []).map((r) => [r.class, r]));
  let taken = 0;
  HAND_ORDER.forEach((hand) => {
    const combos = hand.length === 2 ? 6 : hand.endsWith("s") ? 4 : 12;
    taken += combos * (byClass.get(hand)?.freq[index] ?? 0);
  });
  return (taken / 1326) * 100;
};

export interface LineStep {
  /** The node the action was taken at. */
  node: DumpNode;
  /** Which child it leads to. */
  child: number;
  label: string;
  seat: number;
}

/** Walk from the root down a chosen path, collecting the decision nodes met
 *  along the way. Returns the steps taken plus wherever the path ended -
 *  which may be a terminal, since folding everyone out ends the hand. */
export const walkLine = (dump: PushFoldDump, path: number[]) => {
  const steps: LineStep[] = [];
  let node = dump.nodes["0"];
  for (const choice of path) {
    if (!node || node.kind !== "decision" || node.first_child == null) break;
    const labels = actionLabels(node);
    const child = node.first_child + choice;
    steps.push({ node, child, label: labels[choice] ?? "?", seat: node.actor ?? -1 });
    node = dump.nodes[String(child)];
  }
  return { steps, node };
};
