#include <doctest/doctest.h>

#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "game/toy/leduc.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"

using namespace engine;

namespace {

// A turn tree with real chance nodes (the recalc schedule only acts there)
// but small enough to iterate thousands of times in a test.
std::unique_ptr<NlhePostflopGame> turn_game() {
  SolveConfig config;
  config.game = "nlhe";
  config.board = "Qs Jh 2h 8d";
  config.pot = 100;
  config.players = {{"OOP", 200, "AA,KK,QQ,AKs,A5s,KQs,76s"},
                    {"IP", 200, "JJ,TT,99,AQs,KQs,T9s"}};
  config.turn_sizing.oop.bets = {75.0};
  config.turn_sizing.ip.bets = {75.0};
  config.turn_sizing.max_raises = 1;
  config.turn_sizing.oop.raises = {100.0};
  config.turn_sizing.ip.raises = {100.0};
  config.river_sizing = config.turn_sizing;
  return std::make_unique<NlhePostflopGame>(config);
}

RecalcConfig recalc_off() {
  RecalcConfig r;
  r.enabled = false;
  return r;
}

// The solve loop the way main.cpp runs it: checkpoint, measure, feed the
// exploitability back to the recalc schedule as its annealing budget.
BrResult run_with_checkpoints(const Game& game, CfrSolver& solver, int checkpoints,
                              int step) {
  BrResult br;
  for (int i = 0; i < checkpoints; ++i) {
    solver.run(step);
    br = compute_best_response(game, solver);
    solver.set_recalc_budget(br.nashconv() / game.num_seats());
  }
  return br;
}

}  // namespace

TEST_CASE("recalc actually skips subtrees, and off means off") {
  const auto game = turn_game();
  UpdateConfig update;

  CfrSolver off(*game, update, 1, recalc_off());
  run_with_checkpoints(*game, off, 8, 50);
  CHECK(off.recalc_skips() == 0);

  CfrSolver on(*game, update, 1);  // defaults: enabled, warmup 32
  // Without a budget the schedule must never engage - a caller that never
  // checkpoints gets plain CFR.
  on.run(100);
  CHECK(on.recalc_skips() == 0);
  run_with_checkpoints(*game, on, 8, 50);
  // If this is 0 the schedule never engaged and every other assertion in
  // this file is vacuous.
  CHECK(on.recalc_skips() > 0);
}

TEST_CASE("recalc-on still converges and lands near the exact solve") {
  const auto game = turn_game();
  UpdateConfig update;

  CfrSolver off(*game, update, 1, recalc_off());
  CfrSolver on(*game, update, 1);
  const BrResult br_off = run_with_checkpoints(*game, off, 10, 200);
  const BrResult br_on = run_with_checkpoints(*game, on, 10, 200);

  // Both are honest full-tree measurements of their own average strategy.
  // The approximation must not stall convergence...
  CHECK(br_on.nashconv() < 0.5);  // chips; pot is 100
  CHECK(br_off.nashconv() < 0.5);
  // ...and the two solves must agree on the game value (unique in 2p
  // zero-sum) to well within the convergence tolerance.
  CHECK(std::abs(br_on.ev[0] - br_off.ev[0]) < 1.0);
  CHECK(std::abs(br_on.ev[1] - br_off.ev[1]) < 1.0);
}

TEST_CASE("recalc-on leduc still converges") {
  toy::LeducGame game;
  UpdateConfig update;
  CfrSolver solver(game, update, 1);
  const BrResult br = run_with_checkpoints(game, solver, 10, 500);
  CHECK(br.nashconv() < 0.02);  // antes are 1 chip each
  CHECK(br.ev[0] + br.ev[1] == doctest::Approx(2.0).epsilon(1e-6));
}

TEST_CASE("recalc schedule is identical on one thread and on eight") {
  // The schedule's triggers are functions of traversal values that are
  // bit-identical at any thread count, so the whole solve - skips included -
  // must be too. This is the invariant that lets recalc stay ON by default
  // without weakening the threading guarantee.
  const auto game = turn_game();
  UpdateConfig update;
  CfrSolver serial(*game, update, 1);
  CfrSolver parallel(*game, update, 8);
  run_with_checkpoints(*game, serial, 6, 100);
  run_with_checkpoints(*game, parallel, 6, 100);
  CHECK(serial.recalc_skips() > 0);  // schedule engaged, so the check bites
  CHECK(serial.recalc_skips() == parallel.recalc_skips());

  std::vector<float> a, b;
  int compared = 0;
  for (const Node& node : game->tree().nodes) {
    if (node.kind != NodeKind::Decision) continue;
    const NodeId id = static_cast<NodeId>(&node - game->tree().nodes.data());
    serial.average_strategy(id, a);
    parallel.average_strategy(id, b);
    REQUIRE(a.size() == b.size());
    CHECK(a == b);
    ++compared;
  }
  CHECK(compared > 0);
}
