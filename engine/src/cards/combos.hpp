#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "cards/cards.hpp"

namespace engine {

inline constexpr int kNumCombos = 1326;

// A two-card holding. Canonical form: hi > lo (card codes).
struct Combo {
  Card hi;
  Card lo;
};

// Canonical 1326 ordering: combos sorted by (hi descending, lo descending),
// with hi > lo. Index 0 = AsAh, 1 = AsAd, 2 = AsAc, 3 = AsKs, ... 1325 = 2d2c.
// This is the engine's hand_order; the artifact format documents it and every
// per-hand array in a solve is indexed by it.
inline const std::vector<Combo>& canonical_combos() {
  static const std::vector<Combo> combos = [] {
    std::vector<Combo> v;
    v.reserve(kNumCombos);
    for (int hi = kNumCards - 1; hi >= 1; --hi) {
      for (int lo = hi - 1; lo >= 0; --lo) {
        v.push_back(Combo{static_cast<Card>(hi), static_cast<Card>(lo)});
      }
    }
    return v;
  }();
  return combos;
}

// combo index -> "AsAh" (higher card first).
inline std::string combo_to_string(int index) {
  const Combo& c = canonical_combos()[index];
  return card_to_string(c.hi) + card_to_string(c.lo);
}

// (hi, lo) in any order -> canonical index.
inline int combo_index(Card a, Card b) {
  const int hi = a > b ? a : b;
  const int lo = a > b ? b : a;
  // Combos before block `hi`: sum over h in (hi, 51] of h. Index within
  // block: (hi - 1) - lo.
  // Block for hi=51 starts at 0 and has 51 entries, hi=50 has 50, etc.
  int before = 0;
  for (int h = kNumCards - 1; h > hi; --h) before += h;
  return before + (hi - 1 - lo);
}

inline std::uint64_t combo_mask(int index) {
  const Combo& c = canonical_combos()[index];
  return (1ULL << c.hi) | (1ULL << c.lo);
}

inline constexpr int kNumHandClasses = 169;

// 169-class grid index for a combo, matching the standard 13x13 layout:
// row i, column j with rank order A..2 descending (A = 0). i == j pair,
// i < j suited (upper triangle), i > j offsuit.
inline int combo_class_index(int index) {
  const Combo& c = canonical_combos()[index];
  const int gr_hi = 12 - card_rank(c.hi);  // A -> 0
  const int gr_lo = 12 - card_rank(c.lo);
  if (gr_hi == gr_lo) return gr_hi * 13 + gr_hi;
  const bool suited = card_suit(c.hi) == card_suit(c.lo);
  return suited ? gr_hi * 13 + gr_lo : gr_lo * 13 + gr_hi;
}

// "AA", "AKs", "T9o" for a grid class index.
inline std::string class_name(int class_index) {
  const int i = class_index / 13;
  const int j = class_index % 13;
  const char hi = kRankChars[12 - (i < j ? i : j)];
  const char lo = kRankChars[12 - (i < j ? j : i)];
  if (i == j) return std::string{hi, lo};
  return std::string{hi, lo, i < j ? 's' : 'o'};
}

}  // namespace engine
