#pragma once
#include <array>
#include <cstdint>
#include <stdexcept>
#include <vector>

#include "game/types.hpp"

namespace engine {

// One concrete deal: every seat's private hand plus the public runout, drawn
// WITHOUT REPLACEMENT from one deck. This is the object that makes bunching
// free: two seats cannot hold the same card because the card was physically
// handed to one of them, and every terminal's payoffs on a concrete deal sum
// to the pot exactly - so chip conservation is a property of each sample
// rather than a correction to fight for.
struct Deal {
  std::array<std::uint16_t, kMaxSeats> hand{};     // compact hand index per seat
  std::array<std::uint8_t, 2 * kMaxSeats> hole{};  // raw private cards, seat-major
  std::array<std::uint8_t, 5> board{};             // public cards, in chance-deal order
  int hole_per_seat = 0;
  int board_count = 0;
};

// The deal-facing counterpart of Game, implemented alongside it by games the
// sampled solver core can run (the vectorized Game::terminal_values contract
// is meaningless for a concrete deal, and vice versa). The solver holds both
// interfaces to the same object.
//
// During seat p's traversal, p's own dealt cards are IGNORED - p stays
// vectorized over every hand compatible with the other seats' cards and the
// board. That the others' cards were drawn avoiding p's dealt two is not a
// bias: every opponent profile uses the same number of cards, so the count
// of hero holdings each profile excludes is constant, and marginalizing over
// p's dealt cards leaves the opponent-profile distribution exactly uniform.
// Exchangeability is what makes sharing one deal across all of an
// iteration's traversals sound, and sharing it is required anyway - the
// sample.hpp doctrine that every seat must see the SAME sampled game.
class DealGame {
 public:
  virtual ~DealGame() = default;

  // The deal for iteration `iter`: a pure function of (seed, iter), never of
  // a thread or a call site, so any assignment of iterations to lanes and
  // lanes to threads replays identically.
  virtual void sample_deal(std::uint64_t seed, std::uint64_t iter, Deal& out) const = 0;

  // The deal for one step of the root-EV pass, where EVERY seat is pinned.
  // Returns false after a plain sample_deal (the caller then weights the
  // deal by the product of the seats' range weights - exact, and what the
  // preflop game and the toys do). A game may instead return true and deal
  // seats' hands IN PROPORTION to their ranges, setting `weight` to the
  // importance weight that makes the estimator exact for the product
  // measure; under tight ranges a uniform deal lands outside a range almost
  // always, and 200k deals become a few hundred. Legitimate here and not in
  // the training deal: with no vectorized hero there is no runout marginal
  // to bias.
  virtual bool sample_ev_deal(std::uint64_t seed, std::uint64_t iter, Deal& out,
                              double& weight) const {
    sample_deal(seed, iter, out);
    weight = 1.0;
    return false;
  }

  // The training deal for ONE hero's traversal with the other seats dealt IN
  // PROPORTION to their ranges: each opponent in seat order from its range
  // conditioned on the cards already out, the hero's own two cards and the
  // runout uniform from what is left, and `weight` the product of the
  // range masses the conditioning divided out - the importance weight that
  // makes the estimator exact for the uniform-deal measure. On a tight range
  // a uniform deal lands every opponent in range about never (0.21% of deals
  // at four seats on a 15% range, ~0 at six), and every miss weighs the
  // hero's whole traversal by zero; this is the fix. The hero stays uniform
  // because a range-proportional hero hand would bias the runout its
  // vectorized traversal sees (the runout avoids the hero's own cards), and
  // one deal per hero per iteration is what keeps that honest. Returns false
  // when the game does not implement it (the solver then shares one uniform
  // deal across the iteration's traversals, weighted by the range product).
  virtual bool sample_hero_deal(std::uint64_t, std::uint64_t, int, Deal&, double&) const {
    return false;
  }

  // Per-iteration scratch: hand strengths for the WHOLE compact universe on

  // this deal's board, shared by all of the iteration's seat traversals.
  // Games whose showdowns need no board table leave it empty.
  virtual void deal_strengths(const Deal&, std::vector<std::uint32_t>& out) const {
    out.clear();
  }

  // Suit-symmetry quotient: hand -> class for games whose infosets are
  // invariant under suit permutations (a preflop-only tree qualifies; any
  // tree with a board in an infoset does not). Empty = no symmetry. This is
  // a LOSSLESS relabeling, not abstraction: members of a class face
  // identical deal distributions, so constraining them to one strategy
  // loses nothing and pools their samples - which is the variance
  // reduction. The sampled solver stores one row per class when this is
  // non-empty and expands to per-hand rows at the StrategySource boundary.
  virtual void hand_classes(std::vector<std::uint16_t>& class_of, int& num_classes) const {
    class_of.clear();
    num_classes = 0;
  }

  // Joint quotient for hand-sharing teams: dense class id for the ORDERED
  // disjoint pair (own hand, partner hand) under SIMULTANEOUS suit
  // permutation - the exact orbit, by the same argument as hand_classes.
  // class_of_pair is sized H*H with a sentinel (0xFFFFFFFF) on
  // non-disjoint pairs. Returns false when the game has no such quotient
  // (or its ranges are not closed under the suit group), in which case a
  // team solve must refuse rather than approximate.
  virtual bool joint_hand_classes(std::vector<std::uint32_t>&, int&) const { return false; }

