#include <doctest/doctest.h>

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_preflop.hpp"
#include "game/nlhe_river.hpp"
#include "game/toy/leduc.hpp"
#include "solver/agents.hpp"
#include "solver/sampled_cfr.hpp"

#include <nlohmann/json.hpp>

// The sampled core's STORE invariants.
//
// 1. The lane fold is sharded over contiguous group ranges and runs in
//    parallel, and every shard count must produce the same bits, because a
//    cell belongs to exactly one shard and the lanes are still applied in
//    lane order inside it. If this ever fails the fold has started depending
//    on which thread folded which shard.
// 2. Every consumer is HOMOGENEOUS OF DEGREE 0 in the store. The master holds
//    the raw iteration-weighted sums (R = sum_b b1 * delta_b) and the
//    discounted r_T = R / T is never materialized, so a reader that took an
//    absolute magnitude from the store would silently depend on the
//    iteration count. Scaling every cell by an exact power of two must leave
//    the average strategy, the bucket rows, the EV walk and the team rollups
//    bit-for-bit where they were.

using namespace engine;

namespace {

SampledConfig cfg(std::uint64_t seed, std::uint32_t batch, std::uint32_t lanes,
                  std::uint32_t shards) {
  SampledConfig c;
  c.enabled = true;
  c.seed = seed;
  c.batch = batch;
  c.lanes = lanes;
  c.fold_shards = shards;
  return c;
}

SolveConfig flop_config() {
  SolveConfig config;
  config.game = "nlhe";
  config.board = "Qs Jh 2h";
  config.pot = 100;
  config.isomorphism = false;
  config.players = {{"OOP", 200, "AA,KK,QQ,AKs,A5s,KQs,76s"},
                    {"IP", 200, "JJ,TT,99,AQs,KQs,T9s"}};
  StreetSizing sizing;
  sizing.oop.bets = {75.0};
  sizing.ip.bets = {75.0};
  sizing.oop.raises = {100.0};
  sizing.ip.raises = {100.0};
  sizing.max_raises = 1;
  config.flop_sizing = sizing;
  config.turn_sizing = sizing;
  config.river_sizing = sizing;
  config.threads = 0;
  return config;
}

bool same_bits(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() &&
         std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}

std::string full_range() {
  static const char* kRanks = "AKQJT98765432";
  std::string out;
  for (int i = 0; i < 13; ++i) {
    for (int j = i; j < 13; ++j) {
      if (!out.empty()) out += ",";
      if (i == j) {
        out += std::string{kRanks[i], kRanks[i]};
      } else {
        out += std::string{kRanks[i], kRanks[j], 's'};
        out += ",";
        out += std::string{kRanks[i], kRanks[j], 'o'};
      }
    }
  }
  return out;
}

SolveConfig pushfold_config(int seats) {
  SolveConfig config;
  config.game = "nlhe_preflop";
  config.chip_scale = 2.0;
  const std::string range = full_range();
  for (int s = 0; s < seats; ++s) {
    PlayerConfig p;
    p.seat = "P" + std::to_string(s);
    p.stack = 20;
    p.range = range;
    config.players.push_back(p);
  }
  config.preflop.small_blind = 1;
  config.preflop.big_blind = 2;
  config.preflop.button = seats - 1;
  config.preflop.ante.assign(static_cast<std::size_t>(seats), 0);
  config.preflop.board_sample.pair_count = 2000;
  config.preflop.board_sample.iter_count = 3;
  config.preflop.board_sample.seed = 20260830;
  config.pot = 3;
  config.threads = 0;
  config.sampled.enabled = true;
  return config;
}

AgentMap team_map(int seats, int a, int b) {
  AgentMap map = AgentMap::identity(seats);
  map.teammate_of[static_cast<std::size_t>(a)] = b;
  map.teammate_of[static_cast<std::size_t>(b)] = a;
  map.seat_to_agent[static_cast<std::size_t>(b)] = map.seat_to_agent[static_cast<std::size_t>(a)];
  map.num_agents = seats - 1;
  return map;
}

// A copy of `solver`'s state with every cell times `scale` (exact for a
// power of two), restored into `into`.
void restore_scaled(const SampledCfrSolver& solver, SampledCfrSolver& into, float scale) {
  std::vector<float> store = solver.store();
  std::vector<float> ev = solver.ev_store();
  for (float& x : store) x *= scale;
  for (float& x : ev) x *= scale;
  into.restore(solver.iteration(), std::move(store), std::move(ev), solver.frozen_seats(),
               solver.frozen_rows());
}

std::vector<std::vector<float>> all_rows(const Game& game, const SampledCfrSolver& solver) {
  std::vector<std::vector<float>> out;
  const PublicTree& tree = game.tree();
  for (NodeId id = 0; id < tree.size(); ++id) {
    if (tree[id].kind != NodeKind::Decision) continue;
    std::vector<float> row;
    solver.average_strategy(id, row);
    out.push_back(std::move(row));
  }
  return out;
}

}  // namespace

