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
// SIDE POTS are a LAYERING wrapper over that kernel rather than a change to
// it. The eligible set per layer is fixed by the commitments, which are
// public, so the layers are known before any hand is looked at and each one
// picks a kernel:
//
//   all three eligible   S(W,W) + 1/2 [S(T,W) + S(W,T)] + 1/3 S(T,T)
//   hero + opponent 1    S(W1,ALL) + 1/2 S(T1,ALL)
//   hero + opponent 2    S(ALL,W2) + 1/2 S(ALL,T2)
//   hero alone           S(ALL,ALL)
//   hero not eligible    0
//
// An ineligible seat's set is taken as EVERYTHING, which marginalizes over it
// while keeping its card removal exact - a folded seat still holds cards. So
// nine S terms cover every layer shape, they share one 52-wide loop, and the
// cost does not grow with the number of layers.
class Showdown3 {
 public:
  Showdown3(const std::vector<Card>& board, const std::vector<Combo>& universe);

  int num_hands() const { return static_cast<int>(combos_.size()); }
  bool valid(int hand) const { return valid_[static_cast<std::size_t>(hand)] != 0; }

  // One side-pot layer: the chips in it and which seats can win it. Bit 0 is
  // the hero, bit 1 opponent 1, bit 2 opponent 2, in the order their reach
  // vectors are passed to showdown(). Folded seats are never eligible; their
  // chips are still in the layers and their cards still block.
  struct Layer {
    double amount = 0.0;
    std::uint8_t eligible = 0;
  };

  // out[h] = sum over mutually disjoint (o1,o2) of r1(o1) * r2(o2) *
  //          (hero's share of every layer it wins) - R3(h) * my_delta.
  // 0 for board-blocked hands.
  void showdown(const float* r1, const float* r2, const std::vector<Layer>& layers,
                double my_delta, float* out) const;

  // Single-pot convenience: one layer, all three seats eligible.
  void showdown(const float* r1, const float* r2, double pot, double my_delta,
                float* out) const;

  // R3(h): the mass of (o1,o2) pairs mutually disjoint and disjoint from h.
  // The normalizer that turns counterfactual sums into per-hand EVs, and the
  // 3-seat analogue of compat_reach.
  void compat(const float* r1, const float* r2, float* out) const;

  // O(H^2) per hero hand reference built on `showdown_share`, the canonical
  // side-pot-correct N-seat rule. The fast path is gated against this.
  // `commit` is the three seats' post-root commitments in the same order,
  // `dead` the chips already in the middle, and `folded` a mask over them, so
  // the reference derives its own layers exactly as the real game does.
  void showdown_slow(const float* r1, const float* r2, const std::array<Chips, 3>& commit,
                     Chips dead, std::uint8_t folded, double my_delta, float* out) const;

  // The layers a showdown with these commitments pays out, in the form
  // showdown() wants. Pure public information; `showdown_share` is the rule
  // it reproduces.
  static std::vector<Layer> layers_from_commits(const std::array<Chips, 3>& commit, Chips dead,
                                                std::uint8_t folded);

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
