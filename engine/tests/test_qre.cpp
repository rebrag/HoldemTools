#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "game/toy/kuhn.hpp"
#include "game/toy/leduc.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"

using namespace engine;

namespace {

QreConfig qre_at(double lambda) {
  QreConfig q;
  q.enabled = true;
  q.lambda = {lambda, lambda};
  return q;
}

// Kuhn root: hands J=0, Q=1, K=2; actions check=0, bet=1.
std::vector<float> kuhn_root_strategy(double lambda, std::uint64_t iterations) {
  toy::KuhnGame game;
  CfrSolver solver(game, UpdateConfig{}, 1, {}, {}, qre_at(lambda));
  solver.run(iterations);
  std::vector<float> sigma;
  solver.average_strategy(0, sigma);
  return sigma;
}

double row_entropy(const std::vector<float>& sigma, int hand, int actions) {
  double h = 0.0;
  for (int k = 0; k < actions; ++k) {
    const double p = sigma[static_cast<std::size_t>(hand) * actions + k];
    if (p > 0.0) h -= p * std::log(p);
  }
  return h;
}

// A turn tree with real chance nodes, small enough to iterate in a test.
// Mirrors tests/test_recalc.cpp's turn_game().
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

}  // namespace

TEST_CASE("qre at a tiny lambda is uniform, at a huge lambda is Nash") {
  // lambda -> 0 is the uniform-random limit. (Exactly 0 is refused by the
  // config parser, because the regularizer is 1/lambda.)
  const std::vector<float> soft = kuhn_root_strategy(0.01, 5000);
  for (int hand = 0; hand < 3; ++hand) {
    INFO("hand ", hand);
    CHECK(soft[static_cast<std::size_t>(hand) * 2 + 0] == doctest::Approx(0.5).epsilon(0.05));
  }

  // lambda -> infinity recovers Nash. Kuhn's equilibrium family at the P0
  // root: bet(J) = a in [0, 1/3], bet(Q) = 0, bet(K) = 3a - the same
  // assertions test_kuhn.cpp makes about the unregularized solve.
  toy::KuhnGame game;
  CfrSolver solver(game, UpdateConfig{}, 1, {}, {}, qre_at(500.0));
  solver.run(20000);
  const BrResult br = compute_best_response(game, solver);
  // Perturbing a payoff by at most eps makes a Nash of the perturbed game a
  // 2*eps-Nash of the true one; here eps ~ D*log(A)/lambda, so Kuhn (D=2,
  // A=2) floors around 2*2*log2/500 = 0.0055 chips.
  CHECK(br.nashconv() < 0.02);
  CHECK(br.ev[0] == doctest::Approx(17.0 / 18.0).epsilon(0.02));

  std::vector<float> sigma;
  solver.average_strategy(0, sigma);
  CHECK(sigma[1 * 2 + 1] == doctest::Approx(0.0).epsilon(0.03));  // bet(Q) -> 0
}

TEST_CASE("qre bets Q, which no Kuhn Nash equilibrium ever does") {
  // The discriminator. bet(Q) == 0 at EVERY point of Kuhn's Nash family, but
  // a QRE has full support by construction, so this cannot pass vacuously and
  // cannot pass with the reward transform wired backwards or scaled wrong.
  const std::vector<float> sigma = kuhn_root_strategy(5.0, 20000);
  const double bet_q = sigma[1 * 2 + 1];
  CHECK(bet_q > 0.02);
  CHECK(bet_q < 0.5);  // still the worst hand to bet - not drifting to uniform
}

TEST_CASE("qre interpolates monotonically between uniform and Nash") {
  double prev_entropy = 1e9;
  double prev_nashconv = 1e9;
  for (double lambda : {1.0, 5.0, 50.0}) {
    toy::KuhnGame game;
    CfrSolver solver(game, UpdateConfig{}, 1, {}, {}, qre_at(lambda));
    solver.run(20000);
    std::vector<float> sigma;
    solver.average_strategy(0, sigma);
    double entropy = 0.0;
    for (int hand = 0; hand < 3; ++hand) entropy += row_entropy(sigma, hand, 2);
    const double nashconv = compute_best_response(game, solver).nashconv();
    INFO("lambda ", lambda, " entropy ", entropy, " nashconv ", nashconv);
    // Sharper play and closer to Nash as lambda rises. Catches sign and scale
    // errors that the two limits on their own are too forgiving to see.
    CHECK(entropy < prev_entropy);
    CHECK(nashconv < prev_nashconv);
    prev_entropy = entropy;
    prev_nashconv = nashconv;
  }
}

