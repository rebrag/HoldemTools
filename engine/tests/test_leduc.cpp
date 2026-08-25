#include <doctest/doctest.h>

#include "game/toy/leduc.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"

using namespace engine;

TEST_CASE("leduc NashConv decreases across checkpoints and hits the threshold") {
  toy::LeducGame game;
  UpdateConfig update;  // DCFR defaults
  CfrSolver solver(game, update);

  std::vector<double> checkpoints;
  for (int i = 0; i < 10; ++i) {
    solver.run(500);
    checkpoints.push_back(compute_best_response(game, solver).nashconv());
  }

  // Loosely monotone: CFR variants are not strictly monotone per checkpoint,
  // but each checkpoint must stay below 1.5x the previous one, the curve
  // must fall overall, and the final value must beat the threshold.
  for (std::size_t i = 1; i < checkpoints.size(); ++i) {
    CHECK(checkpoints[i] < checkpoints[i - 1] * 1.5);
  }
  CHECK(checkpoints.back() < checkpoints.front());
  CHECK(checkpoints.back() < 0.02);  // chips; antes are 1 chip each

  const BrResult br = compute_best_response(game, solver);
  CHECK(br.ev[0] + br.ev[1] == doctest::Approx(2.0).epsilon(1e-6));
}
