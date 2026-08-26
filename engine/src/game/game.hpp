#pragma once
#include <cstddef>
#include <cstdint>
#include <vector>


#include "game/public_tree.hpp"

namespace engine {

// The interface the vectorized solver runs against. A Game owns a public
// tree plus, per seat, a universe of private hands. All solver work is
// per-hand-vectorized: reach probabilities, counterfactual values, regrets
// and strategies are flat arrays over a seat's hand universe. Never add a
// per-(node, hand) recursive walk on top of this - one traversal computes
// every hand at once.
class Game {
 public:
  virtual ~Game() = default;

  virtual const PublicTree& tree() const = 0;
  virtual int num_seats() const = 0;

  // Size of seat's private-hand universe (e.g. 1326 for hold'em, 3 for Kuhn).
  virtual int num_hands(int seat) const = 0;

  // Initial range (reach weights at the root), length num_hands(seat).
  // Not required to sum to 1; blocked-vs-board hands must already be 0.
  virtual const std::vector<float>& initial_range(int seat) const = 0;

  // Does this hand contain the given dealt card (chance-node blocking)?
  virtual bool hand_blocks_card(int seat, int hand, int card) const = 0;

  // The same question asked the other way round: which of a seat's hands
  // contain `card`, as hand indices. Only a handful of hands can, so chance
  // nodes walk this list instead of testing every hand - and what is left
  // over is a straight contiguous loop the compiler can vectorize.
  virtual const std::vector<std::uint16_t>& hands_blocking_card(int seat, int card) const = 0;

  // Probability weight of each child card at a chance node, from public
  // information only (card removal vs. private hands is handled by reach
  // zeroing + hand_blocks_card). Typically 1 / (deck - public - all private).
  virtual double chance_weight(NodeId node) const = 0;

  // Total weight of compatible hand profiles: sum over all card-disjoint
  // hand combinations of the product of every seat's initial range weight.
  // Normalizes counterfactual sums into chip-denominated EVs.
  virtual double total_profile_weight() const = 0;

  // Counterfactual values at a terminal for `seat`: out[h] = sum over the
  // other seats' compatible hand profiles, weighted by their reach vectors,
  // of seat's utility. Utility convention: share of the final pot minus
  // chips this seat committed after the root (so root EVs across seats sum
  // to the root pot). `reach` holds one vector per seat (own entry unused).
  virtual void terminal_values(NodeId node, int seat,
                               const std::vector<std::vector<float>>& reach,
                               std::vector<float>& out) const = 0;

  // out[h] = total weight of the other seats' hand profiles compatible with
  // seat's hand h, given their reach vectors. This is the normalizer that
  // turns counterfactual value sums into conditional per-hand EVs.
  virtual void compat_weights(int seat, const std::vector<std::vector<float>>& reach,
                              std::vector<float>& out) const = 0;

  // The seat's hand dictionary for artifact export: universe ids in hand
  // order (canonical 1326 combo indices for hold'em, 0..H-1 for toy games).
  virtual std::vector<std::uint16_t> hand_dictionary(int seat) const = 0;

  // Bytes the game holds beyond its public tree - precomputed showdown
  // machinery, mostly. Reported by the memory estimator, which must not
  // drift from what actually gets allocated.
  virtual std::size_t auxiliary_bytes() const { return 0; }

  // Suit-isomorphism redirection. When a node lies inside a runout subtree
  // that is suit-equivalent to an earlier one, `rep` names the corresponding
  // node in the representative subtree and `map` is the compact-hand gather
  // (this node's hand h corresponds to the representative's hand map[h]).
  // The solver then stores regrets/strategy only for representative
  // subtrees, and every consumer of average_strategy() sees member nodes'
  // data through the redirect without knowing it. Identity for games
  // without isomorphism.
  struct IsoRef {
    NodeId rep;
    const std::vector<std::uint16_t>* map;  // null = identity
  };
  virtual IsoRef iso_rep(NodeId node) const { return {node, nullptr}; }
};

}  // namespace engine
