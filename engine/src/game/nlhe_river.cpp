#include "game/nlhe_river.hpp"

#include <bit>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <vector>

#include "game/betting_tree.hpp"
#include "ranges/range.hpp"
#include "util/parallel.hpp"

namespace engine {

NlhePostflopGame::NlhePostflopGame(const SolveConfig& config) {
  if (config.players.size() != 2) {
    throw std::runtime_error("NlhePostflopGame is 2-player (multiway lands in a later pass)");
  }
  board_ = parse_cards(config.board);
  board_mask_ = cards_mask(board_);

  // Parse both ranges over the canonical 1326 order, mask them against the
  // root board, and only then derive the universe - so a combo that survives
  // is one some seat can actually hold on this board.
  std::vector<std::vector<float>> canonical(2);
  for (int s = 0; s < 2; ++s) {
    canonical[s] = parse_range(config.players[s].range);
    mask_range_vs_board(canonical[s], board_mask_);
    float total = 0.0f;
    for (float w : canonical[s]) total += w;
    if (total <= 0.0f) {
      throw std::runtime_error("player " + config.players[s].seat +
                               " has an empty range after board card removal");
    }
  }
  universe_ = HandUniverse::from_ranges(canonical);
  for (int h = 0; h < universe_.size(); ++h) {
    blocking_[universe_.combos[static_cast<std::size_t>(h)].hi].push_back(
        static_cast<std::uint16_t>(h));
    blocking_[universe_.combos[static_cast<std::size_t>(h)].lo].push_back(
        static_cast<std::uint16_t>(h));
  }
  ranges_.resize(2);
  for (int s = 0; s < 2; ++s) ranges_[s] = universe_.compact(canonical[s]);

  // Profile normalizer: card-disjoint range products over the root board.
  {
    const int hands = universe_.size();
    const float* r1 = ranges_[1].data();
    double total1 = 0.0;
    double per_card[kNumCards] = {};
    const std::vector<Combo>& combos = universe_.combos;
    for (int i = 0; i < hands; ++i) {
      total1 += r1[i];
      per_card[combos[i].hi] += r1[i];
      per_card[combos[i].lo] += r1[i];
    }
    double z = 0.0;
    for (int i = 0; i < hands; ++i) {
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
  build_evaluators(config.threads);
}

void NlhePostflopGame::build_evaluators(int threads) {
  // Two passes on purpose. The keys go in serially so the map's structure is
  // frozen before any thread touches it; the values are then filled in
  // parallel, each thread writing one slot nobody else looks at.
  for (const Node& n : tree_.nodes) {
    if (n.terminal_kind != TerminalKind::Showdown) continue;
    evaluators_.emplace(n.board_mask, nullptr);
  }
  std::vector<std::map<std::uint64_t, std::unique_ptr<RiverEvaluator>>::iterator> slots;
  slots.reserve(evaluators_.size());
  for (auto it = evaluators_.begin(); it != evaluators_.end(); ++it) slots.push_back(it);

  ThreadPool pool(resolve_thread_count(threads));
  pool.parallel_for(static_cast<int>(slots.size()), [&](int i) {
    auto& slot = *slots[static_cast<std::size_t>(i)];
    std::vector<Card> cards;
    for (int c = 0; c < kNumCards; ++c) {
      if (slot.first & (1ULL << c)) cards.push_back(static_cast<Card>(c));
    }
    slot.second = std::make_unique<RiverEvaluator>(cards, universe_.combos);
  });
}

const RiverEvaluator& NlhePostflopGame::evaluator_for(std::uint64_t board_mask) const {
  const auto it = evaluators_.find(board_mask);
  if (it == evaluators_.end() || !it->second) {
    // Only reachable if a showdown terminal appeared after construction.
    throw std::runtime_error("no showdown evaluator for this board - tree changed after build");
  }
  return *it->second;
}

std::size_t NlhePostflopGame::auxiliary_bytes() const {
  // Per board: strengths (u32) + validity (u8) + the sorted index (int) +
  // tie groups (two ints), all over the valid slice of the 1326 combos.
  constexpr std::size_t kPerCombo = sizeof(std::uint32_t) + sizeof(std::uint8_t) +
                                    sizeof(std::uint64_t) + sizeof(Combo) + sizeof(int) +
                                    2 * sizeof(int);
  return evaluators_.size() * static_cast<std::size_t>(universe_.size()) * kPerCombo;
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
    const int hands = universe_.size();
    for (int i = 0; i < hands; ++i) out[i] = static_cast<float>(out[i] * u);
  } else {
    evaluator_for(node.board_mask).showdown_2p(opp, pot, my_delta, out.data());
  }
}

void NlhePostflopGame::compat_weights(int seat, const std::vector<std::vector<float>>& reach,
                                      std::vector<float>& out) const {
  // Inclusion-exclusion over the universe. Runout blocking needs no special
  // handling: blocked combos have zero reach.
  const int hands = universe_.size();
  const float* opp = reach[1 - seat].data();
  out.assign(static_cast<std::size_t>(hands), 0.0f);
  const std::vector<Combo>& combos = universe_.combos;
  double total = 0.0;
  double per_card[kNumCards] = {};
  for (int i = 0; i < hands; ++i) {
    total += opp[i];
    per_card[combos[i].hi] += opp[i];
    per_card[combos[i].lo] += opp[i];
  }
  for (int i = 0; i < hands; ++i) {
    out[i] = static_cast<float>(total - per_card[combos[i].hi] - per_card[combos[i].lo] + opp[i]);
  }
}

std::vector<std::uint16_t> NlhePostflopGame::hand_dictionary(int) const {
  return universe_.ids;
}

}  // namespace engine
