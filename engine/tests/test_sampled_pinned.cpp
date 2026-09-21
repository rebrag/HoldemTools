#include <doctest/doctest.h>

#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "game/toy/kuhn.hpp"
#include "game/toy/leduc.hpp"
#include "io/checkpoint.hpp"
#include "solver/agents.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"
#include "solver/memory.hpp"
#include "solver/sampled_cfr.hpp"

// The PINNED hero (algorithm.sampled.hero "pinned"): the hero is dealt a hand
// like every other seat and walks the tree as a scalar, reading and writing
// the storage row of its dealt hand. With algorithm.sampled.update
// "external" the other seats sample one action each. These are the gates
// every sampled scheme in this engine passes: convergence on the toys whose
// best response is exact, bitwise identity across thread counts, across
// run() slicing on batch boundaries, across a checkpoint, and the memory
// estimator's lane term bounding what a lane actually held.

using namespace engine;

namespace {

SampledConfig cfg(std::uint64_t seed, std::uint32_t batch, std::uint32_t lanes,
                  HeroMode hero, UpdateScheme update) {
  SampledConfig c;
  c.enabled = true;
  c.seed = seed;
  c.batch = batch;
  c.lanes = lanes;
  c.hero = hero;
  c.update = update;
  return c;
}

const char* kRange =
    "AA,KK,QQ,JJ,TT,99,88,77,66,55,"
    "AKs,AQs,AJs,ATs,A5s,A4s,KQs,KJs,QJs,JTs,T9s,98s,87s,"
    "AKo,AQo,AJo,KQo";

SolveConfig multiway_config(int seats, Chips stack) {
  SolveConfig config;
  config.game = "nlhe";
  config.board = "9c 5d Jc 7s 2h";
  config.pot = 30 * seats;
  config.isomorphism = false;
  static const char* kSeatNames[] = {"S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"};
  for (int s = 0; s < seats; ++s) {
    config.players.push_back({kSeatNames[s], stack, kRange});
  }
  StreetSizing sizing;
  sizing.oop.bets = {60.0};
  sizing.ip.bets = {60.0};
  sizing.oop.raises = {100.0};
  sizing.ip.raises = {100.0};
  sizing.max_raises = 1;
  config.flop_sizing = sizing;
  config.turn_sizing = sizing;
  config.river_sizing = sizing;
  config.threads = 0;
  return config;
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

RecalcConfig recalc_off() {
  RecalcConfig r;
  r.enabled = false;
  return r;
}

bool same_bits(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() &&
         std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}

}  // namespace

TEST_CASE("pinned hero converges on Kuhn under both update schemes") {
  for (UpdateScheme update : {UpdateScheme::Chance, UpdateScheme::External}) {
    toy::KuhnGame game;
    SampledCfrSolver solver(game, game, cfg(20260830, 32, 4, HeroMode::Pinned, update));
    solver.run(400000);
    const BrResult br = compute_best_response(game, solver);
    MESSAGE("kuhn pinned " << (update == UpdateScheme::External ? "external" : "chance")
                           << " nashconv " << br.nashconv());
    CHECK(br.nashconv() >= 0.0);
    CHECK(br.nashconv() < 0.03);
    CHECK(br.ev[0] + br.ev[1] == doctest::Approx(2.0).epsilon(1e-4));
  }
}

TEST_CASE("pinned hero converges on Leduc through its chance nodes, both schemes") {
  for (UpdateScheme update : {UpdateScheme::Chance, UpdateScheme::External}) {
    toy::LeducGame game;
    SampledCfrSolver solver(game, game, cfg(20260830, 32, 4, HeroMode::Pinned, update));
    solver.run(100000);
    const BrResult early = compute_best_response(game, solver);
    solver.run(700000);
    const BrResult late = compute_best_response(game, solver);
    MESSAGE("leduc pinned " << (update == UpdateScheme::External ? "external" : "chance")
                            << " nashconv " << early.nashconv() << " -> " << late.nashconv());
    CHECK(late.nashconv() >= 0.0);
    CHECK(late.nashconv() < 0.08);
    CHECK(late.nashconv() < early.nashconv());
    CHECK(late.ev[0] + late.ev[1] == doctest::Approx(2.0).epsilon(1e-4));
  }
}

TEST_CASE("pinned hero is bitwise identical at any thread count and any shard count") {
  for (UpdateScheme update : {UpdateScheme::Chance, UpdateScheme::External}) {
    auto leduc = [update](int threads, std::uint32_t shards) {
      toy::LeducGame game;
      SampledConfig c = cfg(7, 32, 8, HeroMode::Pinned, update);
      c.fold_shards = shards;
      SampledCfrSolver solver(game, game, c, threads);
      solver.run(20000);
      return std::make_pair(solver.regrets(), solver.strategy_sums());
    };
    const auto one = leduc(1, 1);
    const auto eight = leduc(8, 64);
    CHECK(same_bits(one.first, eight.first));
    CHECK(same_bits(one.second, eight.second));

    auto flop = [update](int threads, std::uint32_t shards) {
      const SolveConfig config = flop_config();
      NlhePostflopGame game(config);
      SampledConfig c = cfg(7, 64, 8, HeroMode::Pinned, update);
      c.range_deal = true;
      c.fold_shards = shards;
      SampledCfrSolver solver(game, game, c, threads);
      solver.run(4096);
      return std::make_pair(solver.regrets(), solver.strategy_sums());
    };
    const auto serial = flop(1, 1);
    const auto parallel = flop(8, 64);
    CHECK(same_bits(serial.first, parallel.first));
    CHECK(same_bits(serial.second, parallel.second));
  }
}

TEST_CASE("pinned hero: run() slicing on batch boundaries and a checkpoint are bitwise exact") {
  const SolveConfig config = flop_config();
  NlhePostflopGame game(config);
  SampledConfig c = cfg(7, 64, 8, HeroMode::Pinned, UpdateScheme::External);
  c.range_deal = true;
  const std::uint64_t kIters = 4096;

  SampledCfrSolver whole(game, game, c, config.threads);
  whole.run(kIters);

  SampledCfrSolver sliced(game, game, c, config.threads);
  for (std::uint64_t done = 0; done < kIters; done += c.batch * 3) {
    sliced.run(std::min<std::uint64_t>(c.batch * 3, kIters - done));
  }
  CHECK(same_bits(whole.regrets(), sliced.regrets()));
  CHECK(same_bits(whole.strategy_sums(), sliced.strategy_sums()));

  SampledCfrSolver first(game, game, c, config.threads);
  first.run(kIters / 2);
  SampledCfrSolver second(game, game, c, config.threads);
  second.restore(first.iteration(), first.store(), first.ev_store(), first.frozen_seats(),
                 first.frozen_rows());
  second.run(kIters / 2);
  CHECK(same_bits(whole.regrets(), second.regrets()));
  CHECK(same_bits(whole.strategy_sums(), second.strategy_sums()));
}

TEST_CASE("pinned hero: the 3-way sampled core agrees with the exact core and conserves") {
  const SolveConfig config = multiway_config(3, 200);
  NlhePostflopGame game(config);

  CfrSolver exact(game, config.update, config.threads, recalc_off());
  exact.run(1500);
  const BrResult exact_br = compute_best_response(game, exact);

  for (UpdateScheme update : {UpdateScheme::Chance, UpdateScheme::External}) {
    SampledConfig c = cfg(20260920, 1024, 16, HeroMode::Pinned, update);
    c.range_deal = true;
    SampledCfrSolver sampled(game, game, c, config.threads);
    sampled.run(update == UpdateScheme::External ? 2000000 : 400000);
    const std::vector<double> ev = sampled.sampled_ev(200000, c.seed ^ 0x5EEDULL);
    double sum = 0.0;
    for (double v : ev) sum += v;
    CHECK(std::abs(sum - static_cast<double>(config.pot)) < 1e-3);
    const BrResult br = compute_best_response(game, sampled);
    MESSAGE("3-way pinned " << (update == UpdateScheme::External ? "external" : "chance")
                            << ": nashconv " << br.nashconv() << " (exact " << exact_br.nashconv()
                            << "); EVs " << ev[0] << " " << ev[1] << " " << ev[2] << " vs exact "
                            << exact_br.ev[0] << " " << exact_br.ev[1] << " " << exact_br.ev[2]);
    for (int s = 0; s < 3; ++s) {
      CHECK(std::abs(ev[static_cast<std::size_t>(s)] - exact_br.ev[static_cast<std::size_t>(s)]) <
            1.5);
    }
    CHECK(br.nashconv() < static_cast<double>(config.pot) * 0.15);
  }
}

TEST_CASE("pinned hero: the memory estimator's log term bounds what a lane held") {
  for (UpdateScheme update : {UpdateScheme::Chance, UpdateScheme::External}) {
    const SolveConfig config = multiway_config(3, 200);
    NlhePostflopGame game(config);
    SampledConfig c = cfg(3, 512, 4, HeroMode::Pinned, update);
    c.range_deal = true;
    SampledCfrSolver solver(game, game, c, config.threads);
    solver.run(8192);
    const std::size_t bound = pinned_log_entries_per_lane(game, c);
    MESSAGE("log entries per lane: held " << solver.max_log_entries() << ", bound " << bound);
    CHECK(solver.max_log_entries() > 0);
    CHECK(solver.max_log_entries() <= bound);
    const MemoryEstimate est = estimate_memory(game, config.threads, false, Precision::F32, &c);
    CHECK(est.regret_strategy_bytes >= 2 * solver.store_total() * sizeof(float) + bound * 24);
  }
}
