#include <doctest/doctest.h>

#include <cstdint>
#include <random>
#include <vector>

#include "cards/cards.hpp"
#include "cards/combos.hpp"
#include "eval/terminal3.hpp"

using namespace engine;

namespace {

// A universe small enough for the O(H^3) reference to run, but built by
// taking every Nth canonical combo so it still carries mixed suits, blockers,
// board-pairing hands and real ties rather than a hand-picked easy set.
std::vector<Combo> strided_universe(int stride) {
  std::vector<Combo> out;
  const std::vector<Combo>& all = canonical_combos();
  for (std::size_t i = 0; i < all.size(); i += static_cast<std::size_t>(stride)) {
    out.push_back(all[i]);
  }
  return out;
}

std::vector<float> random_reach(std::size_t n, std::uint64_t seed, double zero_fraction) {
  std::mt19937_64 rng(seed);
  std::uniform_real_distribution<double> u(0.0, 1.0);
  std::vector<float> r(n);
  for (std::size_t i = 0; i < n; ++i) {
    r[i] = u(rng) < zero_fraction ? 0.0f : static_cast<float>(0.05 + u(rng));
  }
  return r;
}

void check_against_reference(const char* board_text, std::uint64_t seed, double zero_fraction) {
  const std::vector<Card> board = parse_cards(board_text);
  const std::vector<Combo> universe = strided_universe(17);
  const Showdown3 sd(board, universe);
  const std::size_t n = universe.size();

  const std::vector<float> r1 = random_reach(n, seed, zero_fraction);
  const std::vector<float> r2 = random_reach(n, seed + 1, zero_fraction);

  const double pot = 300.0;
  const double my_delta = 40.0;
  std::vector<float> fast(n), slow(n);
  sd.showdown(r1.data(), r2.data(), pot, my_delta, fast.data());
  sd.showdown_slow(r1.data(), r2.data(), pot, my_delta, slow.data());

  // Values run to thousands here (pot x pairwise reach mass), so the tolerance
  // is relative to the magnitude actually being compared.
  double scale = 1.0;
  for (std::size_t i = 0; i < n; ++i) scale = std::max(scale, std::abs(double{slow[i]}));
  for (std::size_t i = 0; i < n; ++i) {
    REQUIRE(std::abs(double{fast[i]} - double{slow[i]}) <= 1e-4 * scale);
  }
}

}  // namespace

TEST_CASE("3-way showdown sweep matches the showdown_share reference") {
  // Rainbow, no pairs: the plain case.
  check_against_reference("Qs Jh 2h 8d 6c", 12345, 0.0);
  // Paired board: many hands share a strength, so the tie terms carry real
  // mass instead of being a rounding detail.
  check_against_reference("9c 9d 5h 5s 2c", 999, 0.0);
  // Four to a flush: a large tie group plus heavy suit blocking.
  check_against_reference("Ah Kh 7h 3h 2c", 4242, 0.0);
  // Board plays: the three-way tie term dominates.
  check_against_reference("Ac Kd Qh Js Ts", 77, 0.0);
}

TEST_CASE("3-way showdown sweep is exact with sparse ranges") {
  // Zero-reach hands must not leak into the inclusion-exclusion: they are
  // still in the universe and still block, they just carry no mass.
  check_against_reference("Qs Jh 2h 8d 6c", 555, 0.6);
  check_against_reference("9c 9d 5h 5s 2c", 556, 0.85);
}

TEST_CASE("3-way compat weight is the pairwise disjoint mass") {
  const std::vector<Card> board = parse_cards("Qs Jh 2h 8d 6c");
  const std::vector<Combo> universe = strided_universe(17);
  const Showdown3 sd(board, universe);
  const std::size_t n = universe.size();
  const std::vector<float> r1 = random_reach(n, 31337, 0.0);
  const std::vector<float> r2 = random_reach(n, 31338, 0.0);

  std::vector<float> compat(n);
  sd.compat(r1.data(), r2.data(), compat.data());

  // A pot of 0 leaves showdown() returning exactly -compat * my_delta, so the
  // normalizer is gated by the same reference as the values.
  std::vector<float> only_delta(n);
  sd.showdown(r1.data(), r2.data(), 0.0, 1.0, only_delta.data());

  double scale = 1.0;
  for (std::size_t i = 0; i < n; ++i) scale = std::max(scale, double{compat[i]});
  for (std::size_t i = 0; i < n; ++i) {
    if (!sd.valid(static_cast<int>(i))) continue;
    REQUIRE(std::abs(double{only_delta[i]} + double{compat[i]}) <= 1e-4 * scale);
  }

  // And it agrees with a direct count over disjoint triples.
  for (std::size_t i = 0; i < n; i += 23) {
    if (!sd.valid(static_cast<int>(i))) continue;
    double want = 0.0;
    for (std::size_t a = 0; a < n; ++a) {
      if (!sd.valid(static_cast<int>(a))) continue;
      if (universe[a].hi == universe[i].hi || universe[a].hi == universe[i].lo ||
          universe[a].lo == universe[i].hi || universe[a].lo == universe[i].lo) {
        continue;
      }
      for (std::size_t b = 0; b < n; ++b) {
        if (!sd.valid(static_cast<int>(b))) continue;
        const Combo& hb = universe[b];
        if (hb.hi == universe[i].hi || hb.hi == universe[i].lo || hb.lo == universe[i].hi ||
            hb.lo == universe[i].lo) {
          continue;
        }
        if (hb.hi == universe[a].hi || hb.hi == universe[a].lo || hb.lo == universe[a].hi ||
            hb.lo == universe[a].lo) {
          continue;
        }
        want += double{r1[a]} * r2[b];
      }
    }
    REQUIRE(std::abs(want - double{compat[i]}) <= 1e-4 * scale);
  }
}
