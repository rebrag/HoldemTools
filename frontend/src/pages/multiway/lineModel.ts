// src/pages/multiway/lineModel.ts
//
// The bridge between a push/fold payload and the solver's shared surfaces:
// the Line strip, the Plate, and the PokerTable. All three speak the
// /solutions vocabulary (a JsonData per seat keyed by a "file", positions in
// acting order, bets in big blinds), so a dump is translated into it here
// rather than teaching each component a second schema.
//
// Everything is in BIG BLINDS on the way out. Plate and DecisionMatrix format
// their numbers with `fmtMoney(x, money)`, which prints "<n> bb" when no
// money display is given, and the Line prints stacks raw - so chips would
// read as blinds. The one exception is the table's chip graphics
// (`committedAmount`, `potAmount`), which want real chip counts to draw the
// right stacks; their labels are in bb like everything else.
//
// React-free so `scripts/check-line-model-entry.ts` can drive it in Node.
import type { HandData, JsonData } from "@/lib/solver/utils";
import type { PokerTableSeatData } from "@/components/PokerTableSeat";
import { indexLineBySeat } from "@/pages/solver/seatNavigation";
import { fmtBB } from "@/pages/solver/boardDisplay";
import {
  actionLabels,
  type ActionLabeller,
  CLASS_NAMES,
  walkLine,
  type DumpNode,
  type LineStep,
  type PushFoldDump,
} from "./pushfoldResult";

/* ---------- files: the Line and the Plate address a seat by "file" ---------- */

