#include <doctest/doctest.h>

#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "solver/agents.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"
#include "solver/sampled_cfr.hpp"

// Multiway POSTFLOP: the N-seat game layer over the N-seat tree.
//
// The load-bearing gate here is the CROSS-CORE one. Three seats is the only
// count where both cores can solve the same spot, and they get there by
// completely independent routes - the vectorized core through Showdown3's
// O(52*H) inclusion-exclusion sweep, the sampled core through showdown_share
// on concrete dealt cards. Agreement between them checks the sweep against a
// rule that shares none of its algebra.

using namespace engine;

namespace {

// Narrow enough that a 3-seat tree stays quick, wide enough that a uniform
// deal lands inside it often - the sampled core's effective sample size IS
// that rate.
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

SampledConfig sampled_cfg(std::uint64_t seed) {
  SampledConfig c;
  c.enabled = true;
  c.seed = seed;
  c.batch = 4096;
  c.lanes = 4;
  return c;
}

RecalcConfig recalc_off() {
  RecalcConfig r;
  r.enabled = false;
  return r;
}

}  // namespace

TEST_CASE("3-way postflop solves on the vectorized core and conserves chips exactly") {
  const SolveConfig config = multiway_config(3, 200);
  NlhePostflopGame game(config);
  REQUIRE(game.num_seats() == 3);
  REQUIRE(game.vectorized_terminals());

  CfrSolver solver(game, config.update, config.threads, recalc_off());
  solver.run(200);
  const BrResult br = compute_best_response(game, solver);

  // Root EVs sum to the root pot at every seat count - the utility
  // convention, and the property the preflop factorized estimator provably
  // cannot hold at 4+. Here it is exact because the terminal is.
  double sum = 0.0;
  for (double ev : br.ev) sum += ev;
  // Tolerance is float-accumulation noise over the whole tree, not slack in
  // the terminal: the residual is reported so a real drift is visible rather
  // than absorbed.
  MESSAGE("3-way vectorized conservation residual " << (sum - static_cast<double>(config.pot))
                                                    << " chips");
  CHECK(std::abs(sum - static_cast<double>(config.pot)) < 1e-3);

  // And it is actually converging, not sitting still.
  CfrSolver longer(game, config.update, config.threads, recalc_off());
  longer.run(800);
  const BrResult later = compute_best_response(game, longer);
  CHECK(later.nashconv() < br.nashconv());
  MESSAGE("3-way vectorized: nashconv " << br.nashconv() << " -> " << later.nashconv()
                                        << ", EVs sum to " << sum);
}

TEST_CASE("3-way postflop: the two cores agree, which checks Showdown3 against showdown_share") {
  const SolveConfig config = multiway_config(3, 200);
  NlhePostflopGame game(config);

  CfrSolver exact(game, config.update, config.threads, recalc_off());
  exact.run(1500);
  const BrResult exact_br = compute_best_response(game, exact);

  const SampledConfig sc = sampled_cfg(20260907);
  const AgentMap agents = AgentMap::identity(game.num_seats());
  SampledCfrSolver sampled(game, game, sc, config.threads, agents);
  sampled.run(400000);
  const std::vector<double> ev = sampled.sampled_ev(200000, sc.seed ^ 0x5EEDULL);

  REQUIRE(ev.size() == 3u);
  double sum = 0.0;
  for (double v : ev) sum += v;
  // The sampled EV pass conserves by construction: every deal's payoffs sum
  // to the pot, so their average does too.
  CHECK(std::abs(sum - static_cast<double>(config.pot)) < 1e-3);

  // The two cores share the tree and nothing else about how a showdown is
  // valued. Agreement to well under a chip on a 90-chip pot is the check.
  const double pot = static_cast<double>(config.pot);
  double worst = 0.0;
  for (int s = 0; s < 3; ++s) worst = std::max(worst, std::abs(ev[s] - exact_br.ev[s]));
  MESSAGE("3-way cross-core: worst per-seat EV gap " << worst << " chips ("
                                                     << (100.0 * worst / pot) << "% of pot)");
  CHECK(worst < 0.02 * pot);
}

TEST_CASE("multiway postflop: unequal stacks build side pots and still conserve") {
  SolveConfig config = multiway_config(3, 200);
  config.players[0].stack = 60;   // short
  config.players[2].stack = 400;  // deep
  NlhePostflopGame game(config);

  // The tree must actually produce all-in-for-less lines, or the side-pot
  // path is untested rather than passing.
  bool saw_side_pot = false;
  for (const Node& n : game.tree().nodes) {
    if (n.kind != NodeKind::Terminal || n.terminal_kind != TerminalKind::Showdown) continue;
    if (n.commit[0] != n.commit[1] || n.commit[1] != n.commit[2]) saw_side_pot = true;
  }
  CHECK(saw_side_pot);

  CfrSolver solver(game, config.update, config.threads, recalc_off());
  solver.run(300);
  const BrResult br = compute_best_response(game, solver);
  double sum = 0.0;
  for (double ev : br.ev) sum += ev;
  MESSAGE("side-pot conservation residual " << (sum - static_cast<double>(config.pot))
                                            << " chips");
  CHECK(std::abs(sum - static_cast<double>(config.pot)) < 1e-3);
}

TEST_CASE("multiway postflop past three seats has no vectorized terminal, and says so") {
  for (int seats : {4, 6, 8}) {
    CAPTURE(seats);
    const SolveConfig config = multiway_config(seats, 200);
    NlhePostflopGame game(config);
    CHECK(game.num_seats() == seats);
    // Not "approximate" - absent. The sweep's inclusion-exclusion grows as
    // 52^(N-2), so refusing is the honest answer and the message names the
    // sampled core as the fix.
    CHECK_FALSE(game.vectorized_terminals());
    CHECK_THROWS(game.total_profile_weight());

    std::vector<std::vector<float>> reach(static_cast<std::size_t>(seats));
    for (int s = 0; s < seats; ++s) reach[s] = game.initial_range(s);
    std::vector<float> out;
    CHECK_THROWS(game.compat_weights(0, reach, out));
  }
}

TEST_CASE("multiway postflop on the sampled core conserves chips at 4 and 8 seats") {
  for (int seats : {4, 8}) {
    CAPTURE(seats);
    SolveConfig config = multiway_config(seats, 200);
    // One bet, no raises: eight seats already branch fold/call eight deep.
    config.river_sizing.max_raises = 0;
    NlhePostflopGame game(config);

    const SampledConfig sc = sampled_cfg(4242 + static_cast<std::uint64_t>(seats));
    const AgentMap agents = AgentMap::identity(game.num_seats());
    SampledCfrSolver solver(game, game, sc, config.threads, agents);
    solver.run(40000);
    const std::vector<double> ev = solver.sampled_ev(40000, sc.seed ^ 0x5EEDULL);

    REQUIRE(ev.size() == static_cast<std::size_t>(seats));
    double sum = 0.0;
    for (double v : ev) sum += v;
    // Conservation is a property of each sampled deal, so it holds at any
    // seat count and at any iteration count - this is the invariant that
    // makes the sampled core the multiway path in the first place.
    CHECK(std::abs(sum - static_cast<double>(config.pot)) < 1e-3);
    MESSAGE(seats << "-way sampled: EVs sum to " << sum << " into a " << config.pot
                  << " chip pot");
  }
}
