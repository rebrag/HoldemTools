#pragma once
#include <array>
#include <bit>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <vector>

#include "config/schema.hpp"
#include "eval/terminal.hpp"
#include "game/game.hpp"
#include "ranges/iso.hpp"
#include "ranges/universe.hpp"

namespace engine {

// Heads-up NLHE postflop game from any 3/4/5-card root board: betting rounds
// joined by chance nodes down to the river. Seat 0 is OOP and acts first on
// every street.
//
// Both seats share one COMPACT hand universe (`ranges/universe.hpp`): the
// combos with non-zero weight in at least one starting range after root-board
// removal, in ascending canonical order. Every per-hand array in the solver
// is sized by it, so a 15%-range spot costs a fraction of a 100%-range one
// instead of the same. Combos blocked by a dealt runout card stay in the
// universe and are masked to zero reach by the solver's chance-node handling,
// exactly as before.
class NlhePostflopGame final : public Game {
 public:
  explicit NlhePostflopGame(const SolveConfig& config);

  const PublicTree& tree() const override { return tree_; }
  int num_seats() const override { return 2; }
  int num_hands(int) const override { return universe_.size(); }
  const std::vector<float>& initial_range(int seat) const override { return ranges_[seat]; }
  bool hand_blocks_card(int, int hand, int card) const override {
    return (universe_.masks[static_cast<std::size_t>(hand)] & (1ULL << card)) != 0;
  }
  const std::vector<std::uint16_t>& hands_blocking_card(int, int card) const override {
    return blocking_[static_cast<std::size_t>(card)];
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

  std::size_t auxiliary_bytes() const override;

  IsoRef iso_rep(NodeId node) const override {
    const NodeId rep = iso_rep_[node];
    if (rep == node) return {node, nullptr};
    return {rep, &perm_maps_[iso_perm_[node]]};
  }
  // How many chance-node children were collapsed into an equivalent
  // representative (observability + tests).
  std::size_t iso_collapsed_children() const { return iso_collapsed_; }

  const std::vector<Card>& board() const { return board_; }

 private:
  const RiverEvaluator& evaluator_for(std::uint64_t board_mask) const;
  // Fill `evaluators_` for every showdown terminal in the tree, in parallel.
  void build_evaluators(int threads);
  // Group suit-equivalent runout children and map their subtrees onto the
  // representatives (docs in nlhe_river.cpp).
  void build_isomorphism();
  void map_member_subtree(NodeId rep, NodeId member, std::uint16_t perm_id,
                          const SuitPerm& perm);

  PublicTree tree_;
  std::vector<Card> board_;  // root board (3-5 cards)
  std::uint64_t board_mask_ = 0;
  // Every member is valid vs the ROOT board by construction: the ranges are
  // board-masked before the universe is derived from them.
  HandUniverse universe_;
  // Per board card, the universe hands containing it. Two cards out of 52
  // means roughly 4% of the universe per card, so a chance node that walks
  // this does ~25x less work than one that tests every hand.
  std::array<std::vector<std::uint16_t>, kNumCards> blocking_;
  // Suit isomorphism (see iso_rep). iso_rep_[n] == n for nodes that are
  // their own representative; members carry the corresponding rep node and
  // an index into perm_maps_.
  std::vector<NodeId> iso_rep_;
  std::vector<std::uint16_t> iso_perm_;
  std::vector<std::vector<std::uint16_t>> perm_maps_;
  std::size_t iso_collapsed_ = 0;
  std::vector<std::vector<float>> ranges_;  // compact, one per seat
  double profile_weight_ = 0.0;
  // Showdown machinery per completed 5-card board: a flop tree needs up to
  // C(49,2) of these, each a sort + one strength per universe member.
  //
  // Built EAGERLY in the constructor rather than on first touch, because
  // terminal evaluation is the solver's hot path and the solver is
  // multithreaded - a lazy cache would need a lock on every showdown, or a
  // data race. Every entry is written once before any traversal starts, so
  // lookups afterwards are pure reads. Solving touches all of them on the
  // first iteration anyway, so this only moves the work, and parallelizes it.
  std::map<std::uint64_t, std::unique_ptr<RiverEvaluator>> evaluators_;
};

}  // namespace engine
