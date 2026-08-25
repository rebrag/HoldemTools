#include <doctest/doctest.h>

#include <random>

#include "eval/hand_eval.hpp"
#include "eval/terminal.hpp"

using namespace engine;

namespace {
std::uint32_t eval(const char* seven) {
  const std::vector<Card> cards = parse_cards(seven);
  REQUIRE(cards.size() == 7);
  return evaluate7(cards.data(), 7);
}
}  // namespace

TEST_CASE("7-card evaluator orders hand categories correctly") {
  // Straight flush > quads > full house > flush > straight > trips > two
  // pair > pair > high card.
  const auto sf = eval("Ah Kh Qh Jh Th 2c 3d");
  const auto quads = eval("As Ah Ad Ac Kh 2c 3d");
  const auto boat = eval("As Ah Ad Kc Kh 2c 3d");
  const auto flush = eval("Ah 9h 7h 5h 3h Kc 2d");
  const auto straight = eval("9c 8d 7h 6s 5c Ac 2d");
  const auto trips = eval("As Ah Ad Kc Qh 2c 3d");
  const auto two_pair = eval("As Ah Kd Kc Qh 2c 3d");
  const auto pair = eval("As Ah Kd Qc Jh 2c 3d");
  const auto high = eval("As Kh Qd Jc 9h 2c 3d");
  CHECK(sf > quads);
  CHECK(quads > boat);
  CHECK(boat > flush);
  CHECK(flush > straight);
  CHECK(straight > trips);
  CHECK(trips > two_pair);
  CHECK(two_pair > pair);
  CHECK(pair > high);
}

TEST_CASE("7-card evaluator handles wheels, kickers, and board ties") {
  // Wheel is the lowest straight.
  CHECK(eval("Ac 2d 3h 4s 5c Kd Qh") < eval("2c 3d 4h 5s 6c Kd Qh"));
  // Kicker decides between equal pairs.
  CHECK(eval("As Ah Kd Qc Jh 9c 3d") > eval("As Ah Kd Qc Th 9c 3d"));
  // Both players play the board: identical strengths.
  CHECK(eval("Ah Kh Qc Jd Tc 2s 3s") == eval("Ah Kh Qc Jd Tc 4d 5d"));
  // Two trips make a full house.
  CHECK(eval("As Ah Ad Kc Kh Kd 3d") == eval("Ac Ah Ad Ks Kh Kd 2c"));
  // Flush uses the best five of six suited cards.
  CHECK(eval("Ah Kh 9h 7h 5h 3h 2c") > eval("Ah Kh 9h 7h 4h 3h 2c"));
}

TEST_CASE("2p showdown sweep matches the brute-force reference") {
  const RiverEvaluator eval_river(parse_cards("Qs Jh 2h 8d 6c"));
  std::mt19937 rng(42);
  std::uniform_real_distribution<float> dist(0.0f, 1.0f);

  std::vector<float> reach(kNumCombos, 0.0f);
  for (int i = 0; i < kNumCombos; ++i) {
    if (eval_river.valid(i) && dist(rng) < 0.3f) reach[i] = dist(rng);
  }

  std::vector<float> fast(kNumCombos), slow(kNumCombos);
  const double pot = 120.0, delta = 35.0;
  eval_river.showdown_2p(reach.data(), pot, delta, fast.data());
  eval_river.showdown_2p_slow(reach.data(), pot, delta, slow.data());
  for (int i = 0; i < kNumCombos; ++i) {
    CHECK(fast[i] == doctest::Approx(slow[i]).epsilon(1e-4).scale(pot));
  }
}

TEST_CASE("side-pot shares are layered correctly") {
  // 3 seats, unequal commits: seat 1 is all-in short with the best hand.
  std::array<Chips, kMaxSeats> commit{};
  commit[0] = 100;
  commit[1] = 50;
  commit[2] = 100;
  const std::uint32_t strengths[3] = {500, 900, 700};
  const Chips dead = 30;

  // Layer 1 (to 50): 30 dead + 3x50 = 180, best overall is seat 1.
  // Layer 2 (50->100): 2x50 = 100 between seats 0 and 2; seat 2 is better.
  CHECK(showdown_share(1, 3, commit, dead, 0, strengths) == doctest::Approx(180.0));
  CHECK(showdown_share(2, 3, commit, dead, 0, strengths) == doctest::Approx(100.0));
  CHECK(showdown_share(0, 3, commit, dead, 0, strengths) == doctest::Approx(0.0));

  // A folded seat's chips stay in the layers as dead money.
  CHECK(showdown_share(1, 3, commit, dead, /*folded=*/1u << 2, strengths) ==
        doctest::Approx(180.0));
  CHECK(showdown_share(0, 3, commit, dead, 1u << 2, strengths) == doctest::Approx(100.0));

  // Ties split within a layer.
  const std::uint32_t tied[3] = {700, 900, 700};
  CHECK(showdown_share(0, 3, commit, dead, 0, tied) == doctest::Approx(50.0));
  CHECK(showdown_share(2, 3, commit, dead, 0, tied) == doctest::Approx(50.0));

  // Equal commits, heads-up: winner takes everything.
  std::array<Chips, kMaxSeats> equal{};
  equal[0] = 80;
  equal[1] = 80;
  const std::uint32_t hu[2] = {10, 20};
  CHECK(showdown_share(1, 2, equal, 40, 0, hu) == doctest::Approx(200.0));
  CHECK(showdown_share(0, 2, equal, 40, 0, hu) == doctest::Approx(0.0));
}