TEST_CASE("the qre gap converges where plain exploitability cannot") {
  // The honest limitation, pinned in code so nobody later "fixes" the floor.
  // At a soft lambda the strategy is genuinely far from Nash and stays there;
  // what converges is exploitability in the entropy-augmented game.
  //
  // The two numbers come from independent code paths - the gap is measured by
  // best_response.cpp from the strategy alone, sharing nothing with the
  // traversal's reward transform - so agreement is evidence, not tautology.
  const auto game = turn_game();
  CfrSolver solver(*game, UpdateConfig{}, 1, {}, {}, qre_at(0.5));
  BrResult plain, gap;
  for (int i = 0; i < 8; ++i) {
    solver.run(250);
    plain = compute_best_response(*game, solver);
    gap = compute_qre_best_response(*game, solver);
    solver.set_recalc_budget(gap.nashconv() / game->num_seats());
  }
  const double seats = static_cast<double>(game->num_seats());
  INFO("qre gap ", gap.nashconv() / seats, " plain ", plain.nashconv() / seats);
  CHECK(gap.nashconv() / seats < 0.1);  // converging, on a 100-chip pot
  // ...and emphatically not to Nash. Stated as a ratio because that is the
  // actual claim - the plain number is stuck an order of magnitude above the
  // gap and will stay there however long the solve runs. Measured at this
  // lambda: gap 0.025 chips, plain 0.579.
  CHECK(plain.nashconv() > 8.0 * gap.nashconv());
  CHECK(plain.nashconv() / seats > 0.3);
  // The plain best response still measures the true game, so its EVs must
  // still sum to the root pot - a scale error in the transform would leak
  // into the values and break this.
  CHECK(plain.ev[0] + plain.ev[1] == doctest::Approx(100.0).epsilon(1e-4));
}

TEST_CASE("qre is bitwise identical at any thread count") {
  // Same invariant as test_parallel.cpp, extended over the new code path: the
  // reward transform is per (node, hand, action) from node-local data, so
  // threading must change when the arithmetic happens and never what it is.
  const auto check = [](const Game& game, std::uint64_t iterations) {
    CfrSolver serial(game, UpdateConfig{}, 1, {}, {}, qre_at(3.0));
    CfrSolver parallel(game, UpdateConfig{}, 8, {}, {}, qre_at(3.0));
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
      ++compared;
    }
    CHECK(compared > 0);
    const BrResult s = compute_qre_best_response(game, serial);
    const BrResult p = compute_qre_best_response(game, parallel);
    CHECK(s.br_value == p.br_value);
    CHECK(s.ev == p.ev);
  };

  toy::LeducGame leduc;
  check(leduc, 300);
  const auto turn = turn_game();
  check(*turn, 60);
}

TEST_CASE("qre composes with the recalc schedule and stays deterministic") {
  // Lambda is high here on purpose. The schedule's skip threshold is
  // proportional to the budget it is fed, and under QRE that budget is the
  // regularized gap - which is much smaller than NashConv at a soft lambda,
  // so a soft solve legitimately skips little or nothing. That is the
  // conservative direction (less freezing, not stale values), but it would
  // make this test vacuous, so pick a lambda whose gap is the same order as
  // the Nash one and mirror test_recalc.cpp's cadence exactly.
  const auto game = turn_game();
  const auto solve = [&](int threads) {
    auto solver = std::make_unique<CfrSolver>(*game, UpdateConfig{}, threads, RecalcConfig{},
                                              SamplingConfig{}, qre_at(50.0));
    for (int i = 0; i < 8; ++i) {
      solver->run(50);
      solver->set_recalc_budget(compute_qre_best_response(*game, *solver).nashconv() /
                                game->num_seats());
    }
    return solver;
  };
  const auto one = solve(1);
  const auto many = solve(8);
  // Non-vacuous: if the schedule never engaged this would be testing nothing.
  CHECK(one->recalc_skips() > 0);
  CHECK(one->recalc_skips() == many->recalc_skips());

  std::vector<float> a, b;
  for (const Node& node : game->tree().nodes) {
    if (node.kind != NodeKind::Decision) continue;
    const NodeId id = static_cast<NodeId>(&node - game->tree().nodes.data());
    one->average_strategy(id, a);
    many->average_strategy(id, b);
    CHECK(a == b);
  }
}