TEST_CASE("sampled store: the fold shard count cannot change a bit") {
  auto leduc = [](std::uint32_t shards) {
    toy::LeducGame game;
    SampledCfrSolver solver(game, game, cfg(7, 32, 8, shards), 8);
    solver.run(20000);
    return std::make_pair(solver.regrets(), solver.strategy_sums());
  };
  const auto one = leduc(1);
  const auto many = leduc(64);
  CHECK(same_bits(one.first, many.first));
  CHECK(same_bits(one.second, many.second));

  auto flop = [](std::uint32_t shards) {
    const SolveConfig config = flop_config();
    NlhePostflopGame game(config);
    SampledCfrSolver solver(game, game, cfg(7, 64, 8, shards), config.threads);
    solver.run(2048);
    return std::make_pair(solver.regrets(), solver.strategy_sums());
  };
  const auto serial = flop(1);
  const auto sharded = flop(64);
  CHECK(same_bits(serial.first, sharded.first));
  CHECK(same_bits(serial.second, sharded.second));
}

TEST_CASE("sampled store: no consumer reads an absolute magnitude") {
  // Leduc: the average strategy and the EV walk.
  {
    toy::LeducGame game;
    SampledCfrSolver solver(game, game, cfg(7, 32, 8, 0), 8);
    solver.run(20000);
    SampledCfrSolver scaled(game, game, cfg(7, 32, 8, 0), 8);
    restore_scaled(solver, scaled, 4.0f);
    const auto a = all_rows(game, solver);
    const auto b = all_rows(game, scaled);
    REQUIRE(a.size() == b.size());
    for (std::size_t i = 0; i < a.size(); ++i) CHECK(same_bits(a[i], b[i]));
    CHECK(solver.sampled_ev(5000, 99) == scaled.sampled_ev(5000, 99));
  }
  // A bucketed flop tree: the per-hand rows and the bucket rows.
  {
    SolveConfig config = flop_config();
    NlhePostflopGame game(config);
    SampledConfig sc = cfg(7, 64, 8, 0);
    sc.abstraction.enabled = true;
    sc.abstraction.method = "histogram";
    sc.abstraction.turn = 8;
    sc.abstraction.river = 6;
    SampledCfrSolver solver(game, game, sc, config.threads);
    solver.run(2048);
    SampledCfrSolver scaled(game, game, sc, config.threads);
    restore_scaled(solver, scaled, 4.0f);
    const auto a = all_rows(game, solver);
    const auto b = all_rows(game, scaled);
    REQUIRE(a.size() == b.size());
    for (std::size_t i = 0; i < a.size(); ++i) CHECK(same_bits(a[i], b[i]));
    for (std::uint32_t g = 0; g < solver.indexer().num_groups; g += 97) {
      std::vector<float> x, y;
      solver.bucket_strategy(g, x);
      scaled.bucket_strategy(g, y);
      CHECK(same_bits(x, y));
    }
  }
  // A hand-sharing team: the conditioned rollups and the joint export. Only
  // weight_max, documented as an iteration-weighted mass, may move.
  {
    const SolveConfig config = pushfold_config(3);
    NlhePreflopGame game(config);
    SampledCfrSolver solver(game, game, cfg(20260830, 1024, 16, 0), config.threads,
                            team_map(3, 0, 2));
    solver.run(4096);
    SampledCfrSolver scaled(game, game, cfg(20260830, 1024, 16, 0), config.threads,
                            team_map(3, 0, 2));
    restore_scaled(solver, scaled, 4.0f);
    CHECK(solver.team_rollup_json() == scaled.team_rollup_json());
    nlohmann::json x = solver.team_joint_json();
    nlohmann::json y = scaled.team_joint_json();
    for (nlohmann::json* j : {&x, &y}) {
      for (auto& [id, node] : j->at("nodes").items()) node.erase("weight_max");
    }
    CHECK(x == y);
    CHECK(solver.sampled_ev(5000, 99) == scaled.sampled_ev(5000, 99));
  }
}
