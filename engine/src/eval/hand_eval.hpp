#pragma once
#include <cstdint>

#include "cards/cards.hpp"

namespace engine {

// 7-card hand strength; larger is better. Encoding: category << 20, then up
// to five rank nibbles (most significant first). Correctness-first scalar
// implementation; the terminal evaluator caches one strength per combo per
// board, so this is not a hot path.
// Categories: 8 straight flush, 7 quads, 6 full house, 5 flush, 4 straight,
// 3 trips, 2 two pair, 1 pair, 0 high card.
std::uint32_t evaluate7(const Card* cards, int count);

}  // namespace engine
