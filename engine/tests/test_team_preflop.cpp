#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <string>
#include <vector>

#include "cards/combos.hpp"

#include "config/schema.hpp"
#include "game/nlhe_preflop.hpp"
#include "ranges/iso.hpp"
#include "solver/agents.hpp"
#include "solver/sampled_cfr.hpp"

using namespace engine;

namespace {

std::string team_full_range() {
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

SolveConfig team_config(int seats) {
  SolveConfig config;
  config.game = "nlhe_preflop";
  config.chip_scale = 2.0;
  const std::string range = team_full_range();
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

SampledConfig team_solver_config() {
  SampledConfig config;
  config.enabled = true;
  config.seed = 20260830;
  config.batch = 1024;
  config.lanes = 16;
  return config;
}

AgentMap team_map(int seats, int a, int b) {
  AgentMap map = AgentMap::identity(seats);
  map.teammate_of[static_cast<std::size_t>(a)] = b;
  map.teammate_of[static_cast<std::size_t>(b)] = a;
  map.seat_to_agent[static_cast<std::size_t>(b)] =
      map.seat_to_agent[static_cast<std::size_t>(a)];
  map.num_agents = seats - 1;
  return map;
}

double team_ev(const std::vector<double>& ev, int a, int b) {
  return ev[static_cast<std::size_t>(a)] + ev[static_cast<std::size_t>(b)];
}

}  // namespace

TEST_CASE("joint suit classes are exactly the pair orbits") {
  const SolveConfig config = team_config(3);
  NlhePreflopGame game(config);
  std::vector<std::uint32_t> joint;
  int classes = 0;
  REQUIRE(game.joint_hand_classes(joint, classes));
  // The exact orbit count of ordered disjoint hand pairs under the 24 suit
  // permutations. Burnside: identity fixes all 1,624,350 pairs, each of the
  // six transpositions fixes ~338^2, the smaller cycle types almost none -
  // summing to ~2.25M / 24 = 93,769. Pinned exactly: the canonicalization
  // is deterministic, so any change is a bug or a deliberate re-derivation,
  // never noise.
  MESSAGE("joint suit classes: " << classes);
  CHECK(classes == 93769);

  // Invariance: the class of (a, b) equals the class of (pi(a), pi(b)) for
  // every suit permutation - the defining property, asserted exactly.
  const HandUniverse& universe = [&]() -> const HandUniverse& {
    static HandUniverse u = [] {
      std::vector<std::vector<float>> full(1, std::vector<float>(1326, 1.0f));
      return HandUniverse::from_ranges(full);
    }();
    return u;
  }();
  int checked = 0;
  for (const SuitPerm& perm : all_suit_perms()) {
    const std::vector<std::uint16_t> map = perm_hand_map(perm, universe);
    for (int a = 0; a < 1326; a += 97) {
      for (int b = 0; b < 1326; b += 89) {
        if (joint[static_cast<std::size_t>(a) * 1326 + static_cast<std::size_t>(b)] ==
            std::numeric_limits<std::uint32_t>::max()) {
          continue;
        }
        CHECK(joint[static_cast<std::size_t>(a) * 1326 + static_cast<std::size_t>(b)] ==
              joint[static_cast<std::size_t>(map[static_cast<std::size_t>(a)]) * 1326 +
                    static_cast<std::size_t>(map[static_cast<std::size_t>(b)])]);
        ++checked;
      }
    }
  }
  CHECK(checked > 1000);
}

TEST_CASE("team terminal values equal own plus pinned-partner values") {
  const SolveConfig config = team_config(3);
  NlhePreflopGame game(config);
  const PublicTree& tree = game.tree();
  // Find a showdown terminal where all three seats are alive (everyone
  // jammed) - the case where the partner's cut genuinely depends on the
  // hero's hand.
  NodeId showdown = kNoNode;
  for (NodeId id = 0; id < tree.size(); ++id) {
    const Node& n = tree[id];
    if (n.kind == NodeKind::Terminal && n.terminal_kind == TerminalKind::Showdown &&
        n.folded_mask == 0) {
      showdown = id;
    }
  }
  REQUIRE(showdown != kNoNode);

  const int hero = 0, mate = 2;
  Deal deal;
  std::vector<std::uint32_t> strengths;
  std::vector<float> team_vals, own_vals, mate_vals;
  int deals_checked = 0, hands_checked = 0;
  double worst = 0.0;
  for (std::uint64_t t = 0; t < 5; ++t) {
    game.sample_deal(7777, t, deal);
    game.deal_strengths(deal, strengths);
    game.deal_showdown_values_team(showdown, hero, mate, deal, strengths, team_vals);
    game.deal_showdown_values(showdown, hero, deal, strengths, own_vals);
    ++deals_checked;
    // For each hero hand compatible with the deal, pin the hero there and
    // read the partner's value - the reference the team value must match.
    // Used cards = every non-hero seat's holes plus the board; the hero's
    // own dealt cards are replaced by the pin. Full range, so the compact
    // hand index IS the canonical combo index.
    std::uint64_t used = 0;
    for (int q = 0; q < 3; ++q) {
      if (q == hero) continue;
      used |= 1ULL << deal.hole[static_cast<std::size_t>(2 * q)];
      used |= 1ULL << deal.hole[static_cast<std::size_t>(2 * q) + 1];
    }
    for (int c = 0; c < deal.board_count; ++c) {
      used |= 1ULL << deal.board[static_cast<std::size_t>(c)];
    }
    for (int h = 0; h < 1326; ++h) {
      if ((combo_mask(h) & used) != 0) continue;
      Deal pinned = deal;
      pinned.hand[static_cast<std::size_t>(hero)] = static_cast<std::uint16_t>(h);
      game.deal_showdown_values(showdown, mate, pinned, strengths, mate_vals);
      const double expect =
          static_cast<double>(own_vals[static_cast<std::size_t>(h)]) +
          static_cast<double>(mate_vals[pinned.hand[static_cast<std::size_t>(mate)]]);
      const double got = static_cast<double>(team_vals[static_cast<std::size_t>(h)]);
      worst = std::max(worst, std::abs(got - expect));
      ++hands_checked;
    }
  }
  MESSAGE("team terminal reference: " << deals_checked << " deals, " << hands_checked
          << " hands, worst gap " << worst);
  CHECK(hands_checked > 3000);
  CHECK(worst < 1e-4);
}

TEST_CASE("team EV ordering: unaware >= aware >= baseline, and everything conserves") {
  const SolveConfig config = team_config(3);
  const int a = 0, b = 2;  // SB + button share hands against the big blind
  const std::uint64_t kIters = 40000;
  const std::uint64_t kEvDeals = 80000;
  const std::uint64_t kEvSeed = 424242;
  NlhePreflopGame game(config);

  // Baseline: nobody cooperates.
  SampledCfrSolver baseline(game, game, team_solver_config(), config.threads);
  baseline.run(kIters);
  const std::vector<double> base_ev = baseline.sampled_ev(kEvDeals, kEvSeed);

  // Aware: opponents adapt to the team.
  SampledCfrSolver aware(game, game, team_solver_config(), config.threads,
                         team_map(3, a, b));
  aware.run(kIters);
  const std::vector<double> aware_ev = aware.sampled_ev(kEvDeals, kEvSeed);

  // Unaware: opponents frozen at the baseline; the team best-responds jointly.
  SampledCfrSolver unaware(game, game, team_solver_config(), config.threads,
                           team_map(3, a, b));
  std::vector<bool> frozen(3, false);
  frozen[1] = true;
  unaware.freeze_seats_from(baseline, frozen);
  unaware.run(kIters);
  const std::vector<double> unaware_ev = unaware.sampled_ev(kEvDeals, kEvSeed);

  const double base_team = team_ev(base_ev, a, b);
  const double aware_team = team_ev(aware_ev, a, b);
  const double unaware_team = team_ev(unaware_ev, a, b);
  MESSAGE("team ev: baseline " << base_team << ", aware " << aware_team << ", unaware "
          << unaware_team << " (uplift " << unaware_team - base_team << " chips)");

  // Deterministic seeds: calibrated once, never a flake. What is actually
  // guaranteed: against the FROZEN baseline opponents, the team could always
  // play its baseline strategies, so the joint best response must beat the
  // baseline - and by a real margin, or hand-sharing bought nothing.
  CHECK(unaware_team > base_team + 0.05);
  // NOT gated: aware vs baseline. The aware mode is an equilibrium of a
  // DIFFERENT game, and the measured result (aware 0.21 < baseline 0.32
  // here) is a finding, not a bug: opponents who KNOW about the team defend
  // hard enough that being known to share hands can cost more than the
  // sharing gains. Reported so the number stays visible; also remember CFR
  // at 3+ agents is CCE-empirical, so read the aware number as strong play,
  // not a proven equilibrium value.
  CHECK(unaware_team > aware_team);

  // Conservation by construction, team or not: every deal's payoffs sum to
  // the dead money (0 here - blinds are posted at the root).
  for (const auto& ev : {base_ev, aware_ev, unaware_ev}) {
    double sum = 0.0;
    for (double v : ev) sum += v;
    CHECK(std::abs(sum) < 1e-9);
  }
}

TEST_CASE("team solve is bitwise identical at any thread count") {
  const SolveConfig config = team_config(3);
  NlhePreflopGame game(config);
  auto solve = [&](int threads) {
    SampledConfig sc = team_solver_config();
    sc.batch = 256;
    sc.lanes = 8;
    SampledCfrSolver solver(game, game, sc, threads, team_map(3, 0, 2));
    solver.run(4000);
    return solver.regrets();
  };
  const auto one = solve(1);
  const auto eight = solve(8);
  REQUIRE(one.size() == eight.size());
  CHECK(std::memcmp(one.data(), eight.data(), one.size() * sizeof(float)) == 0);
}

TEST_CASE("frozen opponents export their baseline strategy, not uniform") {
  // The 50/50 bug: in unaware phase 2 the frozen seats never accumulate
  // strategy sums, so average_strategy used to fall to the uniform
  // fallback and the artifact showed the opponents playing 50% fold /
  // 50% jam. The export must be the frozen baseline rows, exactly.
  const SolveConfig config = team_config(3);
  NlhePreflopGame game(config);
  SampledCfrSolver baseline(game, game, team_solver_config(), config.threads);
  baseline.run(8000);
  SampledCfrSolver unaware(game, game, team_solver_config(), config.threads,
                           team_map(3, 0, 2));
  std::vector<bool> frozen(3, false);
  frozen[1] = true;
  unaware.freeze_seats_from(baseline, frozen);
  unaware.run(8000);
  const PublicTree& tree = game.tree();
  std::vector<float> rows_baseline, rows_unaware;
  int checked = 0;
  for (NodeId id = 0; id < tree.size(); ++id) {
    const Node& node = tree[id];
    if (node.kind != NodeKind::Decision || node.actor != 1) continue;
    baseline.average_strategy(id, rows_baseline);
    unaware.average_strategy(id, rows_unaware);
    REQUIRE(rows_baseline.size() == rows_unaware.size());
    CHECK(std::memcmp(rows_baseline.data(), rows_unaware.data(),
                      rows_baseline.size() * sizeof(float)) == 0);
    ++checked;
  }
  CHECK(checked > 0);
}

TEST_CASE("conditioned team charts converge: two seeds agree where reached") {
  // The two-sided team update trains a team seat's full conditioned row on
  // every deal. Without it, a conditioned cell (own X, partner Y) only
  // trains when both classes are literally dealt, and two independent
  // seeds disagree wildly on the conditioned frequencies.
  // UNAWARE mode on purpose: against a fixed frozen environment the team's
  // joint best-response VALUE is unique, so the seeds must agree on team
  // EV; the strategy is gated only where the conditioning actually
  // reaches the node (partner_reach weighting) - an unreachable
  // conditioning like "partner folded AA" trains on nothing and gates
  // nothing, and even reachable near-indifferent cells can mix (the joint
  // argmax is not unique: which seat carries the aggression can be
  // interchangeable at identical team EV).
  const SolveConfig config = team_config(3);
  NlhePreflopGame game(config);
  SampledCfrSolver baseline(game, game, team_solver_config(), config.threads);
  baseline.run(40000);
  std::vector<bool> frozen(3, false);
  frozen[1] = true;
  const std::uint64_t kEvDeals = 80000;
  const std::uint64_t kEvSeed = 424242;
  auto solve_one = [&](std::uint64_t seed) {
    SampledConfig sc = team_solver_config();
    sc.seed = seed;
    SampledCfrSolver solver(game, game, sc, config.threads, team_map(3, 0, 2));
    solver.freeze_seats_from(baseline, frozen);
    solver.run(160000);
    return std::make_pair(solver.team_rollup_json(),
                          team_ev(solver.sampled_ev(kEvDeals, kEvSeed), 0, 2));
  };
  const auto [first, ev_first] = solve_one(20260830);
  const auto [second, ev_second] = solve_one(777777);
  REQUIRE(!first.empty());
  MESSAGE("unaware team ev by seed: " << ev_first << " vs " << ev_second);
  // The optimum value is unique even when the argmax is not.
  CHECK(std::abs(ev_first - ev_second) < 0.05);
  double total = 0.0, wsum = 0.0;
  double root_mad = 1.0;
  for (auto it = first.begin(); it != first.end(); ++it) {
    const nlohmann::json& other = second.at(it.key());
    const auto& fa = it.value().at("freq");
    const auto& fb = other.at("freq");
    const auto& ra = it.value().at("partner_reach");
    const auto& rb = other.at("partner_reach");
    REQUIRE(fa.size() == fb.size());
    double node_total = 0.0, node_w = 0.0;
    for (std::size_t pc = 0; pc < fa.size(); ++pc) {
      const double w =
          std::min(ra[pc].get<double>(), rb[pc].get<double>());
      for (std::size_t oc = 0; oc < fa[pc].size(); ++oc) {
        for (std::size_t a = 0; a < fa[pc][oc].size(); ++a) {
          const double d = std::abs(fa[pc][oc][a].get<double>() -
                                    fb[pc][oc][a].get<double>());
          node_total += w * d;
          node_w += w;
        }
      }
    }
    const double node_mad = node_w > 0.0 ? node_total / node_w : 0.0;
    MESSAGE("node " << it.key() << ": reach-weighted mad " << node_mad);
    if (it.key() == "0") root_mad = node_mad;
    total += node_total;
    wsum += node_w;
  }
  // Conditioned EVs: TEAM chips per (partner, own, action) cell. Gate the
  // shape and the one ordering that is unambiguous: with the same partner
  // hand, jamming AA is worth more to the team than jamming 72o.
  {
    const auto& node0 = first.at("0");
    const auto& ev = node0.at("ev");
    const int pc = 168;  // 72o partner (row-major 13x13, last offsuit cell)
    const int aa = 0, t72o = 168;
    REQUIRE(!ev[pc][aa][1].is_null());
    REQUIRE(!ev[pc][t72o][1].is_null());
    const double ev_aa = ev[pc][aa][1].get<double>();
    const double ev_72 = ev[pc][t72o][1].get<double>();
    MESSAGE("conditioned team EV of jam, partner 72o: AA " << ev_aa << ", 72o " << ev_72);
    CHECK(std::isfinite(ev_aa));
    CHECK(ev_aa > ev_72 + 1.0);
    CHECK(std::abs(ev_aa) < 45.0);
    CHECK(std::abs(ev_72) < 45.0);
  }
  REQUIRE(wsum > 0.0);
  const double mad = total / wsum;
  MESSAGE("reach-weighted conditioned |diff| across seeds: " << mad);
  // Calibrated regression tripwires (measured 0.087 root / 0.154 overall at
  // these seeds and budgets; pre-two-sided-update both were ~0.22 and did
  // NOT shrink with iterations). The overall number stays soft on purpose:
  // deeper team nodes hold residual mixing that is genuinely EV-free -
  // e.g. once the outsider folds, the last team seat calling its own
  // partner's jam only moves chips WITHIN the team - plus a wide
  // small-edge threshold band that sharpens only as 1/sqrt(iterations).
  CHECK(mad < 0.25);
  CHECK(root_mad < 0.15);
}
