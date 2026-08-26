#pragma once
#include <cstdint>
#include <vector>

#include "cards/combos.hpp"

namespace engine {

// The combos a solve actually has to carry: those with non-zero weight in at
// least one seat's starting range, after root-board removal.
//
// Why this exists: every per-hand array in the solver - regrets, cumulative
// strategy, reach vectors, counterfactual values - is sized by the hand
// universe, and every inner loop walks it. Sizing all of that at the full
// 1326 combos makes a 15%-range solve cost exactly as much as a 100%-range
// solve, which is not what the machine should be doing.
//
// Nothing is approximated. A combo neither seat can hold has zero reach
// everywhere, so it contributes an exact 0.0 to every sum it appears in and
// dropping it changes no other hand's number. This is emphatically NOT the
// hand abstraction / bucketing that is out of scope: nothing is merged and
// nothing is estimated.
//
// The universe is SHARED across seats rather than one per seat. Terminal
// showdown evaluation indexes hero and villain into one sorted-by-strength
// structure, and splitting that into two index spaces would rewrite the hot
// path for a modest extra saving - two ranges in the same spot overlap
// heavily, so the union is usually only a little wider than either side.
struct HandUniverse {
  std::vector<std::uint16_t> ids;    // canonical combo index, ascending
  std::vector<Combo> combos;         // canonical_combos()[ids[i]]
  std::vector<std::uint64_t> masks;  // two-card bitmask per compact hand

  int size() const { return static_cast<int>(ids.size()); }

  // Ascending canonical order is load-bearing: the artifact's hand
  // dictionary is documented as universe ids in hand order, and readers
  // (dump-json, the C# reader, the frontend) rely on that.
  static HandUniverse from_ranges(const std::vector<std::vector<float>>& ranges) {
    HandUniverse universe;
    const std::vector<Combo>& all = canonical_combos();
    for (int i = 0; i < kNumCombos; ++i) {
      bool live = false;
      for (const std::vector<float>& range : ranges) {
        if (range[static_cast<std::size_t>(i)] > 0.0f) {
          live = true;
          break;
        }
      }
      if (!live) continue;
      universe.ids.push_back(static_cast<std::uint16_t>(i));
      universe.combos.push_back(all[static_cast<std::size_t>(i)]);
      universe.masks.push_back(combo_mask(i));
    }
    return universe;
  }

  // Project a canonical-indexed weight vector onto this universe.
  std::vector<float> compact(const std::vector<float>& canonical) const {
    std::vector<float> out(ids.size());
    for (std::size_t h = 0; h < ids.size(); ++h) out[h] = canonical[ids[h]];
    return out;
  }
};

}  // namespace engine
