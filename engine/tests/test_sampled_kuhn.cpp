#include <doctest/doctest.h>

#include <cstring>

#include "game/toy/kuhn.hpp"
#include "game/toy/leduc.hpp"
#include "solver/best_response.hpp"
#include "solver/sampled_cfr.hpp"

using namespace engine;

// The sampled core's CI gates, on games whose best response is EXACT (the
// vectorized terminal_values path). Convergence is stochastic but the run is
// deterministic given (seed, batch, lanes), so the thresholds are calibrated
// once and then never flake.

TEST_CASE("sampled core converges on Kuhn") {
  toy::KuhnGame game;
  SampledConfig config;
  config.enabled = true;
  config.seed = 20260830;
  config.batch = 32;
  config.lanes = 4;
  SampledCfrSolver solver(game, game, config);
  solver.run(200000);
  const BrResult br = compute_best_response(game, solver);
  // Kuhn's pot is 2 chips; land within 1% of it. The vectorized core gets
  // here in a few hundred iterations - the gap is the price of sampling and
  // is exactly why heads-up stays on CfrSolver.
  CHECK(br.nashconv() >= 0.0);
  CHECK(br.nashconv() < 0.02);
  // Root EVs sum to the root pot (both antes) - conservation by construction.
  CHECK(br.ev[0] + br.ev[1] == doctest::Approx(2.0).epsilon(1e-4));
}

TEST_CASE("sampled core converges on Leduc through its chance nodes") {
  toy::LeducGame game;
  SampledConfig config;
  config.enabled = true;
  config.seed = 20260830;
  config.batch = 32;
  config.lanes = 4;
  SampledCfrSolver solver(game, game, config);
  BrResult early, late;
  solver.run(50000);
  early = compute_best_response(game, solver);
  solver.run(350000);
  late = compute_best_response(game, solver);
  // Leduc's pot is 2 chips at the root; the vectorized reference reaches
  // nashconv 0.107 at its committed fixture. Gate the sampled run loosely on
  // level and strictly on direction.
  CHECK(late.nashconv() >= 0.0);
  CHECK(late.nashconv() < 0.05);
  CHECK(late.nashconv() < early.nashconv());
  CHECK(late.ev[0] + late.ev[1] == doctest::Approx(2.0).epsilon(1e-4));
}

TEST_CASE("sampled core is bitwise identical at any thread count") {
  auto solve = [](int threads) {
    toy::LeducGame game;
    SampledConfig config;
    config.enabled = true;
    config.seed = 7;
    config.batch = 32;
    config.lanes = 8;
    SampledCfrSolver solver(game, game, config, threads);
    solver.run(20000);
    return std::make_pair(solver.regrets(), solver.strategy_sums());
  };
  const auto one = solve(1);
  const auto eight = solve(8);
  // Exact, never a tolerance: the lanes-and-serial-fold design claims bit
  // identity, so the test asserts bit identity.
  REQUIRE(one.first.size() == eight.first.size());
  CHECK(std::memcmp(one.first.data(), eight.first.data(),
                    one.first.size() * sizeof(float)) == 0);
  CHECK(std::memcmp(one.second.data(), eight.second.data(),
                    one.second.size() * sizeof(float)) == 0);
}
