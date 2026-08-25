#pragma once
#include <cstdint>
#include <vector>

#include "game/public_tree.hpp"

namespace engine {

// Bet sizing for one street. Sizes are percent of pot; raises are percent
// of the pot after a hypothetical call (Pio's convention). A computed size
// at or above allin_threshold * effective stack becomes all-in.
struct StreetSizing {
  std::vector<double> bets;
  std::vector<double> raises;
  double allin_threshold = 0.9;
  int max_raises = 3;
};

struct RiverTreeParams {
  Chips pot = 0;              // dead money at the root
  Chips effective_stack = 0;  // chips behind, equal for both seats this pass
  StreetSizing sizing;
};

// Build the 2-player river public tree. Seat 0 = OOP acts first.
// action_amount on Bet/CheckCall nodes is the actor's cumulative street
// commitment after the action (the bNNN convention consumed downstream:
// for a river-only solve, street-cumulative == postflop-cumulative).
PublicTree build_river_tree(const RiverTreeParams& params);

}  // namespace engine
