#include <doctest/doctest.h>

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "game/toy/leduc.hpp"
#include "solver/sampled_cfr.hpp"

// The sampled core's STORE invariants: the lane fold is sharded over
// contiguous group ranges and runs in parallel, and every shard count must
// produce the same bits, because a cell belongs to exactly one shard and the
// lanes are still applied in lane order inside it. If this ever fails the
// fold has started depending on which thread folded which shard.

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
