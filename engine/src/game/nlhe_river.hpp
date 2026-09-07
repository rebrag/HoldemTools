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
#include "game/deal_game.hpp"
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
//
// The DealGame face (below) lets the sampled-deal core run the same tree:
// one concrete deal per iteration - two hole cards per seat plus the runout
// - drawn uniformly from the deck minus the root board. That is a comparison
// path, not the product path: heads-up postflop stays on CfrSolver, whose
// exact gradient is what PioSolver validated. The sampled core has no suit
// isomorphism redirect, so a sampled solve of this game is built with
// `isomorphism: false` (the config parser enforces it).
class NlhePostflopGame final : public Game, public DealGame {

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

  // ---- Depth limit ----
  // How many DepthLimit terminals the tree carries; 0 for a full tree.
  std::size_t depth_limit_terminals() const { return depth_limit_terminals_; }

  // Continuation values for those terminals. `per_seat[s]` is indexed
  // [terminal_index * num_hands + hand] and holds the CONDITIONAL value in
  // chips of the truncated subtree given seat s holds that hand, averaged
  // over the opponent's range as it stood when the table was built.
  //
  // terminal_values() reconstitutes a counterfactual value by multiplying
  // this back by the opponent's LIVE compatible reach mass. That is exact
  // while the opponent's range SHAPE at the leaf matches the one the table
  // was built against, and it tracks the dominant reach effect (how much
  // opponent mass arrives at all) when it does not. Freezing the shape is
  // the approximation depth-limited solving cannot avoid without taking
  // ranges as an input - see docs/roadmap.md.
  void set_leaf_values(std::array<std::vector<float>, 2> per_seat);

  // The EXACT leaf model: per truncated terminal, the full per-hand-pair
  // continuation matrix u0[o * num_hands + h], the value to SEAT 0 of holding
  // h against seat 1 holding o from that leaf onward under the continuation
  // it was built from. Entries for colliding pairs are zero.
  //
  // Two things follow from storing the matrix instead of a per-hand average.
  // The value becomes a real matvec against the LIVE opponent reach, so the
  // opponent's range shape is no longer frozen and the solve responds
  // correctly when the other seat widens. And seat 1's side is derived rather
  // than stored, from the pointwise form of this engine's utility convention:
  // u0(h,o) + u1(o,h) = the root pot at every terminal below the leaf, hence
  // in expectation. So the two seats cannot drift into describing different
  // games, and root EVs conserve by construction.
  //
  // Cost is O(H^2) per leaf per seat per iteration against the scalar model's
  // O(H). Column-major because that makes the build write, seat 0's axpy and
  // seat 1's dot product all contiguous.
  //
  // Takes precedence over set_leaf_values when both are present.
  void set_leaf_matrices(std::vector<std::vector<float>> per_terminal);

  // ---- DealGame ----
  // `board` carries ONLY the runout (turn, then river), never the root board:
  // the sampled traversal follows deal.board[chance_depth] from the first
  // chance node it meets, and a river tree has none, so board_count is
  // 5 minus the root board size. Hands are compact indices or the uint16
  // sentinel when the dealt combo is outside both ranges (the solver then
  // weights that seat's traversal by zero - an unbiased nothing, not an
  // error). Uniform over the live deck; dealing in proportion to a range
  // would bias the runout the hero's vectorized traversal sees, since the
  // runout avoids the hero's own dealt cards - see docs/roadmap.md.
  void sample_deal(std::uint64_t seed, std::uint64_t iter, Deal& out) const override;
  // The EV pass deals each seat's hand in proportion to its range (seat 0
  // from its range, seat 1 from its range conditioned on not colliding) and
  // weights the deal by seat 1's range mass compatible with seat 0's hand,
  // which is exactly the factor the conditioning divided out. Real ranges
  // are a few percent of the deck each, so a uniform deal would land inside
  // both ranges once in a thousand tries.
  bool sample_ev_deal(std::uint64_t seed, std::uint64_t iter, Deal& out,
                      double& weight) const override;

  // The whole universe's 7-card strength on root + runout, read off the
  // evaluator this tree already built for that completed board.
  void deal_strengths(const Deal& deal, std::vector<std::uint32_t>& out) const override;
  void deal_showdown_values(NodeId node, int seat, const Deal& deal,
                            const std::vector<std::uint32_t>& strengths,
                            std::vector<float>& out) const override;
  void deal_showdown_pinned(NodeId node, const Deal& deal,
                            const std::vector<std::uint32_t>& strengths, int num_seats,
                            std::vector<double>& out) const override;
  // No hand_classes: the board sits in every infoset, so there is no suit
  // quotient. No team support: hand sharing is a preflop (M9) feature.

 private:

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
  // The deck a deal draws from: every card not on the root board, ascending.
  // deal_cards deals INDICES into a deck of this size; they map through here.
  std::vector<std::uint8_t> live_deck_;
  int runout_count_ = 0;  // 5 - root board size: cards a deal adds to the board
  // For sample_ev_deal: each seat's cumulative range over the compact
  // universe (last entry = the range's total mass), and per seat-0 hand the
  // mass of seat 1's range disjoint from it.
  std::array<std::vector<double>, 2> range_cdf_;
  std::vector<double> compat_mass_;


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
  // Depth-limit leaf table, empty until set_leaf_values. A tree with
  // DepthLimit terminals and no table throws on evaluation rather than
  // returning a plausible zero.
  std::array<std::vector<float>, 2> leaf_ev_;
  // By terminal_index; empty for terminals that are not DepthLimit.
  std::vector<std::vector<float>> leaf_matrix_;
  std::size_t depth_limit_terminals_ = 0;
  Chips root_pot_ = 0;
  // The same evaluators, resolved once per showdown terminal and indexed by
  // the node's dense terminal_index. terminal_values() runs on the hot path
  // and used to reach them through a std::map::find on the board mask - a
  // red-black descent per terminal visit per seat per iteration, which on a
  // flop tree is millions of pointer chases buying nothing. Built alongside
  // the evaluators and immutable for the rest of the solve, like everything
  // else the traversal touches. Null for fold terminals.
  std::vector<const RiverEvaluator*> terminal_eval_;
};

}  // namespace engine
