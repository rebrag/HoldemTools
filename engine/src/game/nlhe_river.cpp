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
  iso_rep_.resize(tree_.size());
  for (NodeId id = 0; id < tree_.size(); ++id) iso_rep_[id] = id;
  iso_perm_.assign(tree_.size(), 0);
  if (config.isomorphism) build_isomorphism();
  build_evaluators(config.threads);
}

// Group each live chance node's children into suit-equivalence classes and
// map every member subtree node onto its representative's corresponding
// node. A permutation is usable at a chance node iff it maps that node's
// board to itself AND both ranges are invariant under it - the subtree under
// pi(c) is then the subtree under c with hands relabeled by pi, so only the
// representative is ever solved and members read its data through iso_rep().
//
// Processing nodes in id order matters twice over: a parent chance node has
// a smaller id than any chance node inside its subtrees, so by the time an
// inner chance node is visited we already know whether it lives inside a
// member subtree (and must be skipped - its rep's inner node does the
// grouping for both); and choosing the lowest card as representative makes
// every rep child precede its members in child order, which the solver's
// fold loop relies on.
void NlhePostflopGame::build_isomorphism() {
  const std::vector<SuitPerm> perms = all_suit_perms();
  std::vector<const SuitPerm*> invariant;
  for (const SuitPerm& p : perms) {
    if (ranges_invariant(p, universe_, ranges_)) invariant.push_back(&p);
  }
  if (invariant.empty()) return;  // e.g. an explicit-combo range - correct fallback

  for (NodeId id = 0; id < tree_.size(); ++id) {
    if (tree_[id].kind != NodeKind::Chance) continue;
    if (iso_rep_[id] != id) continue;  // inside a member subtree; rep handles it
    const Node& node = tree_[id];

    std::vector<const SuitPerm*> usable;
    for (const SuitPerm* p : invariant) {
      if (perm_fixes_mask(*p, node.board_mask)) usable.push_back(p);
    }
    if (usable.empty()) continue;

    // Children are in ascending card order; the first unclaimed card of each
    // class is its representative.
    for (std::uint16_t c = 0; c < node.num_children; ++c) {
      const NodeId child = node.first_child + c;
      if (iso_rep_[child] != child) continue;  // already claimed as a member
      const int card = tree_[child].dealt_card;
      for (const SuitPerm* p : usable) {
        const int image = perm_card(*p, static_cast<Card>(card));
        if (image == card) continue;
        // Locate the sibling dealing `image` (contiguous, card-ascending).
        NodeId member = kNoNode;
        for (std::uint16_t m = c + 1; m < node.num_children; ++m) {
          if (tree_[node.first_child + m].dealt_card == image) {
            member = node.first_child + m;
            break;
          }
        }
        if (member == kNoNode || iso_rep_[member] != member) continue;
        // Register (or reuse) the hand gather for this permutation.
        std::uint16_t perm_id = 0xFFFF;
        const std::vector<std::uint16_t> map = perm_hand_map(*p, universe_);
        for (std::size_t i = 0; i < perm_maps_.size(); ++i) {
          if (perm_maps_[i] == map) {
            perm_id = static_cast<std::uint16_t>(i);
            break;
          }
        }
        if (perm_id == 0xFFFF) {
          perm_id = static_cast<std::uint16_t>(perm_maps_.size());
          perm_maps_.push_back(map);
        }
        map_member_subtree(child, member, perm_id, *p);
        ++iso_collapsed_;
      }
    }
  }
}

// Walk the representative and member subtrees in lockstep, recording the
// correspondence. The betting structure is card-independent, so the shapes
// match exactly; the one wrinkle is INNER chance nodes, whose children are
// card-indexed and therefore correspond through pi, not through position.
void NlhePostflopGame::map_member_subtree(NodeId rep, NodeId member, std::uint16_t perm_id,
                                          const SuitPerm& perm) {
  const Node& rn = tree_[rep];
  const Node& mn = tree_[member];
  if (rn.kind != mn.kind || rn.num_children != mn.num_children || rn.actor != mn.actor) {
    throw std::runtime_error("suit-isomorphic subtrees differ in shape - tree builder bug");
  }
  iso_rep_[member] = rep;
  iso_perm_[member] = perm_id;

  if (rn.kind == NodeKind::Chance) {
    for (std::uint16_t c = 0; c < rn.num_children; ++c) {
      const NodeId rep_child = rn.first_child + c;
      const int image = perm_card(perm, static_cast<Card>(tree_[rep_child].dealt_card));
      NodeId member_child = kNoNode;
      for (std::uint16_t m = 0; m < mn.num_children; ++m) {
        if (tree_[mn.first_child + m].dealt_card == image) {
          member_child = mn.first_child + m;
          break;
        }
      }
      if (member_child == kNoNode) {
        throw std::runtime_error("suit-isomorphic chance children do not correspond");
      }
      map_member_subtree(rep_child, member_child, perm_id, perm);
    }
    return;
  }
  for (std::uint16_t c = 0; c < rn.num_children; ++c) {
    map_member_subtree(rn.first_child + c, mn.first_child + c, perm_id, perm);
  }
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

  // Flatten the lookup: showdown terminals resolve by dense terminal_index
  // from here on, never by map descent.
  terminal_eval_.assign(tree_.num_terminal_nodes, nullptr);
  for (const Node& n : tree_.nodes) {
    if (n.terminal_kind != TerminalKind::Showdown) continue;
    terminal_eval_[n.terminal_index] = evaluators_.find(n.board_mask)->second.get();
  }
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
    const RiverEvaluator* eval = terminal_eval_[node.terminal_index];
    if (eval == nullptr) {
      // Only reachable if a showdown terminal appeared after construction.
      throw std::runtime_error("no showdown evaluator for this terminal - tree changed after build");
    }
    eval->showdown_2p(opp, pot, my_delta, out.data());
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
