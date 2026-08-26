#include "ranges/iso.hpp"

#include <algorithm>
#include <cstdint>

#include "cards/combos.hpp"

namespace engine {

std::vector<SuitPerm> all_suit_perms() {
  std::vector<SuitPerm> perms;
  SuitPerm p = {0, 1, 2, 3};
  // std::next_permutation enumerates in lexicographic order - deterministic.
  while (std::next_permutation(p.begin(), p.end())) perms.push_back(p);
  // The loop leaves out the identity (it wraps past it), which is what we
  // want: 23 non-identity permutations.
  return perms;
}

bool perm_fixes_mask(const SuitPerm& p, std::uint64_t mask) {
  std::uint64_t image = 0;
  for (int c = 0; c < kNumCards; ++c) {
    if (mask & (1ULL << c)) image |= 1ULL << perm_card(p, static_cast<Card>(c));
  }
  return image == mask;
}

namespace {

// Universe index of a canonical combo id, or -1. The universe is in
// ascending canonical order, so binary search.
int universe_index(const HandUniverse& universe, int combo_id) {
  const auto it = std::lower_bound(universe.ids.begin(), universe.ids.end(),
                                   static_cast<std::uint16_t>(combo_id));
  if (it == universe.ids.end() || *it != combo_id) return -1;
  return static_cast<int>(it - universe.ids.begin());
}

int perm_combo_universe_index(const SuitPerm& p, const HandUniverse& universe, int hand) {
  const Combo& combo = universe.combos[static_cast<std::size_t>(hand)];
  return universe_index(universe, combo_index(perm_card(p, combo.hi), perm_card(p, combo.lo)));
}

}  // namespace

bool ranges_invariant(const SuitPerm& p, const HandUniverse& universe,
                      const std::vector<std::vector<float>>& ranges) {
  for (int h = 0; h < universe.size(); ++h) {
    const int j = perm_combo_universe_index(p, universe, h);
    if (j < 0) return false;  // universe not closed under pi
    for (const std::vector<float>& range : ranges) {
      // Exact comparison on purpose: symmetric range tokens produce
      // bit-identical weights for related combos, and anything else is a
      // real asymmetry that must disable the permutation.
      if (range[static_cast<std::size_t>(h)] != range[static_cast<std::size_t>(j)]) {
        return false;
      }
    }
  }
  return true;
}

std::vector<std::uint16_t> perm_hand_map(const SuitPerm& p, const HandUniverse& universe) {
  // pi^-1 as a permutation array.
  SuitPerm inv{};
  for (std::uint8_t s = 0; s < 4; ++s) inv[p[s]] = s;
  std::vector<std::uint16_t> map(static_cast<std::size_t>(universe.size()));
  for (int h = 0; h < universe.size(); ++h) {
    const int j = perm_combo_universe_index(inv, universe, h);
    map[static_cast<std::size_t>(h)] = static_cast<std::uint16_t>(j);
  }
  return map;
}

}  // namespace engine
