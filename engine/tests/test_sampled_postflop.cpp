#include <doctest/doctest.h>

#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <limits>
#include <set>
#include <string>
#include <vector>

#include "cards/cards.hpp"
#include "cards/combos.hpp"
#include "config/schema.hpp"
#include "eval/hand_eval.hpp"
#include "game/nlhe_river.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"
#include "solver/sampled_cfr.hpp"

// The sampled-deal core on HEADS-UP POSTFLOP trees: the comparison path that
// lets /compare race it against the vectorized core. Everything here is
// deterministic (counter-based deals), so thresholds are pinned, not fuzzy.

using namespace engine;

namespace {

constexpr std::uint16_t kSentinel = std::numeric_limits<std::uint16_t>::max();

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

// About a quarter of the deck: pairs, suited aces, big broadways, a few
// suited connectors. Wide enough that a uniform deal lands inside it often
// (the sampled core's effective sample size IS that rate), narrow enough
// that a turn tree over it stays small.
const char* kWideRange =
    "AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,"
    "AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,"
    "AKo,AQo,AJo,ATo,KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,KQo";

SolveConfig postflop_config(const std::string& board, const std::string& oop,
                            const std::string& ip) {
  SolveConfig config;
  config.game = "nlhe";
  config.board = board;
  config.pot = 100;
  config.isomorphism = false;  // the sampled core has no iso redirect
  config.players = {{"OOP", 200, oop}, {"IP", 200, ip}};
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

SampledConfig sampled_cfg(std::uint64_t seed, std::uint32_t batch, std::uint32_t lanes) {
  SampledConfig config;
  config.enabled = true;
  config.seed = seed;
  config.batch = batch;
  config.lanes = lanes;
  return config;
}

RecalcConfig recalc_off() {
  RecalcConfig r;
  r.enabled = false;
  return r;
}

std::filesystem::path temp_config(const std::string& name, const std::string& body) {
  const std::filesystem::path dir =
      std::filesystem::temp_directory_path() / "engine_sampled_postflop";
  std::filesystem::create_directories(dir);
  const std::filesystem::path path = dir / (name + ".json");
  std::ofstream out(path);
  out << body;
  return path;
}

}  // namespace

TEST_CASE("sampled core converges on a heads-up river toward the vectorized solution") {
  const SolveConfig config = postflop_config("9c 5d Jc 7s 2h", full_range(), full_range());
  NlhePostflopGame game(config);

  // The exact reference: the vectorized core to well under the accuracy
  // target - this is the solve PioSolver validated.
  CfrSolver reference(game, UpdateConfig{}, config.threads, recalc_off());
  reference.run(600);
  const BrResult ref = compute_best_response(game, reference);
  REQUIRE(ref.nashconv() < 0.2);

  SampledCfrSolver solver(game, game, sampled_cfg(1, 4096, 4), config.threads);
  solver.run(100000);
  const BrResult early = compute_best_response(game, solver);
  solver.run(300000);
  const BrResult late = compute_best_response(game, solver);
  MESSAGE("sampled river: nashconv " << early.nashconv() << " -> " << late.nashconv()
                                     << " chips, ev " << late.ev[0] << " / " << late.ev[1]
                                     << " (vectorized " << ref.ev[0] << " / " << ref.ev[1] << ")");
  // Stochastic convergence: loosely on level, strictly on direction, and the
  // root EVs must land beside the exact solve's.
  CHECK(late.nashconv() >= 0.0);
  CHECK(late.nashconv() < 15.0);
  CHECK(late.nashconv() < early.nashconv());
  CHECK(std::abs(late.ev[0] - ref.ev[0]) < 2.0);
  CHECK(std::abs(late.ev[1] - ref.ev[1]) < 2.0);
  CHECK(late.ev[0] + late.ev[1] == doctest::Approx(100.0).epsilon(1e-6));

  // The sampled EV pass rates the same average strategy the best response
  // just rated, so it must agree with those EVs and conserve exactly.
  const std::vector<double> ev = solver.sampled_ev(100000, 99);
  REQUIRE(ev.size() == 2);
  CHECK(std::abs(ev[0] - late.ev[0]) < 1.0);
  CHECK(ev[0] + ev[1] == doctest::Approx(100.0).epsilon(1e-6));
}

TEST_CASE("sampled core walks a turn tree's chance node and keeps converging") {
  const SolveConfig config = postflop_config("Qs Jh 2h 8d", kWideRange, kWideRange);
  NlhePostflopGame game(config);
  SampledCfrSolver solver(game, game, sampled_cfg(3, 4096, 4), config.threads);
  solver.run(50000);
  const BrResult early = compute_best_response(game, solver);
  solver.run(250000);
  const BrResult late = compute_best_response(game, solver);
  MESSAGE("sampled turn: nashconv " << early.nashconv() << " -> " << late.nashconv()
                                    << " chips, ev " << late.ev[0] << " / " << late.ev[1]);
  CHECK(late.nashconv() >= 0.0);
  CHECK(late.nashconv() < early.nashconv());
  CHECK(late.ev[0] + late.ev[1] == doctest::Approx(100.0).epsilon(1e-6));
  const std::vector<double> ev = solver.sampled_ev(100000, 5);
  CHECK(std::abs(ev[0] - late.ev[0]) < 1.0);
  CHECK(ev[0] + ev[1] == doctest::Approx(100.0).epsilon(1e-6));
}

TEST_CASE("postflop DealGame contract on a flop tree, and the EV walk across two streets") {
  // Tight asymmetric ranges on purpose: dealt combos outside the universe
  // must resolve to the sentinel, and the flop tree stays small.
  const SolveConfig config =
      postflop_config("Qs Jh 2h", "AA,KK,QQ,AKs,A5s,KQs,76s", "JJ,TT,99,AQs,KQs,T9s");
  NlhePostflopGame game(config);
  const std::uint64_t root_mask = cards_mask(parse_cards(config.board));
  const int hands = game.num_hands(0);
  const std::vector<std::uint16_t> dictionary = game.hand_dictionary(0);

  Deal deal;
  std::vector<std::uint32_t> strengths;
  int sentinels = 0;
  for (std::uint64_t t = 0; t < 2000; ++t) {
    game.sample_deal(11, t, deal);
    REQUIRE(deal.hole_per_seat == 2);
    REQUIRE(deal.board_count == 2);
    // Six distinct cards, none of them on the root board.
    std::set<int> cards;
    for (int i = 0; i < 4; ++i) cards.insert(deal.hole[static_cast<std::size_t>(i)]);
    for (int i = 0; i < 2; ++i) cards.insert(deal.board[static_cast<std::size_t>(i)]);
    REQUIRE(cards.size() == 6);
    for (int c : cards) REQUIRE((root_mask & (1ULL << c)) == 0);
    for (int s = 0; s < 2; ++s) {
      const Card a = deal.hole[static_cast<std::size_t>(2 * s)];
      const Card b = deal.hole[static_cast<std::size_t>(2 * s) + 1];
      const int idx = combo_index(a, b);
      const std::uint16_t h = deal.hand[static_cast<std::size_t>(s)];
      // In the universe iff some seat's range carries the combo.
      bool in_universe = false;
      for (int u = 0; u < hands; ++u) {
        if (dictionary[static_cast<std::size_t>(u)] == idx) {
          in_universe = true;
          REQUIRE(h == static_cast<std::uint16_t>(u));
        }
      }
      if (!in_universe) {
        REQUIRE(h == kSentinel);
        ++sentinels;
      }
    }
    if (t < 8) {
      // Strengths are the 7-card evaluation on root + runout, 0 when blocked.
      game.deal_strengths(deal, strengths);
      REQUIRE(static_cast<int>(strengths.size()) == hands);
      std::vector<Card> board = parse_cards(config.board);
      board.push_back(static_cast<Card>(deal.board[0]));
      board.push_back(static_cast<Card>(deal.board[1]));
      const std::uint64_t full = cards_mask(board);
      for (int h = 0; h < hands; ++h) {
        const Combo& combo = canonical_combos()[dictionary[static_cast<std::size_t>(h)]];

        const std::uint64_t mask = (1ULL << combo.hi) | (1ULL << combo.lo);
        if ((mask & full) != 0) {
          CHECK(strengths[static_cast<std::size_t>(h)] == 0);
          continue;
        }
        Card seven[7];
        for (int i = 0; i < 5; ++i) seven[i] = board[static_cast<std::size_t>(i)];
        seven[5] = combo.hi;
        seven[6] = combo.lo;
        CHECK(strengths[static_cast<std::size_t>(h)] == evaluate7(seven, 7));
      }
    }
  }
  // Two 3%-ish ranges: nearly every uniform deal lands outside one of them.
  CHECK(sentinels > 3000);

  // Per-deal conservation at every showdown terminal, with both seats pinned
  // to universe hands: hero's share plus the pinned opponent's share is the
  // pot minus both commitments.
  {
    Deal pinned;
    double weight = 0.0;
    REQUIRE(game.sample_ev_deal(21, 0, pinned, weight));
    REQUIRE(weight > 0.0);
    REQUIRE(pinned.hand[0] != kSentinel);
    REQUIRE(pinned.hand[1] != kSentinel);
    game.deal_strengths(pinned, strengths);
    std::vector<float> v0, v1;
    std::vector<double> both;
    int checked = 0;
    const PublicTree& tree = game.tree();
    for (NodeId id = 0; id < tree.size(); ++id) {
      const Node& node = tree[id];
      if (node.kind != NodeKind::Terminal || node.terminal_kind != TerminalKind::Showdown) continue;
      const std::uint64_t needed = node.board_mask & ~root_mask;
      const std::uint64_t dealt = (1ULL << pinned.board[0]) | (1ULL << pinned.board[1]);
      if ((needed & ~dealt) != 0) continue;  // a runout this deal did not produce
      game.deal_showdown_values(id, 0, pinned, strengths, v0);
      game.deal_showdown_values(id, 1, pinned, strengths, v1);
      game.deal_showdown_pinned(id, pinned, strengths, 2, both);
      const double expect = static_cast<double>(node.pot) -
                            static_cast<double>(node.commit[0]) -
                            static_cast<double>(node.commit[1]);
      CHECK(static_cast<double>(v0[pinned.hand[0]]) + static_cast<double>(v1[pinned.hand[1]]) ==
            doctest::Approx(expect).epsilon(1e-6));
      CHECK(both[0] + both[1] == doctest::Approx(expect).epsilon(1e-9));
      CHECK(both[0] == doctest::Approx(static_cast<double>(v0[pinned.hand[0]])).epsilon(1e-6));
      ++checked;
    }
    CHECK(checked > 0);
  }

  // The EV walk must follow the turn card at the first chance level and the
  // river card at the second (it matched board[0] at both before), and its
  // range-proportional dealing must reproduce the exact best-response EVs of
  // whatever strategy the solver holds.
  SampledCfrSolver solver(game, game, sampled_cfg(7, 512, 4), config.threads);
  solver.run(20000);
  const BrResult br = compute_best_response(game, solver);
  const std::vector<double> ev = solver.sampled_ev(100000, 13);
  MESSAGE("flop EV pass " << ev[0] << " / " << ev[1] << " vs best response " << br.ev[0] << " / "
                          << br.ev[1]);
  CHECK(std::abs(ev[0] - br.ev[0]) < 0.6);
  CHECK(ev[0] + ev[1] == doctest::Approx(100.0).epsilon(1e-6));
}

TEST_CASE("sampled postflop is bitwise identical at any thread count") {
  auto solve = [](int threads) {
    const SolveConfig config =
        postflop_config("Qs Jh 2h", "AA,KK,QQ,AKs,A5s,KQs,76s", "JJ,TT,99,AQs,KQs,T9s");
    NlhePostflopGame game(config);
    SampledCfrSolver solver(game, game, sampled_cfg(7, 64, 8), threads);
    solver.run(5000);
    return std::make_pair(solver.regrets(), solver.strategy_sums());
  };
  const auto one = solve(1);
  const auto eight = solve(8);
  REQUIRE(one.first.size() == eight.first.size());
  REQUIRE(!one.first.empty());
  CHECK(std::memcmp(one.first.data(), eight.first.data(), one.first.size() * sizeof(float)) == 0);
  CHECK(std::memcmp(one.second.data(), eight.second.data(),
                    one.second.size() * sizeof(float)) == 0);
}

TEST_CASE("config: the sampled family runs postflop nlhe only without isomorphism") {
  const std::string head = R"({
    "game": "nlhe", "board": "9c 5d Jc 7s 2h", "pot": 100,
    "players": [ { "seat": "OOP", "stack": 200, "range": "AA,KK" },
                 { "seat": "IP",  "stack": 200, "range": "QQ,JJ" } ],
    "bet_sizing": { "river": { "bets": [50], "raises": [100], "max_raises": 1 } },
    "budget": { "iterations": 10 },)";

