#include <doctest/doctest.h>

#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"

using namespace engine;

namespace {

SolveConfig turn_config(const std::string& board, const std::string& range, bool iso) {
  SolveConfig config;
  config.game = "nlhe";
  config.board = board;
  config.pot = 100;
  config.isomorphism = iso;
  config.players = {{"OOP", 200, range}, {"IP", 200, range}};
  config.turn_sizing.oop.bets = {75.0};
  config.turn_sizing.ip.bets = {75.0};
  config.turn_sizing.oop.raises = {100.0};
  config.turn_sizing.ip.raises = {100.0};
  config.turn_sizing.max_raises = 1;
  config.river_sizing = config.turn_sizing;
  return config;
}

RecalcConfig recalc_off() {
  RecalcConfig r;
  r.enabled = false;
  return r;
}

BrResult solve(const Game& game, CfrSolver& solver, int checkpoints, int step) {
  BrResult br;
  for (int i = 0; i < checkpoints; ++i) {
    solver.run(step);
    br = compute_best_response(game, solver);
    solver.set_recalc_budget(br.nashconv() / game.num_seats());
  }
  return br;
}

}  // namespace

TEST_CASE("iso collapses runouts exactly where suit symmetry allows") {
  // Ah Kh 7c 2c: hearts and clubs are pinned by the board, diamonds and
  // spades are absent and interchangeable - one usable permutation, so the
  // 12 diamond runouts pair with the 12 spade runouts at every chance node.
  const NlhePostflopGame symmetric(turn_config("Ah Kh 7c 2c", "AA,KK,QQ,JJ,TT,99,88", true));
  CHECK(symmetric.iso_collapsed_children() > 0);

  // 6s Th Qd Td: three suits pinned by distinct board cards, the fourth can
  // only map to itself - no usable permutation, iso must be a no-op.
  const NlhePostflopGame pinned(turn_config("6s Th Qd Td", "AA,KK,QQ,JJ,TT,99,88", true));
  CHECK(pinned.iso_collapsed_children() == 0);

  // An explicit-combo token breaks the d<->s swap, so the whole feature
  // disables itself - correct fallback, no partial collapsing.
  const NlhePostflopGame broken(turn_config("Ah Kh 7c 2c", "AA,KK,QQ,AdQd", true));
  CHECK(broken.iso_collapsed_children() == 0);
}

TEST_CASE("a member node's strategy is its representative's, hands relabeled") {
  const NlhePostflopGame game(turn_config("Ah Kh 7c 2c", "AA,KK,QQ,JJ,TT,99,88", true));
  UpdateConfig update;
  CfrSolver solver(game, update, 1, recalc_off());
  solver.run(200);

  int checked = 0;
  const PublicTree& tree = game.tree();
  for (NodeId id = 0; id < tree.size(); ++id) {
    if (tree[id].kind != NodeKind::Decision) continue;
    const Game::IsoRef ref = game.iso_rep(id);
    if (ref.rep == id) continue;
    std::vector<float> member_rows, rep_rows;
    solver.average_strategy(id, member_rows);
    solver.average_strategy(ref.rep, rep_rows);
    const std::uint16_t actions = tree[id].num_children;
    const int hands = game.num_hands(tree[id].actor);
    REQUIRE(member_rows.size() == rep_rows.size());
    for (int h = 0; h < hands; ++h) {
      const std::uint16_t g = (*ref.map)[static_cast<std::size_t>(h)];
      for (std::uint16_t k = 0; k < actions; ++k) {
        CHECK(member_rows[static_cast<std::size_t>(h) * actions + k] ==
              rep_rows[static_cast<std::size_t>(g) * actions + k]);
      }
    }
    ++checked;
    if (checked >= 20) break;  // a sample is plenty; the loop is O(nodes * hands)
  }
  CHECK(checked > 0);
}

TEST_CASE("iso-on solves the same game as iso-off") {
  // Different algorithms (the quotient game vs the full game), so not
  // bitwise - but the 2p zero-sum game value is unique and both must
  // converge to it.
  const NlhePostflopGame off_game(turn_config("Ah Kh 7c 2c", "AA,KK,QQ,JJ,TT,99,88,AKs", false));
  const NlhePostflopGame on_game(turn_config("Ah Kh 7c 2c", "AA,KK,QQ,JJ,TT,99,88,AKs", true));
  UpdateConfig update;
  CfrSolver off(off_game, update, 1, recalc_off());
  CfrSolver on(on_game, update, 1, recalc_off());
  const BrResult br_off = solve(off_game, off, 10, 200);
  const BrResult br_on = solve(on_game, on, 10, 200);

  CHECK(br_off.nashconv() < 0.5);
  CHECK(br_on.nashconv() < 0.5);
  CHECK(std::abs(br_on.ev[0] - br_off.ev[0]) < 1.0);
  CHECK(std::abs(br_on.ev[1] - br_off.ev[1]) < 1.0);
}

TEST_CASE("iso with no usable permutation is bitwise identical to iso-off") {
  const NlhePostflopGame off_game(turn_config("6s Th Qd Td", "AA,KK,QQ,JJ,TT", false));
  const NlhePostflopGame on_game(turn_config("6s Th Qd Td", "AA,KK,QQ,JJ,TT", true));
  UpdateConfig update;
  CfrSolver off(off_game, update, 1, recalc_off());
  CfrSolver on(on_game, update, 1, recalc_off());
  off.run(150);
  on.run(150);

  std::vector<float> a, b;
  int compared = 0;
  for (NodeId id = 0; id < off_game.tree().size(); ++id) {
    if (off_game.tree()[id].kind != NodeKind::Decision) continue;
    off.average_strategy(id, a);
    on.average_strategy(id, b);
    CHECK(a == b);
    ++compared;
  }
  CHECK(compared > 0);
}

TEST_CASE("iso composes with the recalc schedule and threading") {
  const NlhePostflopGame game(turn_config("Ah Kh 7c 2c", "AA,KK,QQ,JJ,TT,99,88", true));
  UpdateConfig update;
  CfrSolver serial(game, update, 1);
  CfrSolver parallel(game, update, 8);
  solve(game, serial, 6, 100);
  solve(game, parallel, 6, 100);
  CHECK(serial.recalc_skips() == parallel.recalc_skips());

  std::vector<float> a, b;
  int compared = 0;
  for (NodeId id = 0; id < game.tree().size(); ++id) {
    if (game.tree()[id].kind != NodeKind::Decision) continue;
    serial.average_strategy(id, a);
    parallel.average_strategy(id, b);
    CHECK(a == b);
    ++compared;
  }
  CHECK(compared > 0);
}
