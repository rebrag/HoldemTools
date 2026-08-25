#pragma once
#include <array>
#include <cstdint>
#include <utility>
#include <vector>

#include "cards/combos.hpp"
#include "game/types.hpp"

namespace engine {

// Showdown machinery for one river board over the canonical 1326 combo
// universe. Terminal showdown evaluation with card removal is the hot path:
// the 2-player path is the standard sort-by-strength single sweep with
// inclusion-exclusion blocker correction, O(H) per call after an O(H log H)
// setup per board.
//
// OPTIMIZATION SEAM (multiway): for 3+ players the blocker problem is
// multi-way and the fast sweep does not directly apply. showdown_share()
// below is the correct-but-slow building block; a vectorized multiway
// terminal pass should be built against its outputs when M8 lands.
class RiverEvaluator {
 public:
  explicit RiverEvaluator(const std::vector<Card>& board);

  bool valid(int combo) const { return valid_[combo] != 0; }
  std::uint32_t strength(int combo) const { return strength_[combo]; }

  // Counterfactual showdown values for the hero against one opponent range:
  // out[h] = sum over compatible opponent combos o of
  //          reach[o] * (win ? pot : tie ? pot/2 : 0)  -  R(h) * my_delta
  // where R(h) is the total compatible opponent reach and my_delta is the
  // hero's post-root commitment. out[h] = 0 for combos blocked by the board.
  void showdown_2p(const float* opp_reach, double pot, double my_delta, float* out) const;

  // Brute-force O(H^2) reference implementation for tests.
  void showdown_2p_slow(const float* opp_reach, double pot, double my_delta, float* out) const;

  // out[h] = total opponent reach compatible with combo h (fold terminals,
  // conditional-EV normalization).
  void compat_reach(const float* opp_reach, float* out) const;

  // Sum over disjoint combo pairs of r0[i] * r1[j] (profile normalizer).
  double total_profile_weight_2p(const float* r0, const float* r1) const;

 private:
  std::uint64_t board_mask_ = 0;
  std::vector<std::uint32_t> strength_;
  std::vector<std::uint8_t> valid_;
  std::vector<int> sorted_;                       // valid combos, ascending strength
  std::vector<std::pair<int, int>> groups_;       // tie groups as [begin, end) into sorted_
};

// Side-pot-correct share of the pot for `seat` at a multiway showdown.
// `commit` is each seat's post-root contribution (folded seats included -
// their chips are dead money in the layers they reach), `dead` is the pot
// already in the middle at the root, `folded_mask` marks folded seats, and
// `strengths[s]` is each alive seat's hand strength. Correct-but-slow
// reference; also the ground truth the multiway fast path must match.
double showdown_share(int seat, int num_seats, const std::array<Chips, kMaxSeats>& commit,
                      Chips dead, std::uint16_t folded_mask, const std::uint32_t* strengths);

}  // namespace engine
