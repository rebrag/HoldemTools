// scripts/check-line-model-entry.ts
//
// The checks behind `npm run check:linemodel`: the /multiway line adapter
// (src/pages/multiway/lineModel.ts) against a synthetic three-seat jam/fold
// tree whose every path is known. Node-only (bundled by check-line-model.mjs);
// never imported by the app.
import assert from "node:assert/strict";
import { indexLineBySeat } from "@/pages/solver/seatNavigation";
import { CLASS_NAMES, type DumpNode, type PushFoldDump } from "@/pages/multiway/pushfoldResult";
import {
  actingOrder,
  buildLineModel,
  conditionedJsonDataFor,
  fileForSeat,
  jsonDataFor,
  pathFoldingTo,
  pathWithSeatAction,
  seatOfFile,
  tableSeatsFor,
} from "@/pages/multiway/lineModel";
import type { HandData } from "@/lib/solver/utils";

/** SB = seat 0, BB = seat 1, BTN = seat 2; button on 2; blinds 1/2; stacks
 *  20 chips at 2 chips per blind. BTN acts first, then SB, then BB. Every
 *  decision is fold-or-jam; it folding to the BB is a terminal, so the BB has
 *  no node on the all-fold line - exactly the case the adapter must handle. */
function syntheticDump(): PushFoldDump {
  const order = [2, 0, 1];
  const stacks = [20, 20, 20];
  const rollup = CLASS_NAMES.map((cls) => ({
    class: cls,
    weight: 1,
    ev: 1,
    freq: [0.3, 0.7],
    action_ev: [0.5, 2],
  }));
  const nodes: Record<string, DumpNode> = {};
  let nextId = 1;
  const fill = (
    id: number,
    i: number,
    anyJam: boolean,
    commit: number[],
    parent: number | null,
    action_kind: DumpNode["action_kind"],
    action_amount: number
  ) => {
    const pot = commit.reduce((a, b) => a + b, 0);
    const base = {
      node_id: id,
      parent_id: parent,
      action_kind,
      action_amount,
      pot,
      commit,
      actor: null as number | null,
      num_children: 0,
      first_child: null as number | null,
    };
    if (i === order.length) {
      nodes[String(id)] = { ...base, kind: "terminal", terminal: anyJam ? "showdown" : "fold" };
      return;
    }
    if (!anyJam && i === order.length - 1) {
      nodes[String(id)] = { ...base, kind: "terminal", terminal: "fold", fold_winner: order[i] };
      return;
    }
    const actor = order[i];
    // Children ids are contiguous from first_child, so reserve both before
    // recursing into either.
    const first = nextId;
    nextId += 2;
    nodes[String(id)] = {
      ...base,
      kind: "decision",
      actor,
      num_children: 2,
      first_child: first,
      data: { num_actions: 2, rollup_169: rollup },
    };
    fill(first, i + 1, anyJam, commit, id, "fold", 0);
    const jam = [...commit];
    jam[actor] = stacks[actor];
    fill(first + 1, i + 1, true, jam, id, "bet", stacks[actor]);
  };
  fill(0, 0, false, [1, 2, 0], null, "root", 0);

  const cond = (v: number[]) => CLASS_NAMES.map(() => CLASS_NAMES.map(() => v));
  return {
    metadata: {
      seats: ["SB", "BB", "BTN"],
      stacks,
      ev_chips: [0, 0, 0],
      final_nashconv: null,
      iterations: 1,
      pot: 3,
      chip_scale: 2,
      multiway_no_nash_guarantee: true,
      solve_id: "synthetic-3",
      preflop: { button: 2, sb_seat: 0, bb_seat: 1, small_blind: 1, big_blind: 2, action_order: order },
      team: { seats: [0, 2], awareness: "unaware", ev_chips: 0, strategy_export: "" },
      team_rollup: {
        "0": {
          actor: 2,
          partner: 0,
          num_actions: 2,
          freq: cond([0.25]),
          ev: CLASS_NAMES.map(() => CLASS_NAMES.map(() => [1, null])),
        },
      },
    },
    nodes,
  };
}

const hands = (v: unknown): HandData => v as HandData;

