#pragma once
#include <cstdint>

#include "solver/sample.hpp"

namespace engine {

// The draw for the k'th Fisher-Yates step of iteration `iter`'s deal. The
// sibling of sample_draw with the seed in place of the node id: a deal is
// drawn once per iteration for the whole tree, so there is no node to key
// on, and the solve seed is what makes two configs' deal streams distinct.
// Never key a draw on a seat, a thread, or a pointer.
inline std::uint64_t deal_draw(std::uint64_t seed, std::uint64_t iter, std::uint32_t k) {
  return splitmix64(splitmix64(seed * 0x9E3779B97F4A7C15ULL ^ iter) + k);
}

// Deal `m` cards from a `deck`-card deck in ORDER (seats' holes first, then
// the board - the order is part of the deal's definition, so no sort). A
// partial Fisher-Yates over a stack-local scratch, same shape as
// sample_without_replacement; modulo bias over a 64-bit draw is ~2^-58 and
// deterministic.
inline void deal_cards(std::uint64_t seed, std::uint64_t iter, int deck, int m,
                       std::uint8_t* out) {
  std::uint8_t scratch[64];
  for (int i = 0; i < deck; ++i) scratch[i] = static_cast<std::uint8_t>(i);
  for (int i = 0; i < m; ++i) {
    const int span = deck - i;
    const int j = i + static_cast<int>(deal_draw(seed, iter, static_cast<std::uint32_t>(i)) %
                                       static_cast<std::uint64_t>(span));
    const std::uint8_t tmp = scratch[i];
    scratch[i] = scratch[j];
    scratch[j] = tmp;
    out[i] = scratch[i];
  }
}

}  // namespace engine
