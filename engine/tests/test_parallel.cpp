#include <doctest/doctest.h>

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <numeric>
#include <stdexcept>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "game/toy/leduc.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"
#include "util/parallel.hpp"

using namespace engine;

namespace {

// Bitwise equality, not Approx: multithreading is supposed to change WHEN
// the arithmetic happens, never the arithmetic. Sibling subtrees write
// disjoint regret ranges and every cross-child fold-back stays in child
// order, so any drift here is a real bug rather than rounding.
void check_identical_solutions(const Game& game, std::uint64_t iterations) {
  UpdateConfig update;  // DCFR defaults
  CfrSolver serial(game, update, 1);
  CfrSolver parallel(game, update, 8);
  REQUIRE(parallel.pool().threads() > 1);
  serial.run(iterations);
  parallel.run(iterations);

  std::vector<float> a, b;
  int compared = 0;
  for (const Node& node : game.tree().nodes) {
    if (node.kind != NodeKind::Decision) continue;
    const NodeId id = static_cast<NodeId>(&node - game.tree().nodes.data());
    serial.average_strategy(id, a);
    parallel.average_strategy(id, b);
    REQUIRE(a.size() == b.size());
    CHECK(a == b);
    serial.current_strategy(id, a);
    parallel.current_strategy(id, b);
    CHECK(a == b);
    ++compared;
  }
  CHECK(compared > 0);

  const BrResult br_serial = compute_best_response(game, serial);
  const BrResult br_parallel = compute_best_response(game, parallel);
  CHECK(br_serial.ev == br_parallel.ev);
  CHECK(br_serial.br_value == br_parallel.br_value);
}

std::unique_ptr<NlhePostflopGame> tiny_turn_game() {
  SolveConfig config;
  config.game = "nlhe";
  config.board = "Qs Jh 2h 8d";
  config.pot = 100;
  config.players = {{"OOP", 200, "AA,KK,QQ,AKs"}, {"IP", 200, "JJ,TT,AQs,KQs"}};
  config.turn_sizing.oop.bets = {75.0};
  config.turn_sizing.ip.bets = {75.0};
  config.turn_sizing.max_raises = 0;
  config.river_sizing.oop.bets = {75.0};
  config.river_sizing.ip.bets = {75.0};
  config.river_sizing.max_raises = 0;
  return std::make_unique<NlhePostflopGame>(config);
}

}  // namespace

TEST_CASE("thread pool runs every task exactly once") {
  ThreadPool pool(4);
  constexpr int kTasks = 5000;
  std::vector<int> hits(kTasks, 0);
  pool.parallel_for(kTasks, [&](int i) { hits[static_cast<std::size_t>(i)] += 1; });
  CHECK(std::accumulate(hits.begin(), hits.end(), 0) == kTasks);
  for (int h : hits) CHECK(h == 1);
}

TEST_CASE("thread pool tolerates nesting deeper than its worker count") {
  // A pool whose workers are all inside outer tasks must still make progress
  // on the inner batches: parallel_for helps rather than blocks.
  ThreadPool pool(2);
  std::atomic<int> total{0};
  pool.parallel_for(8, [&](int) {
    pool.parallel_for(8, [&](int) {
      pool.parallel_for(8, [&](int) { total.fetch_add(1); });
    });
  });
  CHECK(total.load() == 8 * 8 * 8);
}

TEST_CASE("thread pool rethrows a task exception on the calling thread") {
  ThreadPool pool(4);
  CHECK_THROWS_AS(pool.parallel_for(64,
                                    [](int i) {
                                      if (i == 17) throw std::runtime_error("boom");
                                    }),
                  std::runtime_error);
  // The pool survives a thrown task and keeps serving batches.
  std::atomic<int> total{0};
  pool.parallel_for(32, [&](int) { total.fetch_add(1); });
  CHECK(total.load() == 32);
}

TEST_CASE("resolve_thread_count follows the config convention") {
  CHECK(resolve_thread_count(6) == 6);
  CHECK(resolve_thread_count(0) >= 1);
  CHECK(resolve_thread_count(-1000) == 1);  // never below one worker
}

TEST_CASE("leduc solves identically on one thread and on eight") {
  toy::LeducGame game;
  check_identical_solutions(game, 300);
}

TEST_CASE("an nlhe turn tree solves identically on one thread and on eight") {
  // A turn board puts a 48-child chance node in the tree, which is the fork
  // point the flop/turn solves lean on.
  const auto game = tiny_turn_game();
  check_identical_solutions(*game, 20);
}