export async function main(): Promise<number> {
  const started = Date.now();
  let checks = 0;
  const ok = (what: string) => {
    checks++;
    console.log(`  ok  ${what}`);
  };

  try {
    const dump = syntheticDump();

    assert.deepEqual(actingOrder(dump), [2, 0, 1]);
    assert.equal(seatOfFile(fileForSeat(2)), 2);
    assert.equal(seatOfFile("root.json"), null);
    ok("acting order comes from the artifact; seat files round-trip");

    const noOrder = { ...dump, metadata: { ...dump.metadata, preflop: undefined } };
    assert.deepEqual(actingOrder(noOrder), [2, 0, 1]);
    ok("acting order is read off the all-fold line when the artifact lacks it");

    const root = buildLineModel(dump, []);
    assert.deepEqual(root.positions, ["BTN", "SB", "BB"]);
    assert.equal(root.activePlayer, "BTN");
    assert.deepEqual(root.line, ["Root"]);
    const btn = root.plateData[fileForSeat(2)];
    assert.equal(btn.Position, "BTN");
    assert.equal(btn.bb, 10);
    assert.equal(Object.keys(hands(btn.Fold)).length, 169);
    assert.deepEqual(hands(btn.ALLIN).AA, [0.7, 1]);
    assert.deepEqual(hands(btn.Fold).AA, [0.3, 0.25]);
    const sb = root.plateData[fileForSeat(0)];
    assert.ok("Fold" in sb && "ALLIN" in sb, "an unreached seat shows the options of its fold-to node");
    const bb = root.plateData[fileForSeat(1)];
    assert.deepEqual(Object.keys(bb).sort(), ["Position", "bb"]);
    assert.deepEqual(root.playerBets, { BTN: 0, SB: 0.5, BB: 1 });
    assert.deepEqual(root.alivePlayers, { BTN: true, SB: true, BB: true });
    ok("root model: positions, options, stacks and bets in big blinds");

    assert.deepEqual(pathFoldingTo(dump, 2), []);
    assert.deepEqual(pathFoldingTo(dump, 0), [0]);
    assert.equal(pathFoldingTo(dump, 1), null);
    ok("folds-to paths, with none for the big blind");

    assert.deepEqual(pathWithSeatAction(dump, [], 0, "ALLIN"), [0, 1]);
    assert.deepEqual(pathWithSeatAction(dump, [1], 2, "Fold"), [0]);
    assert.deepEqual(pathWithSeatAction(dump, [1, 1], 1, "Fold"), [1, 1, 0]);
    assert.equal(pathWithSeatAction(dump, [], 1, "Fold"), null);
    assert.equal(pathWithSeatAction(dump, [], 2, "Call"), null);
    ok("seat actions skip ahead, rewind, and refuse what the tree lacks");

    const mid = buildLineModel(dump, [1, 0]);
    assert.equal(mid.activePlayer, "BB");
    assert.equal(mid.alivePlayers.SB, false);
    assert.deepEqual(mid.line, ["Root", "ALLIN", "Fold"]);
    assert.equal(mid.playerBets.BTN, 10);
    assert.deepEqual(indexLineBySeat(mid.line, mid.positions).actionsBeforeSeat, { BTN: 0, SB: 1 });
    assert.deepEqual(mid.actionsBeforeSeat, { BTN: 0, SB: 1 });
    ok("mid-line model agrees with the Line's own replay");

    const end = buildLineModel(dump, [0, 0]);
    assert.equal(end.activePlayer, "");
    assert.equal(end.node?.kind, "terminal");
    ok("a terminal has nobody on the spot");

    const table = tableSeatsFor(dump, [1, 0]);
    assert.equal(table.size, 3);
    const [tSb, tBb, tBtn] = table.seats;
    assert.equal(tBtn.key, "BTN");
    assert.equal(tBtn.committedAmount, 20);
    assert.equal(tBtn.committedText, "10 bb");
    assert.equal(tBtn.stackText, "0 bb");
    assert.equal(tBtn.isButton, true);
    assert.equal(tBtn.isHero, true);
    assert.equal(tSb.folded, true);
    assert.equal(tSb.isHero, true);
    assert.equal(tBb.isActive, true);
    assert.equal(tBb.isHero, false);
    assert.equal(table.potAmount, 23);
    assert.equal(table.potLabel, "Pot 11.5 bb");
    ok("table seats: bets, stacks, button, team, folds and the pot");

    const rollup = dump.metadata.team_rollup!["0"];
    const cond = conditionedJsonDataFor(dump, dump.nodes["0"], rollup, 0, 2);
    assert.equal(hands(cond.Fold).AA[0], 0.25);
    assert.equal(hands(cond.ALLIN).AA[0], 0.75);
    assert.equal(hands(cond.Fold).AA[1], 0.5);
    assert.ok(Number.isNaN(hands(cond.ALLIN).AA[1]));
    ok("conditioned charts mirror conditionedGridFor, with NaN for missing EVs");

    assert.deepEqual(Object.keys(jsonDataFor(dump, null, 1)).sort(), ["Position", "bb"]);
    ok("a seat without a node is position and stack only");

    console.log(`\n${checks} checks passed in ${Date.now() - started} ms.`);
    return 0;
  } catch (e) {
    console.error("\nFAILED:", e instanceof Error ? e.stack ?? e.message : e);
    return 1;
  }
}
