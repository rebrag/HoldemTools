#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "cards/cards.hpp"
#include "config/schema.hpp"
#include "game/deal_game.hpp"
#include "game/game.hpp"
#include "ranges/universe.hpp"

namespace engine {

// N-seat PREFLOP NLHE: blinds, antes, and a jam-or-fold action set (M8a).
//
// THE BOARD IS NOT IN THE TREE, and that is the load-bearing design decision.
// A runout as chance-node children would make the cards PUBLIC, which is a
// different and far easier game; and CfrSolver cannot express infoset-sharing
// siblings without breaking bitwise determinism. So the tree is pure betting
// (29 nodes for a 4-way jam/fold spot) and the whole board average lives
// inside terminal_values.
//
// Two estimators, because heads-up and multiway are genuinely different
// problems:
//
//   k = 2  The board expectation COMMUTES with the sum over opponent hands
//          (E_b[sum_o r(o) 1{h beats o}] = sum_o r(o) E_b[1{h beats o}]), so a
//          static pairwise matrix is exact in the limit. `e2_` is built once
//          at construction from `pair_count` boards and every heads-up
//          showdown is then one matvec, with NO per-iteration board loop.
//   k >= 3 The value contains a PRODUCT over opponents inside the board
//          expectation, which does not factorize and for which no static
//          table exists. Those terminals average over `boards_`, a small
//          FIXED sample drawn once at construction.
//
// The sample being fixed is what separates this from SamplingConfig, which
// redraws per iteration and is therefore guarded by sampling_exact(). A fixed
// sample makes the solve an exact solve of a well-defined sampled game, so it
// genuinely converges and the accuracy stop keeps its meaning. The bias
// against real hold'em is a property of (seed, iter_count, pair_count), all
// three of which land in artifact metadata.
//
// WHAT IS AND IS NOT EXACT (the honest accounting; also in artifact metadata):
//   - Nothing is bucketed. Every combo in the universe carries its own
//     regret row, strategy row and EV. This is not hand abstraction, which
//     stays permanently out of scope.
//   - Hero-vs-opponent card removal is EXACT: the inclusion-exclusion that
//     showdown_2p already does generalizes to one correction per opponent.
//   - Opponent-vs-opponent removal (bunching) is DROPPED at 3+ seats, where
//     the inclusion-exclusion over collision events grows combinatorially.
//     Exact at 2 seats. Applied consistently across terminal_values,
//     compat_weights and total_profile_weight - inconsistency there would
//     silently misscale every exported EV.
//   - Side pots and ties are EXACT: layers come from the node's public commit
//     levels, and ties are a subset expansion over the eligible opponents.
class NlhePreflopGame final : public Game, public DealGame {
 public:
  explicit NlhePreflopGame(const SolveConfig& config);

  const PublicTree& tree() const override { return tree_; }
  int num_seats() const override { return seats_; }
  int num_hands(int) const override { return universe_.size(); }
  const std::vector<float>& initial_range(int seat) const override {
    return ranges_[static_cast<std::size_t>(seat)];
  }
  bool hand_blocks_card(int, int hand, int card) const override {
    return (universe_.masks[static_cast<std::size_t>(hand)] & (1ULL << card)) != 0;
  }
  const std::vector<std::uint16_t>& hands_blocking_card(int, int card) const override {
    return blocking_[static_cast<std::size_t>(card)];
  }
  // There are no chance nodes in a jam/fold preflop tree. Reported honestly
  // rather than given a plausible-looking value nothing reads.
  double chance_weight(NodeId) const override { return 1.0; }
  double total_profile_weight() const override { return profile_weight_; }

  void terminal_values(NodeId id, int seat, const std::vector<std::vector<float>>& reach,
                       std::vector<float>& out) const override;

  void compat_weights(int seat, const std::vector<std::vector<float>>& reach,
                      std::vector<float>& out) const override;

  // The DealGame face, for the sampled solver core. A deal is 2 cards per
  // seat plus a full 5-card board; deal_strengths is the once-per-iteration
  // whole-universe 7-card evaluation on that board, and deal_showdown_values
  // resolves the same TerminalPlan layers as the vectorized path but against
  // PINNED opponents, so it is O(H) flat with no inclusion-exclusion.
  void sample_deal(std::uint64_t seed, std::uint64_t iter, Deal& out) const override;
  // The 169 classes ARE the suit orbits of the preflop combos, and no
  // infoset in this tree sees a board card, so the quotient is exact.
  void hand_classes(std::vector<std::uint16_t>& class_of, int& num_classes) const override;
  // Suit orbits of ordered disjoint hand PAIRS - the exact information
  // quotient for a hand-sharing team. Built on demand (~40M ops, the
  // solver stores the result); false when the universe is not closed under
  // the suit group (an asymmetric range), where a team must refuse.
  bool joint_hand_classes(std::vector<std::uint32_t>& class_of_pair,
                          int& num_classes) const override;
  void deal_showdown_values_team(NodeId node, int seat, int mate, const Deal& deal,
                                 const std::vector<std::uint32_t>& strengths,
                                 std::vector<float>& out) const override;
  void deal_showdown_pinned(NodeId node, const Deal& deal,
                            const std::vector<std::uint32_t>& strengths, int num_seats,
                            std::vector<double>& out) const override;
  void deal_strengths(const Deal& deal, std::vector<std::uint32_t>& out) const override;
  void deal_showdown_values(NodeId node, int seat, const Deal& deal,
                            const std::vector<std::uint32_t>& strengths,
                            std::vector<float>& out) const override;

