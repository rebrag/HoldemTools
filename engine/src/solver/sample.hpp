#pragma once
#include <cstdint>

namespace engine {

// Deterministic sampling of chance-node children.
//
// The determinism invariant ("same numbers at any thread count") rules out a
// stateful RNG: a std::mt19937 shared across the pool would hand out draws in
// whatever order the workers happen to ask, and per-thread streams would make
// the sample depend on which worker picked up which subtree. Instead every
// draw is a pure FUNCTION of where it is needed - a counter-based hash of
// (node id, iteration, index) - so the sampled game is fully determined by
// position in the tree and is identical on 1 thread and on 64.
//
// Never key a draw on a thread id, a fork depth, a pointer, or a clock.
inline std::uint64_t splitmix64(std::uint64_t x) {
  x += 0x9E3779B97F4A7C15ULL;
  x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ULL;
  x = (x ^ (x >> 27)) * 0x94D049BB133111EBULL;
  return x ^ (x >> 31);
}

// The draw for the k'th selection step at `node` during iteration `iter`.
// Deliberately NOT keyed on the traversing seat: both of an iteration's
// traversals must see the SAME sampled game, or seat 1 would be updating
// against runouts seat 0 never learned on.
inline std::uint64_t sample_draw(std::uint64_t node, std::uint64_t iter, std::uint32_t k) {
  return splitmix64(splitmix64(node * 0x9E3779B97F4A7C15ULL ^ iter) + k);
}

// Choose `m` of the `n` entries of `units` (a list of child indices), writing
// the winners into `out` in ASCENDING order. Partial Fisher-Yates over a
// stack-local scratch, then an insertion sort.
//
// The sort is not cosmetic: the chance-node fold-back accumulates in child
// order, and float addition is not associative, so a permuted selection would
// give different last bits. Sorting is what keeps the estimator bit-identical
// regardless of how the shuffle happened to land.
//
// Modulo bias over a 64-bit draw with n <= 52 is around 2^-58, and is in any
// case deterministic rather than a source of thread-dependent drift.
inline void sample_without_replacement(const std::uint8_t* units, int n, int m,
                                       std::uint64_t node, std::uint64_t iter,
                                       std::uint8_t* out) {
  std::uint8_t scratch[64];
  for (int i = 0; i < n; ++i) scratch[i] = units[i];
  for (int i = 0; i < m; ++i) {
    const int span = n - i;
    const int j = i + static_cast<int>(sample_draw(node, iter, static_cast<std::uint32_t>(i)) %
                                       static_cast<std::uint64_t>(span));
    const std::uint8_t tmp = scratch[i];
    scratch[i] = scratch[j];
    scratch[j] = tmp;
  }
  for (int i = 0; i < m; ++i) {
    std::uint8_t v = scratch[i];
    int j = i - 1;
    while (j >= 0 && out[j] > v) {
      out[j + 1] = out[j];
      --j;
    }
    out[j + 1] = v;
  }
}

}  // namespace engine
