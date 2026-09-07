#pragma once
#include <cstdint>
#include <vector>

#include "cards/cards.hpp"
#include "cards/combos.hpp"
#include "game/types.hpp"

namespace engine {

// Exact 3-way showdown over a river board, vectorized over the hero's whole
// hand universe.
//
// THE QUESTION THIS ANSWERS. The 2-player showdown is O(H) for every hero
// hand against the entire opponent range (`RiverEvaluator::showdown_2p`),
// which is why exact heads-up postflop is affordable at all. At three seats
// the hero needs
//
//   out[h] = sum over mutually disjoint (o1, o2) of r1(o1) r2(o2) * share
//
// and the obvious reference is O(H^2) per hero hand, O(H^3) overall. If that
// is the only way, exact multiway postflop is not reachable on the vectorized
// core and multiway has to come from depth-limiting plus a value function.
// It is not the only way: this is O(52 * H) after the same sort.
//
// HOW. "Hero beats both" would factorize into two independent prefix sums if
// the opponents could hold the same card. They cannot, and that coupling is
// the whole difficulty. It is removed by inclusion-exclusion over the shared
// card, exactly as the 2-player sweep removes the hero's own blockers:
//
//   S(A,B) = sum over o1 in A, o2 in B, mutually disjoint and disjoint from
//            the hero, of r1(o1) r2(o2)
//          = tot'(A) * tot'(B)
//            - sum over cards c of card'(A,c) * card'(B,c)
//            + diag(A and B)
//
// where ' marks sums already restricted to hands not blocking the hero. Two
// 2-card combos sharing two cards are the SAME combo, so the card-by-card
// subtraction double-counts exactly the diagonal, which the third term adds
// back - the series terminates at two terms rather than running to 52.
//
// Every quantity is a running total over the strength-sorted order, so the
// ascending sweep carries them at O(1) per hand plus the 52-wide dot product.
//
// SCOPE. Single pot, all three seats eligible, ties handled exactly. Side
// pots are a LAYERING wrapper over this kernel, not a change to it: the
// eligible set per layer is fixed by the commitments (public information), a
// layer with two eligible seats is the same S(A,B) with the ineligible seat's
// set taken as everything, and a layer with one is the compat weight. That
// wrapper is not implemented here - this exists to settle the complexity
// question, and layering does not change the complexity class.
class Showdown3 {
 public:
  Showdown3(const std::vector<Card>& board, const std::vector<Combo>& universe);

  int num_hands() const { return static_cast<int>(combos_.size()); }
  bool valid(int hand) const { return valid_[static_cast<std::size_t>(hand)] != 0; }

  // out[h] = sum over mutually disjoint (o1,o2) of
  //          r1(o1) * r2(o2) * (hero's share of `pot`) - R3(h) * my_delta,
  // with the hero taking the whole pot when it beats both, half on a two-way
  // tie and a third on a three-way tie. 0 for board-blocked hands.
  void showdown(const float* r1, const float* r2, double pot, double my_delta,
                float* out) const;

  // R3(h): the mass of (o1,o2) pairs mutually disjoint and disjoint from h.
  // The normalizer that turns counterfactual sums into per-hand EVs, and the
  // 3-seat analogue of compat_reach.
  void compat(const float* r1, const float* r2, float* out) const;

  // O(H^2) per hero hand reference built on `showdown_share`, the canonical
  // side-pot-correct N-seat rule. The fast path is gated against this.
  void showdown_slow(const float* r1, const float* r2, double pot, double my_delta,
                     float* out) const;

 private:
  std::vector<Combo> combos_;
  std::vector<std::uint64_t> masks_;
  std::vector<std::uint32_t> strength_;
  std::vector<std::uint8_t> valid_;
  std::vector<int> sorted_;                  // valid hands, ascending strength
  std::vector<std::pair<int, int>> groups_;  // tie groups as [begin, end) into sorted_
  // Compact index of the combo made of two cards, -1 when that pair is not in
  // the universe or not a legal combo. Lets the sweep ask "is {c, x} in the
  // strictly-worse set" with a strength comparison instead of a running array.
  std::vector<std::int32_t> pair_index_;

  std::int32_t pair_at(Card a, Card b) const {
    return pair_index_[static_cast<std::size_t>(a) * kNumCards + static_cast<std::size_t>(b)];
  }
};

}  // namespace engine
