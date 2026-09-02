// src/lib/sessionSim/compilePolicy.ts
//
// Turns a push/fold result payload into the flat tables the dealer walks.
// A payload carries everything a hand needs: the tree with each seat's
// commitment at every node, the frozen seats' 169-class strategies
// (rollup_169 - exact preflop, since no infoset can tell suits apart) and
// the team's conditioned 169x169 charts (team_rollup). Nothing here reads
// per-combo rows, which the rollup dump does not carry anyway.
import type { DumpNode, PushFoldDump } from "@/pages/multiway/pushfoldResult";
import { classIndexOfName } from "./cards";
import type { CompiledPolicy } from "./types";

const CLASSES = 169;

export interface CompileOptions {
  /** Seats to score. Defaults to the team's seats; required for a solve
   *  without a team, which is what the check script and a "no sharing"
   *  comparison would pass. */
  scoredSeats?: number[];
}

/** Identity of the SPOT a payload was solved for: seats, stacks, blinds,
 *  button and the tree's shape. Two solves can share a rotation only when
 *  these match - a rotation is one game with the team in different seats,
 *  and a stack or blind change would make the per-hand results different
 *  currencies. */
export function spotSignature(dump: PushFoldDump): string {
  const m = dump.metadata;
  const nodes = Object.keys(dump.nodes)
    .map(Number)
    .sort((a, b) => a - b)
    .map((id) => {
      const n = dump.nodes[String(id)];
      return `${id}:${n.kind[0]}${n.actor ?? "-"}:${n.num_children}:${n.commit.join(",")}:${n.pot}`;
    })
    .join("|");
  return JSON.stringify({
    seats: m.seats,
    stacks: m.stacks ?? null,
    preflop: m.preflop
      ? {
          button: m.preflop.button,
          sb: m.preflop.small_blind,
          bb: m.preflop.big_blind,
        }
      : null,
    pot: m.pot,
    chipScale: m.chip_scale,
    tree: nodes,
  });
}

const pairingLabel = (labels: string[], seats: number[]): string =>
  seats.map((s) => labels[s] ?? `P${s}`).join("+");