export const SEAT_FILE_PREFIX = "seat:";
export const fileForSeat = (seat: number): string => `${SEAT_FILE_PREFIX}${seat}`;
export const seatOfFile = (file: string): number | null => {
  if (!file.startsWith(SEAT_FILE_PREFIX)) return null;
  const n = Number(file.slice(SEAT_FILE_PREFIX.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/* ---------- units ---------- */

/** Chips per big blind. A payload without a usable scale reads as chips. */
export const chipScale = (dump: PushFoldDump): number =>
  dump.metadata.chip_scale > 0 ? dump.metadata.chip_scale : 1;

export const fmtBb = (bb: number): string => `${fmtBB(bb, 1)} bb`;

/* ---------- tree walking ---------- */

const rootOf = (dump: PushFoldDump): DumpNode | undefined => dump.nodes["0"];

const childOf = (dump: PushFoldDump, node: DumpNode, choice: number): DumpNode | undefined =>
  node.first_child == null ? undefined : dump.nodes[String(node.first_child + choice)];

const isDecision = (node: DumpNode | null | undefined): node is DumpNode =>
  !!node && node.kind === "decision";

const foldIndex = (node: DumpNode, labelsFor: ActionLabeller): number =>
  labelsFor(node).indexOf("Fold");

/** Seat labels, made unique defensively: the tables key seats by label. */
export const seatLabelsOf = (dump: PushFoldDump): string[] => {
  const seen = new Map<string, number>();
  return (dump.metadata.seats ?? []).map((label, i) => {
    const n = seen.get(label) ?? 0;
    seen.set(label, n + 1);
    return n === 0 ? label : `${label}#${i}`;
  });
};

/** Seats in the order they act. The artifact says so directly; a payload
 *  from before it did is read off the tree's all-fold line, with the seat
 *  that never gets a decision there (the big blind) last. */
export const actingOrder = (dump: PushFoldDump): number[] => {
  const n = dump.metadata.seats?.length ?? 0;
  const declared = dump.metadata.preflop?.action_order;
  if (
    declared &&
    declared.length === n &&
    new Set(declared).size === n &&
    declared.every((s) => Number.isInteger(s) && s >= 0 && s < n)
  ) {
    return [...declared];
  }
  const order: number[] = [];
  let node = rootOf(dump);
  while (isDecision(node)) {
    if (node.actor != null && !order.includes(node.actor)) order.push(node.actor);
    node = childOf(dump, node, 0);
  }
  for (let i = 0; i < n; i += 1) if (!order.includes(i)) order.push(i);
  return order;
};

/** From `start`, fold every seat in front of `seat` until it is the one to
 *  act. Null when that never happens: a seat on the way can only jam, or the
 *  line ends first (it folded to the big blind, who has no decision). */
export const foldForward = (
  dump: PushFoldDump,
  start: DumpNode | undefined,
  seat: number,
  labelsFor: ActionLabeller = actionLabels
): { path: number[]; node: DumpNode } | null => {
  const path: number[] = [];
  let node = start;
  while (isDecision(node)) {
    if (node.actor === seat) return { path, node };
    const fold = foldIndex(node, labelsFor);
    if (fold < 0) return null;
    path.push(fold);
    node = childOf(dump, node, fold);
  }
  return null;
};

/** The path that puts `seat` on the spot: rewound to just before its
 *  decision if it has already acted, else extended by folding everyone
 *  between the current actor and it. Null when it cannot be reached. */
export const pathToSeatDecision = (
  dump: PushFoldDump,
  path: number[],
  seat: number,
  labelsFor: ActionLabeller = actionLabels
): number[] | null => {
  const { steps, node } = walkLine(dump, path, labelsFor);
  const i = steps.findIndex((s) => s.seat === seat);
  if (i >= 0) return path.slice(0, i);
  const forward = foldForward(dump, node, seat, labelsFor);
  return forward ? [...path, ...forward.path] : null;
};

/** The node `seat` decides at along this line (see pathToSeatDecision). */
export const nodeForSeat = (
  dump: PushFoldDump,
  path: number[],
  seat: number,
  labelsFor: ActionLabeller = actionLabels
): DumpNode | null => {
  const { steps, node } = walkLine(dump, path, labelsFor);
  const hit = steps.find((s) => s.seat === seat);
  if (hit) return hit.node;
  return foldForward(dump, node, seat, labelsFor)?.node ?? null;
};

/** `seat` takes `label`, wherever that seat's decision is relative to the
 *  current line. Null when the seat is unreachable or has no such option. */
export const pathWithSeatAction = (
  dump: PushFoldDump,
  path: number[],
  seat: number,
  label: string,
  labelsFor: ActionLabeller = actionLabels
): number[] | null => {
  const base = pathToSeatDecision(dump, path, seat, labelsFor);
  if (!base) return null;
  const { node } = walkLine(dump, base, labelsFor);
  if (!isDecision(node)) return null;
  const choice = labelsFor(node).indexOf(label);
  return choice < 0 ? null : [...base, choice];
};

/** Everyone folds to `seat`. Null for the seat nobody can fold to. */
export const pathFoldingTo = (dump: PushFoldDump, seat: number): number[] | null =>
  pathToSeatDecision(dump, [], seat);

export const foldToNode = (
  dump: PushFoldDump,
  seat: number
): { path: number[]; node: DumpNode } | null => foldForward(dump, rootOf(dump), seat);

export const rewindTo = (path: number[], count: number): number[] => path.slice(0, count);

/* ---------- JsonData: what Plate and Line read ---------- */

const baseJson = (dump: PushFoldDump, seat: number): JsonData => ({
  Position: seatLabelsOf(dump)[seat] ?? `P${seat}`,
  bb: (dump.metadata.stacks?.[seat] ?? 0) / chipScale(dump),
});

/** The seat's chart at `node` in the shape the solver's plates consume. A
 *  null node (the big blind on the all-fold line) yields position and stack
 *  only, so its Line card shows no options and its plate no matrix. */
export const jsonDataFor = (
  dump: PushFoldDump,
  node: DumpNode | null,
  seat: number,
  labelsFor: ActionLabeller = actionLabels
): JsonData => {
  const data = baseJson(dump, seat);
  if (!isDecision(node)) return data;
  const scale = chipScale(dump);
  const rollup = node.data?.rollup_169 ?? [];
  labelsFor(node).forEach((label, i) => {
    const hands: HandData = {};
    for (const entry of rollup) {
      // Per-action EV where the payload has it; the class EV is one number
      // for every action and only ever said what the mix was worth.
      const ev = entry.action_ev?.[i] ?? entry.ev;
      hands[entry.class] = [entry.freq[i] ?? 0, ev / scale];
    }
    data[label] = hands;
  });
  return data;
};

/** The hand-sharing team's conditioned chart: the actor's strategy at this
 *  node GIVEN the partner's hand class, as a JsonData. The same arithmetic as
 *  `conditionedGridFor` in pushfoldResult.ts, which builds the grid form for
 *  the single-solve matrix; keep the two in step. Missing conditioned EVs
 *  come out as NaN, which the matrix tooltip prints as N/A. */
export const conditionedJsonDataFor = (
  dump: PushFoldDump,
  node: DumpNode,
  rollup: { num_actions: number; freq: number[][][]; ev?: (number | null)[][][] },
  partnerClass: number,
  seat: number
): JsonData => {
  const data = baseJson(dump, seat);
  if (!isDecision(node)) return data;
  const scale = chipScale(dump);
  const labels = actionLabels(node);
  const prow = rollup.freq[partnerClass] ?? [];
  const erow = rollup.ev?.[partnerClass];
  const perLabel: HandData[] = labels.map(() => ({}));
  CLASS_NAMES.forEach((hand, oc) => {
    const fr = prow[oc] ?? [];
    const ev = erow?.[oc];
    let sum = 0;
    labels.forEach((_, i) => {
      let weight: number;
      if (i < labels.length - 1) {
        weight = fr[i] ?? 0;
        sum += weight;
      } else {
        weight = labels.length === 1 ? fr[0] ?? 1 : Math.max(0, 1 - sum);
      }
      const e = ev?.[i];
      perLabel[i][hand] = [weight, e != null ? e / scale : NaN];
    });
  });
  labels.forEach((label, i) => {
    data[label] = perLabel[i];
  });
  return data;
};

/* ---------- the model behind the Line ---------- */

export interface LineModel {
  /** Seat labels in acting order - what Line calls `positions`. */
  positions: string[];
  seatOf: Record<string, number>;
  /** Label of the seat on the spot; "" at a terminal. */
  activePlayer: string;
  /** "Root" then the labels of the actions taken. */
  line: string[];
  /** Keyed by fileForSeat(i); big blinds throughout. */
  plateData: Record<string, JsonData>;
  plateMapping: Record<string, string>;
  /** Chips each seat has in at the current node, in bb. */
  playerBets: Record<string, number>;
  alivePlayers: Record<string, boolean>;
  /** Seat -> how many actions precede its first decision (rewind targets). */
  actionsBeforeSeat: Record<string, number>;
  node: DumpNode | undefined;
  steps: LineStep[];
  scale: number;
}

export const buildLineModel = (
  dump: PushFoldDump,
  path: number[],
  labelsFor: ActionLabeller = actionLabels
): LineModel => {
  const { steps, node } = walkLine(dump, path, labelsFor);
  const order = actingOrder(dump);
  const labels = seatLabelsOf(dump);
  const scale = chipScale(dump);
  const positions = order.map((i) => labels[i] ?? `P${i}`);
  const seatOf: Record<string, number> = {};
  const folded = new Set(steps.filter((s) => s.label === "Fold").map((s) => s.seat));
  const commit = node?.commit ?? rootOf(dump)?.commit ?? [];
  const plateData: Record<string, JsonData> = {};
  const plateMapping: Record<string, string> = {};
  const playerBets: Record<string, number> = {};
  const alivePlayers: Record<string, boolean> = {};
  order.forEach((seat, k) => {
    const label = positions[k];
    const file = fileForSeat(seat);
    seatOf[label] = seat;
    plateMapping[label] = file;
    // A seat still to act shows the options of the node it would decide at
    // if everyone in front of it folded - so every card has something on it.
    plateData[file] = jsonDataFor(dump, nodeForSeat(dump, path, seat, labelsFor), seat, labelsFor);
    playerBets[label] = (commit[seat] ?? 0) / scale;
    alivePlayers[label] = !folded.has(seat);
  });
  const activePlayer =
    isDecision(node) && node.actor != null ? labels[node.actor] ?? `P${node.actor}` : "";
  const line = ["Root", ...steps.map((s) => s.label)];
  const { actionsBeforeSeat } = indexLineBySeat(line, positions);
  return {
    positions,
    seatOf,
    activePlayer,
    line,
    plateData,
    plateMapping,
    playerBets,
    alivePlayers,
    actionsBeforeSeat,
    node,
    steps,
    scale,
  };
};

export interface LineHandlers {
  onActionClick: (action: string, file: string) => void;
  onSkipToSeat: (pos: string) => void;
  onRewindTo: (count: number) => void;
}

/** The three callbacks Line wants, over a `setPath`. Each is a no-op when the
 *  tree has no such move, so a stale click never lands on a wrong node. */
export const lineHandlers = (
  dump: PushFoldDump,
  path: number[],
  setPath: (path: number[]) => void,
  seatOf: Record<string, number>,
  labelsFor: ActionLabeller = actionLabels
): LineHandlers => ({
  onActionClick: (action, file) => {
    const seat = seatOfFile(file);
    if (seat == null) return;
    const next = pathWithSeatAction(dump, path, seat, action, labelsFor);
    if (next) setPath(next);
  },
  onSkipToSeat: (pos) => {
    const seat = seatOf[pos];
    if (seat == null) return;
    const next = pathToSeatDecision(dump, path, seat, labelsFor);
    if (next) setPath(next);
  },
  onRewindTo: (count) => setPath(rewindTo(path, count)),
});

/* ---------- the table ---------- */

export interface TableModel {
  size: number;
  seats: PokerTableSeatData[];
  /** Chips, for the chip graphics. */
  potAmount: number;
  potLabel: string;
  node: DumpNode | undefined;
}

/** The table as the solve stands at `path`: who is on the spot, what each
 *  seat has in front of it, who has folded. Seat keys are the labels, which
 *  is what the solver's seat navigation resolves by. */
export const tableSeatsFor = (dump: PushFoldDump, path: number[]): TableModel => {
  const { steps, node } = walkLine(dump, path);
  const meta = dump.metadata;
  const labels = seatLabelsOf(dump);
  const scale = chipScale(dump);
  const stacks = meta.stacks;
  const commit = node?.commit ?? rootOf(dump)?.commit ?? [];
  const folded = new Set(steps.filter((s) => s.label === "Fold").map((s) => s.seat));
  const hero = new Set(meta.team?.seats ?? []);
  const button = meta.preflop?.button;
  const seats: PokerTableSeatData[] = labels.map((label, i) => {
    const put = commit[i] ?? 0;
    return {
      key: label,
      label,
      stackText: stacks?.[i] != null ? fmtBb((stacks[i] - put) / scale) : undefined,
      committedAmount: put > 0 ? put : undefined,
      committedText: put > 0 ? fmtBb(put / scale) : undefined,
      isButton: button != null && i === button,
      isActive: isDecision(node) && node.actor === i,
      isHero: hero.has(i),
      folded: folded.has(i),
    };
  });
  const potAmount = node?.pot ?? meta.pot ?? 0;
  return {
    size: labels.length,
    seats,
    potAmount,
    potLabel: `Pot ${fmtBb(potAmount / scale)}`,
    node,
  };
};
