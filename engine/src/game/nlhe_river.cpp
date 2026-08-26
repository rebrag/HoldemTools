#include "game/nlhe_river.hpp"

#include <bit>
#include <cstdint>
#include <stdexcept>

#include "game/betting_tree.hpp"
#include "ranges/range.hpp"

namespace engine {

NlhePostflopGame::NlhePostflopGame(const SolveConfig& config) {
  if (config.players.size() != 2) {
    throw std::runtime_error("NlhePostflopGame is 2-player (multiway lands in a later pass)");
  }
  board_ = parse_cards(config.board);
  board_mask_ = cards_mask(board_);

  valid_.assign(kNumCombos, 0);
  for (int i = 0; i < kNumCombos; ++i) {
    valid_[i] = (combo_mask(i) & board_mask_) ? 0 : 1;
  }

  ranges_.resize(2);
  for (int s = 0; s < 2; ++s) {
    ranges_[s] = parse_range(config.players[s].range);
    mask_range_vs_board(ranges_[s], board_mask_);
    float total = 0.0f;
    for (float w : ranges_[s]) total += w;
    if (total <= 0.0f) {
      throw std::runtime_error("player " + config.players[s].seat +
                               " has an empty range after board card removal");
    }
  }

  // Profile normalizer: card-disjoint range products over the root board.
  {
    std::vector<float> compat(kNumCombos);
    const float* r1 = ranges_[1].data();
    double total1 = 0.0;
    double per_card[kNumCards] = {};
    const std::vector<Combo>& combos = canonical_combos();
    for (int i = 0; i < kNumCombos; ++i) {
      if (!valid_[i]) continue;
      total1 += r1[i];
      per_card[combos[i].hi] += r1[i];
      per_card[combos[i].lo] += r1[i];
    }
    double z = 0.0;
    for (int i = 0; i < kNumCombos; ++i) {
      if (!valid_[i]) continue;
      z += static_cast<double>(ranges_[0][i]) *
           (total1 - per_card[combos[i].hi] - per_card[combos[i].lo] + r1[i]);
    }
    profile_weight_ = z;
  }
  if (profile_weight_ <= 0.0) {
    throw std::runtime_error("the two ranges have no card-disjoint combo pairs");
  }

  PostflopTreeParams params;
  params.pot = config.pot;
  params.effective_stack = config.players[0].stack;
  params.board_mask = board_mask_;
  params.start_street = board_.size() == 3   ? Street::Flop
                        : board_.size() == 4 ? Street::Turn
                                             : Street::River;
  params.preflop_aggressor = config.preflop_aggressor;
  params.flop = config.flop_sizing;
  params.turn = config.turn_sizing;
  params.river = config.river_sizing;
  tree_ = build_postflop_tree(params);
}

const RiverEvaluator& NlhePostflopGame::evaluator_for(std::uint64_t board_mask) const {
  auto it = evaluators_.find(board_mask);
  if (it == evaluators_.end()) {
    std::vector<Card> cards;
    for (int c = 0; c < kNumCards; ++c) {
      if (board_mask & (1ULL << c)) cards.push_back(static_cast<Card>(c));
    }
    it = evaluators_.emplace(board_mask, std::make_unique<RiverEvaluator>(cards)).first;
  }
  return *it->second;
}

void NlhePostflopGame::terminal_values(NodeId id, int seat,
                                       const std::vector<std::vector<float>>& reach,
                                       std::vector<float>& out) const {
  const Node& node = tree_[id];
  const float* opp = reach[1 - seat].data();
  const double my_delta = static_cast<double>(node.commit[seat]);
  const double pot = static_cast<double>(node.pot);
  if (node.terminal_kind == TerminalKind::Fold) {
    // Fold utility depends only on compatibility: hands blocked by dealt
    // runout cards already carry zero reach on both sides.
    compat_weights(seat, reach, out);
    const double u = node.fold_winner == seat ? pot - my_delta : -my_delta;
    for (int i = 0; i < kNumCombos; ++i) out[i] = static_cast<float>(out[i] * u);
  } else {
    evaluator_for(node.board_mask).showdown_2p(opp, pot, my_delta, out.data());
  }
}

void NlhePostflopGame::compat_weights(int seat, const std::vector<std::vector<float>>& reach,
                                      std::vector<float>& out) const {
  // Inclusion-exclusion over the ROOT-board-valid universe. Runout blocking
  // needs no special handling: blocked combos have zero reach.
  const float* opp = reach[1 - seat].data();
  out.assign(kNumCombos, 0.0f);
  const std::vector<Combo>& combos = canonical_combos();
  double total = 0.0;
  double per_card[kNumCards] = {};
  for (int i = 0; i < kNumCombos; ++i) {
    if (!valid_[i]) continue;
    total += opp[i];
    per_card[combos[i].hi] += opp[i];
    per_card[combos[i].lo] += opp[i];
  }
  for (int i = 0; i < kNumCombos; ++i) {
    if (!valid_[i]) continue;
    out[i] = static_cast<float>(total - per_card[combos[i].hi] - per_card[combos[i].lo] + opp[i]);
  }
}

std::vector<std::uint16_t> NlhePostflopGame::hand_dictionary(int) const {
  std::vector<std::uint16_t> dict;
  for (int i = 0; i < kNumCombos; ++i) {
    if (valid_[i]) dict.push_back(static_cast<std::uint16_t>(i));
  }
  return dict;
}

}  // namespace engine