  std::vector<std::uint16_t> hand_dictionary(int) const override { return universe_.ids; }

  std::size_t auxiliary_bytes() const override;

  // Suit isomorphism is deliberately NOT wired here. The sampled board set is
  // not closed under the suit group, so collapsing a "suit-equivalent"
  // subtree would be a lie rather than a relabeling. It becomes available
  // once canonical-with-multiplicity board sampling lands.

  // The largest number of seats a showdown may reach. The tie handling is a
  // subset expansion over the eligible opponents, so it is 2^(k-1) terms.
  static constexpr int kMaxShowdownSeats = 6;

 private:
  // One sampled complete board: which universe hands are live on it, their
  // strengths, and the ascending-strength order with its tie groups. The same
  // shape RiverEvaluator builds, kept separately because this one is indexed
  // by the sample rather than by a tree node.
  struct BoardTable {
    std::array<Card, 5> board{};
    std::vector<std::uint32_t> strength;  // by compact hand, 0 when blocked
    std::vector<std::uint8_t> valid;
    std::vector<std::int32_t> sorted;         // live hands, ascending strength
    std::vector<std::pair<int, int>> groups;  // tie groups, [begin, end) into sorted
  };

 public:
  // Test seam. The multiway estimator's correctness gate is a brute-force
  // O(H^k) reference built on showdown_share, and that reference has to run
  // over the SAME boards the estimator averaged - otherwise it is comparing
  // two different games and any agreement is luck. Nothing in the solver
  // calls these.
  int board_sample_size() const { return static_cast<int>(boards_.size()); }
  const std::array<Card, 5>& sampled_board(int i) const {
    return boards_[static_cast<std::size_t>(i)].board;
  }
  // The profile mass a terminal's values were measured against. A showdown is
  // normalized by a board-sample mass rather than by compat_weights (see
  // terminal_values), so a test that wants to compare chips-per-unit-mass
  // against a brute-force reference has to be told which mass was used.
  void terminal_values_with_mass(NodeId id, int seat,
                                 const std::vector<std::vector<float>>& reach,
                                 std::vector<float>& out, std::vector<float>& mass) const;

 private:

  // Everything a showdown terminal needs, resolved once at construction and
  // immutable for the solve. The analogue of NlhePostflopGame's
  // terminal_eval_: no branching and no lookup on the hot path.
  struct Layer {
    double amount = 0.0;          // chips in this side-pot layer
    std::uint16_t eligible = 0;   // seats that may win it
  };
  struct TerminalPlan {
    bool showdown = false;
    std::uint16_t alive_mask = 0;
    std::uint16_t fold_winner = kNoSeat;
    double pot = 0.0;
    std::array<double, kMaxSeats> commit{};
    std::vector<Layer> layers;
  };

  void build_boards(int threads);
  void build_pair_equity(int threads);
  // One layer's win probability and total profile mass per hero hand,
  // accumulated over the whole board sample, with card removal applied
  // BETWEEN the other seats as well as against hero.
  //
  // That last part is what makes root EVs sum to the dead money. Conservation
  // holds if and only if every seat integrates the identical set of deals, and
  // a rule phrased as "the others must miss MY cards" is a different set for
  // every hero. Removing cards between the others too takes the hero out of
  // the definition, and then the sum is a property of the arithmetic rather
  // than something to be hoped for.
  //
  // `eligible` are the seats contesting the layer; `bystanders` cannot win it
  // but still hold cards, so they still say which deals and which runouts were
  // possible. The two lists differ only in whether a seat enters the win
  // condition - both enter the measure.
  void layer_masses(const std::vector<int>& eligible, const std::vector<int>& bystanders,
                    const std::vector<std::vector<float>>& reach, std::vector<double>& num,
                    std::vector<double>& den) const;
  // Fold one opponent's compatible mass into a running per-hero-hand product.
  // The single copy of the hero-vs-opponent inclusion-exclusion.
  void multiply_compat(const float* opp_reach, float* inout) const;

  int seats_ = 2;
  PublicTree tree_;
  HandUniverse universe_;
  std::array<std::vector<std::uint16_t>, kNumCards> blocking_;
  std::vector<std::vector<float>> ranges_;  // compact, one per seat
  double profile_weight_ = 0.0;

  // Pairwise all-in equity over the compact universe: e2_[h * H + o] is
  // hero h's expected share of one unit against opponent o, averaged over the
  // boards in the pair sample. Exactly 0 when the two combos share a card, so
  // a plain dense dot product against an opponent reach vector already
  // excludes blocked combos.
  // Universe index of the combo {a, b}, or -1. 52x52, built once: the
  // bunching correction asks for it 52 times per hand per pair, and
  // combo_index plus a binary search each time would dominate it.
  std::vector<std::int32_t> combo_at_;
  std::vector<float> e2_;
  std::vector<BoardTable> boards_;
  std::vector<TerminalPlan> terminal_plan_;  // by dense terminal_index
  BoardSampleConfig sample_;
};

}  // namespace engine
