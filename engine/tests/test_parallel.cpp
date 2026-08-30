#include <doctest/doctest.h>

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <numeric>
#include <stdexcept>
#include <string>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "game/toy/leduc.hpp"
#include "io/artifact_reader.hpp"
#include "io/artifact_store.hpp"
#include "io/artifact_writer.hpp"
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

SolveConfig tiny_turn_config() {
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
  config.raw = nlohmann::json{{"game", "nlhe"}, {"board", "Qs Jh 2h 8d"}};
  return config;
}

std::unique_ptr<NlhePostflopGame> tiny_turn_game() {
  return std::make_unique<NlhePostflopGame>(tiny_turn_config());
}

// Write an artifact for a solver that ran on `threads`, and read every
// decision node back. The export forks sibling subtrees like the traversal
// does, so it needs the same proof.
std::vector<ArtifactNodeData> export_nodes(const Game& game, int threads,
                                           const std::string& tag) {
  CfrSolver solver(game, UpdateConfig{}, threads);
  REQUIRE(solver.pool().threads() == resolve_thread_count(threads));
  solver.run(20);

  SolveStats stats;
  stats.iterations = solver.iteration();
  stats.threads = threads;
  const std::string path =
      (std::filesystem::temp_directory_path() / ("engine_export_" + tag + ".hta")).string();
  LocalStore store;
  write_artifact(store, path, game, solver, tiny_turn_config(), stats);

  ArtifactReader reader(store, path);
  std::vector<ArtifactNodeData> out;
  for (std::uint32_t id : reader.decision_node_ids()) out.push_back(reader.read_node(id));
  return out;
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

TEST_CASE("the artifact export is identical on one thread and on eight") {
  // The export pass forks sibling subtrees onto the same pool the traversal
  // uses, so it inherits the same obligation: threading changes WHEN the
  // arithmetic happens, never the arithmetic. Bitwise, not Approx - every
  // cross-child accumulation in the export stays serial and in child order
  // precisely so this holds, and a tolerance here would hide the bug it is
  // meant to catch.
  //
  // A turn board is the shape that exercises it: the 48-child chance node is
  // where the export gets almost all of its parallelism.
  const auto game = tiny_turn_game();
  const std::vector<ArtifactNodeData> serial = export_nodes(*game, 1, "t1");
  const std::vector<ArtifactNodeData> parallel = export_nodes(*game, 8, "t8");

  REQUIRE(serial.size() == parallel.size());
  REQUIRE(serial.size() > 1);
  for (std::size_t n = 0; n < serial.size(); ++n) {
    const ArtifactNodeData& a = serial[n];
    const ArtifactNodeData& b = parallel[n];
    REQUIRE(a.num_seats == b.num_seats);
    REQUIRE(a.num_actions == b.num_actions);
    CHECK(a.actor == b.actor);
    CHECK(a.strategy == b.strategy);
    CHECK(a.action_ev == b.action_ev);
    REQUIRE(a.seats.size() == b.seats.size());
    for (std::size_t s = 0; s < a.seats.size(); ++s) {
      CHECK(a.seats[s].idx == b.seats[s].idx);
      CHECK(a.seats[s].reach == b.seats[s].reach);
      CHECK(a.seats[s].ev == b.seats[s].ev);
    }
  }
}

// ---- chance sampling ------------------------------------------------------
//
// Sampling is the one feature here whose whole correctness story is "the draw
// is a pure function of position, not of scheduling". If that is wrong, the
// numbers differ by thread count and the Pio acceptance gate loses its
// meaning - so it is pinned rather than argued.

namespace {
SamplingConfig sampling_on(int runouts) {
  SamplingConfig s;
  s.enabled = true;
  s.runouts = runouts;
  s.anneal_full_at = 0;  // hold m fixed so the test actually samples
  return s;
}

// Same shape as check_identical_solutions, but carries a sampling config.
void check_identical_sampled(const Game& game, std::uint64_t iterations,
                             SamplingConfig sampling) {
  UpdateConfig update;
  RecalcConfig recalc;
  CfrSolver serial(game, update, 1, recalc, sampling);
  CfrSolver parallel(game, update, 8, recalc, sampling);
  REQUIRE(parallel.pool().threads() > 1);
  serial.run(iterations);
  parallel.run(iterations);

  std::vector<float> a, b;
  for (const Node& node : game.tree().nodes) {
    if (node.kind != NodeKind::Decision) continue;
    const NodeId id = static_cast<NodeId>(&node - game.tree().nodes.data());
    serial.average_strategy(id, a);
    parallel.average_strategy(id, b);
    REQUIRE(a.size() == b.size());
    CHECK(a == b);
  }
  CHECK(serial.sampling_skips() == parallel.sampling_skips());
}
}  // namespace

TEST_CASE("chance sampling is identical on one thread and on eight") {
  const auto game = tiny_turn_game();
  check_identical_sampled(*game, 20, sampling_on(6));
}

TEST_CASE("chance sampling actually skips, and only when asked") {
  const auto game = tiny_turn_game();
  UpdateConfig update;
  RecalcConfig recalc;

  CfrSolver off(*game, update, 1, recalc, SamplingConfig{});
  off.run(5);
  CHECK(off.sampling_skips() == 0);
  CHECK(off.sampling_exact());

  CfrSolver on(*game, update, 1, recalc, sampling_on(6));
  on.run(5);
  CHECK(on.sampling_skips() > 0);
  CHECK_FALSE(on.sampling_exact());
}

// m == n has to degenerate to exactly the un-sampled solver: the n/m factor
// becomes 1 and every unit survives. This is a strong structural check that
// the Horvitz-Thompson scaling is applied in the right place - a stray factor
// anywhere would show up here as a bitwise difference.
TEST_CASE("sampling every runout is bit-identical to sampling off") {
  const auto game = tiny_turn_game();
  UpdateConfig update;
  RecalcConfig recalc;
  recalc.enabled = false;  // off on both arms; sampling would disable it anyway

  CfrSolver plain(*game, update, 1, recalc, SamplingConfig{});
  CfrSolver full(*game, update, 1, recalc, sampling_on(100));  // m > n at every chance node
  plain.run(20);
  full.run(20);
  CHECK(full.sampling_skips() == 0);

  std::vector<float> a, b;
  int compared = 0;
  for (const Node& node : game->tree().nodes) {
    if (node.kind != NodeKind::Decision) continue;
    const NodeId id = static_cast<NodeId>(&node - game->tree().nodes.data());
    plain.average_strategy(id, a);
    full.average_strategy(id, b);
    CHECK(a == b);
    ++compared;
  }
  CHECK(compared > 0);
}
