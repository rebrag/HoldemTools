#include <doctest/doctest.h>

#include "game/toy/kuhn.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"

using namespace engine;

namespace {

// Root decision node is id 0; action 0 = check, action 1 = bet.
// Hands: J=0, Q=1, K=2.
struct KuhnSolve {
  toy::KuhnGame game;
  CfrSolver solver;
  BrResult br;

  explicit KuhnSolve(UpdateRule rule, std::uint64_t iterations) : solver(game, [&] {
    UpdateConfig update;
    update.rule = rule;
    return update;
  }()) {
    solver.run(iterations);
    br = compute_best_response(game, solver);
  }
};

}  // namespace

TEST_CASE("kuhn converges to the analytic equilibrium family (DCFR default)") {
  KuhnSolve solve(UpdateRule::Dcfr, 20000);

  // NashConv -> 0 and the game value for P0 is ante + (-1/18) = 17/18.
  CHECK(solve.br.nashconv() < 1e-3);
  CHECK(solve.br.ev[0] == doctest::Approx(17.0 / 18.0).epsilon(0.01));
  CHECK(solve.br.ev[0] + solve.br.ev[1] == doctest::Approx(2.0).epsilon(1e-6));

  // Equilibrium family at the P0 root: bet(J) = a in [0, 1/3], bet(Q) = 0,
  // bet(K) = 3a.
  std::vector<float> sigma;
  solve.solver.average_strategy(0, sigma);
  const double bet_j = sigma[0 * 2 + 1];
  const double bet_q = sigma[1 * 2 + 1];
  const double bet_k = sigma[2 * 2 + 1];
  CHECK(bet_j >= -0.01);
  CHECK(bet_j <= 1.0 / 3.0 + 0.02);
  CHECK(bet_q == doctest::Approx(0.0).epsilon(0.02));
  CHECK(bet_k == doctest::Approx(3.0 * bet_j).epsilon(0.05));
}

TEST_CASE("kuhn converges under every update rule") {
  for (UpdateRule rule : {UpdateRule::RegretMatching, UpdateRule::CfrPlus, UpdateRule::Dcfr}) {
    KuhnSolve solve(rule, 50000);
    INFO("rule ", static_cast<int>(rule));
    CHECK(solve.br.nashconv() < 5e-3);
    CHECK(solve.br.ev[0] == doctest::Approx(17.0 / 18.0).epsilon(0.02));
  }
}