  // Team showdown: out[h] = hero's share PLUS the pinned partner's share
  // given hero holds h, minus BOTH commitments. The partner's cut depends
  // on h (h can beat, tie, or lose to the partner), which is why this is
  // not deal_showdown_values called twice. Only games that support teams
  // implement it.
  virtual void deal_showdown_values_team(NodeId, int, int, const Deal&,
                                         const std::vector<std::uint32_t>&,
                                         std::vector<float>&) const {
    throw std::runtime_error("this game does not support hand-sharing teams");
  }

  // Every seat's chips at a SHOWDOWN terminal with ALL hands pinned to the
  // deal - the scalar evaluation the sampled EV pass runs per terminal per
  // deal. out is sized num_seats. The default derives it from
  // deal_showdown_values, which is fine for toy games; hot implementations
  // override with a scalar layer scan.
  virtual void deal_showdown_pinned(NodeId node, const Deal& deal,
                                    const std::vector<std::uint32_t>& strengths, int num_seats,
                                    std::vector<double>& out) const {
    out.assign(static_cast<std::size_t>(num_seats), 0.0);
    std::vector<float> per_hand;
    for (int s = 0; s < num_seats; ++s) {
      deal_showdown_values(node, s, deal, strengths, per_hand);
      out[static_cast<std::size_t>(s)] =
          static_cast<double>(per_hand[deal.hand[static_cast<std::size_t>(s)]]);
    }
  }

  // ONE seat's chips at a SHOWDOWN terminal with every seat pinned to the
  // deal - the pinned hero's terminal. The default derives it from the
  // per-hand vector (the toys); hot games override with a single scalar
  // evaluation, because this runs once per showdown per deal at six-figure
  // deal rates and the vector is the whole universe.
  virtual double deal_showdown_seat(NodeId node, int seat, const Deal& deal,
                                    const std::vector<std::uint32_t>& strengths) const {
    std::vector<float> per_hand;
    deal_showdown_values(node, seat, deal, strengths, per_hand);
    return static_cast<double>(per_hand[deal.hand[static_cast<std::size_t>(seat)]]);
  }

  // Per-hero-hand chips at a SHOWDOWN terminal on this concrete deal:
  // out[h] = share(h against the other seats' dealt hands) - commit[seat],
  // side pots and ties exact. Entries for hands colliding with the deal are
  // unspecified - the caller's reach there is zero. Fold terminals never
  // come here; the solver resolves them from the node's public fields alone.
  virtual void deal_showdown_values(NodeId node, int seat, const Deal& deal,
                                    const std::vector<std::uint32_t>& strengths,
                                    std::vector<float>& out) const = 0;

  // ---- Hand abstraction (solver/infoset_indexer.hpp consumes these) ----
  // The game supplies per-public-state FEATURES and the indexer clusters
  // them; nothing here knows what a bucket is. Universe-agnostic on purpose:
  // PLO supplies its own strengths and equities and the indexer is unchanged.

  // Whether hands can be bucketed per public state at all. False for the
  // preflop game (no board in the tree; its lossless quotient is
  // hand_classes) and the toys.
  virtual bool abstraction_supported() const { return false; }
  // Public-state key of a decision node: the board it holds. Two nodes with
  // equal keys and equal betting lines are the same public state.
  virtual std::uint64_t abstraction_key(NodeId) const { return 0; }
  // Per-hand strength on a COMPLETED key, one entry per hand of the widest
  // seat universe; 0 marks a hand the board blocks.
  virtual void abstraction_strengths(std::uint64_t, std::vector<std::uint32_t>&) const {
    throw std::runtime_error("this game has no hand abstraction");
  }
  // Per-hand equity against a uniform opponent from the universe over EVERY
  // completion of a partial key: `per_hand` equities per hand, hand-major,
  // in completion order. valid[h] = 0 marks a hand the key's board blocks;
  // its equities are zero.
  virtual void abstraction_equities(std::uint64_t, std::vector<float>&, int&,
                                    std::vector<std::uint8_t>&) const {
    throw std::runtime_error("this game has no hand abstraction");
  }
  // Symmetries for storage sharing: relabelings that fix the root public
  // state and every seat's range. `abstraction_symmetric_key(i, key)` is the
  // key's image under symmetry i, and a state with that image key reads the
  // original state's rows through `abstraction_symmetric_map(i)`:
  // image[h] = original[map[h]].
  virtual int abstraction_symmetries() const { return 0; }
  virtual std::uint64_t abstraction_symmetric_key(int, std::uint64_t key) const { return key; }
  // The same relabeling applied to one public card, so the indexer can
  // canonicalize a runout ORDER (turn X then river Y is a different public
  // state from turn Y then river X even though the board sets agree).
  virtual int abstraction_symmetric_card(int, int card) const { return card; }
  virtual const std::vector<std::uint16_t>& abstraction_symmetric_map(int) const {
    throw std::runtime_error("this game has no abstraction symmetries");
  }
};

}  // namespace engine
