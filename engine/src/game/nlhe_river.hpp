#pragma once
#include <memory>
#include <vector>

#include "config/schema.hpp"
#include "eval/terminal.hpp"
#include "game/game.hpp"

namespace engine {

// Heads-up NLHE river game: 5-card board, both seats' hand universes are the
// canonical 1326 combos (board-blocked combos carry zero range). Seat 0 is
// OOP and acts first.
class NlheRiverGame final : public Game {
 public:
  explicit NlheRiverGame(const SolveConfig& config);

  const PublicTree& tree() const override { return tree_; }
  int num_seats() const override { return 2; }
  int num_hands(int) const override { return kNumCombos; }
  const std::vector<float>& initial_range(int seat) const override { return ranges_[seat]; }
  bool hand_blocks_card(int, int hand, int card) const override {
    return (combo_mask(hand) & (1ULL << card)) != 0;
  }
  double chance_weight(NodeId) const override { return 1.0; }  // no chance nodes on the river
  double total_profile_weight() const override { return profile_weight_; }

  void terminal_values(NodeId id, int seat,
                       const std::vector<std::vector<float>>& reach,
                       std::vector<float>& out) const override;

  void compat_weights(int seat, const std::vector<std::vector<float>>& reach,
                      std::vector<float>& out) const override {
    out.resize(kNumCombos);
    evaluator_->compat_reach(reach[1 - seat].data(), out.data());
  }

  std::vector<std::uint16_t> hand_dictionary(int) const override {
    std::vector<std::uint16_t> dict;
    for (int i = 0; i < kNumCombos; ++i) {
      if (evaluator_->valid(i)) dict.push_back(static_cast<std::uint16_t>(i));
    }
    return dict;
  }

  const RiverEvaluator& evaluator() const { return *evaluator_; }
  const std::vector<Card>& board() const { return board_; }

 private:
  PublicTree tree_;
  std::vector<Card> board_;
  std::unique_ptr<RiverEvaluator> evaluator_;
  std::vector<std::vector<float>> ranges_;
  double profile_weight_ = 0.0;
};

}  // namespace engine
