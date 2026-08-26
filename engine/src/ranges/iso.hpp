#pragma once
#include <array>
#include <cstdint>
#include <vector>

#include "cards/cards.hpp"
#include "ranges/universe.hpp"

namespace engine {

// Suit-isomorphism machinery for collapsing equivalent runouts.
//
// A suit permutation pi acts on cards by card = rank*4 + pi[suit]. Two
// runout cards c and c' under the same board B are strategically identical
// when some pi maps B to itself (set-wise), maps c to c', and leaves both
// starting ranges invariant - the subtrees under them are then the same
// game with hands relabeled, and only one needs to be solved.
//
// Range invariance is the part people forget: "AhKd" in a range string
// breaks the h<->d swap. It is checked exactly, weight by weight, and a
// range that is not invariant under any permutation simply disables the
// whole feature - correct fallback, no partial collapsing.

using SuitPerm = std::array<std::uint8_t, 4>;  // suit -> suit

inline Card perm_card(const SuitPerm& p, Card c) {
  return static_cast<Card>(card_rank(c) * 4 + p[static_cast<std::size_t>(card_suit(c))]);
}

// The 23 non-identity suit permutations, in a fixed deterministic order.
std::vector<SuitPerm> all_suit_perms();

// Does pi map the card set in `mask` to itself?
bool perm_fixes_mask(const SuitPerm& p, std::uint64_t mask);

// Is every seat's range invariant under pi, and the universe closed under
// it? `ranges` are compact vectors over `universe`.
bool ranges_invariant(const SuitPerm& p, const HandUniverse& universe,
                      const std::vector<std::vector<float>>& ranges);

// Compact-hand remap for pi^-1: out[h] = universe index of pi^-1(combo h).
// This is the gather map for reading a representative subtree's per-hand
// data as a member subtree's: member[h] = rep[out[h]]. Requires closure
// (ranges_invariant true).
std::vector<std::uint16_t> perm_hand_map(const SuitPerm& p, const HandUniverse& universe);

}  // namespace engine