  // Explicit iso on: refused, and the message names the knob.
  {
    const auto path = temp_config("iso_on", head + R"(
      "algorithm": { "family": "sampled" }, "isomorphism": true })");
    CHECK_THROWS_WITH_AS(load_config(path.string()), doctest::Contains("isomorphism"),
                         std::runtime_error);
  }
  // Explicit off and absent both load, and the parsed config says off.
  for (const char* iso : {R"(, "isomorphism": false)", ""}) {
    const auto path = temp_config(std::string("iso_off") + (iso[0] ? "_explicit" : "_absent"),
                                  head + R"( "algorithm": { "family": "sampled" })" + iso + " }");
    const SolveConfig config = load_config(path.string());
    CHECK(config.sampled.enabled);
    CHECK_FALSE(config.isomorphism);
    CHECK_FALSE(config.recalc.enabled);
  }
  // The suit quotient is a preflop thing: asking for it on a board is refused.
  {
    const auto path = temp_config("symmetry", head + R"(
      "algorithm": { "family": "sampled", "sampled": { "symmetry": true } } })");
    CHECK_THROWS_WITH_AS(load_config(path.string()), doctest::Contains("symmetry"),
                         std::runtime_error);
  }
  // The vectorized family is untouched by any of this: iso stays on by default.
  {
    const auto path = temp_config("vectorized", head + R"( "algorithm": { "update": "dcfr" } })");
    const SolveConfig config = load_config(path.string());
    CHECK_FALSE(config.sampled.enabled);
    CHECK(config.isomorphism);
  }
}