TEST_CASE("qre composes with suit isomorphism") {
  // Isomorphism is on by default in production, so a QRE solve meets it
  // immediately. The collapse is a relabeling: a member node's strategy is
  // read through its representative, and the regularizer is a function of
  // (sigma at the node, compatible opponent reach) - both of which the
  // relabeling preserves. This is the check on that argument.
  //
  // And the assertion can be much stronger here than the Nash equivalent in
  // test_iso.cpp. Nash equilibria are not unique, so that test can only
  // compare the game value; the entropy-regularized objective is strictly
  // convex-concave, so its solution IS unique and the two solves must agree
  // on the STRATEGY itself, hand for hand.
  const auto config = [](bool iso) {
    SolveConfig c;
    c.game = "nlhe";
    c.board = "Ah Kh 7c 2c";  // has a usable s/c-style permutation
    c.pot = 100;
    c.isomorphism = iso;
    c.players = {{"OOP", 200, "AA,KK,QQ,JJ,TT,99,88,AKs"},
                 {"IP", 200, "AA,KK,QQ,JJ,TT,99,88,AKs"}};
    c.turn_sizing.oop.bets = {75.0};
    c.turn_sizing.ip.bets = {75.0};
    c.turn_sizing.max_raises = 0;
    c.river_sizing = c.turn_sizing;
    return c;
  };
  RecalcConfig recalc_off;
  recalc_off.enabled = false;

  const NlhePostflopGame off_game(config(false));
  const NlhePostflopGame on_game(config(true));
  CfrSolver off(off_game, UpdateConfig{}, 1, recalc_off, {}, qre_at(2.0));
  CfrSolver on(on_game, UpdateConfig{}, 1, recalc_off, {}, qre_at(2.0));
  off.run(2400);
  on.run(2400);

  REQUIRE(off_game.tree().size() == on_game.tree().size());
  std::vector<float> a, b;
  double worst = 0.0;
  int compared = 0;
  for (NodeId id = 0; id < off_game.tree().size(); ++id) {
    if (off_game.tree()[id].kind != NodeKind::Decision) continue;
    off.average_strategy(id, a);
    on.average_strategy(id, b);
    REQUIRE(a.size() == b.size());
    for (std::size_t i = 0; i < a.size(); ++i) {
      worst = std::max(worst, std::abs(static_cast<double>(a[i]) - b[i]));
    }
    ++compared;
  }
  CHECK(compared > 0);
  INFO("worst per-cell strategy difference ", worst);
  // Convergence residual, not bias: measured 0.053 at 600 iterations, 0.028 at
  // 2400 and 0.0085 at 9600, i.e. going to zero as both solves approach the
  // same unique QRE. A relabeling bug would leave a floor here instead.
  CHECK(worst < 0.05);
}

TEST_CASE("a hand the opponent cannot hold is charged nothing, and stays finite") {
  // pi(h) == 0 makes the regularizer exactly zero rather than a division by
  // zero - the transform multiplies by pi(h), it never divides. Leduc deals a
  // community card that blocks a hand, so this is reachable.
  toy::LeducGame game;
  CfrSolver solver(game, UpdateConfig{}, 1, {}, {}, qre_at(4.0));
  solver.run(500);
  std::vector<float> sigma;
  int checked = 0;
  for (const Node& node : game.tree().nodes) {
    if (node.kind != NodeKind::Decision) continue;
    const NodeId id = static_cast<NodeId>(&node - game.tree().nodes.data());
    solver.average_strategy(id, sigma);
    for (float p : sigma) {
      REQUIRE(std::isfinite(p));
      ++checked;
    }
  }
  CHECK(checked > 0);
  const BrResult br = compute_qre_best_response(game, solver);
  for (double v : br.br_value) CHECK(std::isfinite(v));
  for (double v : br.ev) CHECK(std::isfinite(v));
}
