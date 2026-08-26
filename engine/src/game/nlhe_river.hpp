#pragma once
#include <bit>
#include <cstdint>
#include <map>
#include <memory>
#include <vector>

#include "config/schema.hpp"
#include "eval/terminal.hpp"
#include "game/game.hpp"

namespace engine {

// Heads-up NLHE postflop game from any 3/4/5-card root board: betting rounds
// joined by chance nodes down to the river. Both seats' hand universes are
// the canonical 1326 combos (combos blocked by the ROOT board carry zero
// range; combos blocked by dealt runout cards are masked by the solver's
// chance-node reach masking). Seat 0 is OOP and acts first on every street.
class NlhePostflopGame final : public Game {
 public:
  explicit NlhePostflopGame(const SolveConfig& config);

  const PublicTree& tree() const override { return tree_; }
  int num_seats() const override { return 2; }
  int num_hands(int) const override { return kNumCombos; }
  const std::vector<float>& initial_range(int seat) const override { return ranges_[seat]; }
  bool hand_blocks_card(int, int hand, int card) const override {
    return (combo_mask(hand) & (1ULL << card)) != 0;
  }
  // Card removal from public information: 52 minus the cards on the board at
  // the chance node minus both seats' 4 hole cards (blocking of specific
  // hands is handled by reach masking).
  double chance_weight(NodeId id) const override {
    const int known = std::popcount(tree_[id].board_mask);
    return 1.0 / static_cast<double>(52 - known - 4);
  }
  double total_profile_weight() const override { return profile_weight_; }

  void terminal_values(NodeId id, int seat,
                       const std::vector<std::vector<float>>& reach,
                       std::vector<float>& out) const override;

  void compat_weights(int seat, const std::vector<std::vector<float>>& reach,
                      std::vector<float>& out) const override;

  std::vector<std::uint16_t> hand_dictionary(int) const override;

  const std::vector<Card>& board() const { return board_; }

 private:
  const RiverEvaluator& evaluator_for(std::uint64_t board_mask) const;

  PublicTree tree_;
  std::vector<Card> board_;      // root board (3-5 cards)
  std::uint64_t board_mask_ = 0;
  std::vector<std::uint8_t> valid_;  // combo valid vs. the ROOT board
  std::vector<std::vector<float>> ranges_;
  double profile_weight_ = 0.0;
  // Showdown machinery per completed 5-card board, built lazily: a flop tree
  // touches up to C(49,2) of these, each a sort + 1326 strengths.
  mutable std::map<std::uint64_t, std::unique_ptr<RiverEvaluator>> evaluators_;
};

}  // namespace engine