/** Throws with an actionable message when the payload cannot be played. */
export function compilePolicy(dump: PushFoldDump, options: CompileOptions = {}): CompiledPolicy {
  const meta = dump.metadata;
  const seats = meta.seats?.length ?? 0;
  if (seats < 2) throw new Error("The result does not record its seats.");
  if (!(meta.chip_scale > 0)) throw new Error("The result has no big blind size (chip_scale).");

  const team = meta.team && meta.team.seats.length === 2 ? meta.team : null;
  const scoredSeats = options.scoredSeats ?? team?.seats ?? null;
  if (!scoredSeats) {
    throw new Error(
      "Not a hand-sharing team solve. A rotation is built from team solves of one spot."
    );
  }
  if (team && !meta.team_rollup) {
    throw new Error(
      "This payload predates the conditioned team charts. Re-solve it at the same " +
        "iterations to get a payload the simulator can play."
    );
  }

  const ids = Object.keys(dump.nodes).map(Number);
  const nodeCount = Math.max(...ids) + 1;
  let rootId = -1;
  const kind = new Uint8Array(nodeCount);
  const actor = new Int16Array(nodeCount).fill(-1);
  const numChildren = new Uint8Array(nodeCount);
  const firstChild = new Int32Array(nodeCount).fill(-1);
  const foldWinner = new Int16Array(nodeCount).fill(-1);
  const pot = new Float64Array(nodeCount);
  const commit = new Float64Array(nodeCount * seats);
  const policyKind = new Uint8Array(nodeCount);
  const policyOffset = new Int32Array(nodeCount).fill(-1);
  const partner = new Int16Array(nodeCount).fill(-1);
  const blocks: Float32Array[] = [];
  let tableSize = 0;
  let fallbackCells = 0;

  const marginalRow = (node: DumpNode, id: number): Float32Array => {
    const row = new Float32Array(CLASSES).fill(0.5);
    const rollup = node.data?.rollup_169;
    if (!rollup) throw new Error(`Decision node ${id} carries no 169-class chart.`);
    for (const entry of rollup) {
      const cls = classIndexOfName(entry.class);
      if (cls < 0) continue;
      // Two children: [Fold, ALLIN]. A single child is forced and handled
      // as its own policy kind, so a 1-entry freq never reaches here.
      row[cls] = entry.freq.length >= 2 ? entry.freq[0] : 0;
    }
    return row;
  };

  for (const id of ids) {
    const n = dump.nodes[String(id)];
    if (n.parent_id === null) rootId = id;
    pot[id] = n.pot;
    for (let s = 0; s < seats; s++) commit[id * seats + s] = n.commit[s] ?? 0;
    if (n.kind === "decision") {
      kind[id] = 0;
      actor[id] = n.actor ?? -1;
      numChildren[id] = n.num_children;
      firstChild[id] = n.first_child ?? -1;
      if (n.num_children === 1) {
        policyKind[id] = 2;
        continue;
      }
      if (n.num_children !== 2) {
        throw new Error(`Decision node ${id} has ${n.num_children} actions; only jam/fold trees play.`);
      }
      const marginal = marginalRow(n, id);
      const conditioned = team ? meta.team_rollup?.[String(id)] : undefined;
      if (conditioned && team && team.seats.includes(n.actor ?? -1)) {
        // Conditioned on the partner's class. The chart stores the first
        // num_actions-1 actions (Fold); a cell with no data - a conditioning
        // the partner never arrives with - falls back to the marginal row,
        // which is what the page shows for it too.
        policyKind[id] = 1;
        partner[id] = conditioned.partner;
        const block = new Float32Array(CLASSES * CLASSES);
        for (let pc = 0; pc < CLASSES; pc++) {
          const prow = conditioned.freq[pc];
          for (let oc = 0; oc < CLASSES; oc++) {
            const v = prow?.[oc]?.[0];
            if (typeof v === "number" && Number.isFinite(v)) {
              block[pc * CLASSES + oc] = Math.min(1, Math.max(0, v));
            } else {
              block[pc * CLASSES + oc] = marginal[oc];
              fallbackCells++;
            }
          }
        }
        policyOffset[id] = tableSize;
        blocks.push(block);
        tableSize += block.length;
      } else {
        policyKind[id] = 0;
        policyOffset[id] = tableSize;
        blocks.push(marginal);
        tableSize += marginal.length;
      }
    } else if (n.kind === "terminal") {
      if (n.terminal === "fold") {
        kind[id] = 1;
        foldWinner[id] = n.fold_winner ?? -1;
      } else {
        kind[id] = 2;
      }
    } else {
      throw new Error(`Node ${id} is a ${n.kind} node; a preflop jam/fold tree has none.`);
    }
  }
  if (rootId < 0) throw new Error("The tree has no root.");

  const table = new Float32Array(tableSize);
  let at = 0;
  for (const block of blocks) {
    table.set(block, at);
    at += block.length;
  }

  const labels = meta.seats;
  const artifactEvChips = team
    ? team.ev_chips
    : scoredSeats.reduce((acc, s) => acc + (meta.ev_chips?.[s] ?? 0), 0);

  return {
    seats,
    chipScale: meta.chip_scale,
    rootId,
    nodeCount,
    kind,
    actor,
    numChildren,
    firstChild,
    foldWinner,
    pot,
    commit,
    policyKind,
    policyOffset,
    partner,
    table,
    scoredSeats: [...scoredSeats],
    teamSeats: team ? [team.seats[0], team.seats[1]] : null,
    meta: {
      solveId: meta.solve_id ?? "",
      iterations: meta.iterations,
      artifactEvChips,
      pairingLabel: pairingLabel(labels, scoredSeats),
      seatLabels: [...labels],
      fallbackCells,
    },
  };
}

export interface RotationCandidate {
  label: string;
  policy: CompiledPolicy | null;
  signature: string | null;
  /** Why the entry could not be compiled, if it could not. */
  error?: string;
  loading?: boolean;
}

/** Everything that would make a rotation meaningless, in words. Empty when
 *  it can run. */
export function validateRotation(entries: RotationCandidate[]): string[] {
  const issues: string[] = [];
  if (entries.length === 0) {
    issues.push("Add at least one team solve to the rotation.");
    return issues;
  }
  let reference: RotationCandidate | null = null;
  entries.forEach((e, i) => {
    const where = `Entry ${i + 1} (${e.label})`;
    if (e.loading) {
      issues.push(`${where} is still loading.`);
      return;
    }
    if (e.error || !e.policy || !e.signature) {
      issues.push(`${where}: ${e.error ?? "could not be read."}`);
      return;
    }
    if (!e.policy.teamSeats) {
      issues.push(`${where} is not a hand-sharing team solve.`);
      return;
    }
    if (!reference) {
      reference = e;
      return;
    }
    if (e.signature !== reference.signature) {
      issues.push(
        `${where} is a different spot from entry 1 (${reference.label}): a rotation is ` +
          "one spot with the team in different seats."
      );
    }
  });
  return issues;
}
