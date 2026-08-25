#include "game/nlhe_river.hpp"

#include <stdexcept>

#include "game/betting_tree.hpp"
#include "ranges/range.hpp"

namespace engine {

NlheRiverGame::NlheRiverGame(const SolveConfig& config) {
  if (config.players.size() != 2) {
    throw std::runtime_error("NlheRiverGame is 2-player (multiway lands in a later pass)");
  }
  board_ = parse_cards(config.board);
  evaluator_ = std::make_unique<RiverEvaluator>(board_);

  const std::uint64_t board_mask = cards_mask(board_);
  ranges_.resize(2);
  for (int s = 0; s < 2; ++s) {
    ranges_[s] = parse_range(config.players[s].range);
    mask_range_vs_board(ranges_[s], board_mask);
    float total = 0.0f;
    for (float w : ranges_[s]) total += w;
    if (total <= 0.0f) {
      throw std::runtime_error("player " + config.players[s].seat +
                               " has an empty range after board card removal");
    }
  }
  profile_weight_ = evaluator_->total_profile_weight_2p(ranges_[0].data(), ranges_[1].data());
  if (profile_weight_ <= 0.0) {
    throw std::runtime_error("the two ranges have no card-disjoint combo pairs");
  }

  RiverTreeParams params;
  params.pot = config.pot;
  params.effective_stack = config.players[0].stack;
  params.sizing = config.river_sizing;
  tree_ = build_river_tree(params);
}

void NlheRiverGame::terminal_values(NodeId id, int seat,
                                    const std::vector<std::vector<float>>& reach,
                                    std::vector<float>& out) const {
  const Node& node = tree_[id];
  const float* opp = reach[1 - seat].data();
  const double my_delta = static_cast<double>(node.commit[seat]);
  const double pot = static_cast<double>(node.pot);
  if (node.terminal_kind == TerminalKind::Fold) {
    evaluator_->compat_reach(opp, out.data());
    const double u = node.fold_winner == seat ? pot - my_delta : -my_delta;
    for (int i = 0; i < kNumCombos; ++i) out[i] = static_cast<float>(out[i] * u);
  } else {
    evaluator_->showdown_2p(opp, pot, my_delta, out.data());
  }
}

}  // namespace engine
