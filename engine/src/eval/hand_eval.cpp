#include "eval/hand_eval.hpp"

#include <bit>

namespace engine {

namespace {

// Highest rank of a 5-long run in a 13-bit rank mask, or -1. Handles the
// wheel (A,5,4,3,2).
int straight_high(std::uint32_t rank_mask) {
  for (int high = 12; high >= 4; --high) {
    const std::uint32_t run = 0x1Fu << (high - 4);
    if ((rank_mask & run) == run) return high;
  }
  const std::uint32_t wheel = (1u << 12) | 0xFu;  // A,5,4,3,2
  if ((rank_mask & wheel) == wheel) return 3;     // 5-high
  return -1;
}

// Pack the top `count` set ranks of the mask into nibbles, high first.
std::uint32_t top_ranks(std::uint32_t rank_mask, int count) {
  std::uint32_t packed = 0;
  for (int r = 12; r >= 0 && count > 0; --r) {
    if (rank_mask & (1u << r)) {
      packed = (packed << 4) | static_cast<std::uint32_t>(r);
      --count;
    }
  }
  return packed;
}

std::uint32_t make(std::uint32_t category, std::uint32_t nibbles) {
  return (category << 20) | nibbles;
}

}  // namespace

std::uint32_t evaluate7(const Card* cards, int count) {
  int rank_count[13] = {};
  std::uint32_t suit_rank_mask[4] = {};
  std::uint32_t rank_mask = 0;
  for (int i = 0; i < count; ++i) {
    const int r = card_rank(cards[i]);
    const int s = card_suit(cards[i]);
    ++rank_count[r];
    suit_rank_mask[s] |= 1u << r;
    rank_mask |= 1u << r;
  }

  // Flush / straight flush.
  for (int s = 0; s < 4; ++s) {
    if (std::popcount(suit_rank_mask[s]) >= 5) {
      const int sf = straight_high(suit_rank_mask[s]);
      if (sf >= 0) return make(8, static_cast<std::uint32_t>(sf));
      return make(5, top_ranks(suit_rank_mask[s], 5));
    }
  }

  // Rank multiplicities, highest rank first within each multiplicity.
  int quad = -1, trip = -1, trip2 = -1, pair_hi = -1, pair_lo = -1;
  for (int r = 12; r >= 0; --r) {
    switch (rank_count[r]) {
      case 4:
        if (quad < 0) quad = r;
        break;
      case 3:
        if (trip < 0) trip = r;
        else if (trip2 < 0) trip2 = r;
        break;
      case 2:
        if (pair_hi < 0) pair_hi = r;
        else if (pair_lo < 0) pair_lo = r;
        break;
      default:
        break;
    }
  }

  if (quad >= 0) {
    const std::uint32_t kicker_mask = rank_mask & ~(1u << quad);
    return make(7, (static_cast<std::uint32_t>(quad) << 4) | top_ranks(kicker_mask, 1));
  }
  if (trip >= 0 && (trip2 >= 0 || pair_hi >= 0)) {
    const int pair = trip2 >= 0 ? trip2 : pair_hi;
    return make(6, (static_cast<std::uint32_t>(trip) << 4) | static_cast<std::uint32_t>(pair));
  }

  const int st = straight_high(rank_mask);
  if (st >= 0) return make(4, static_cast<std::uint32_t>(st));

  if (trip >= 0) {
    const std::uint32_t kicker_mask = rank_mask & ~(1u << trip);
    return make(3, (static_cast<std::uint32_t>(trip) << 8) | top_ranks(kicker_mask, 2));
  }
  if (pair_hi >= 0 && pair_lo >= 0) {
    const std::uint32_t kicker_mask = rank_mask & ~(1u << pair_hi) & ~(1u << pair_lo);
    return make(2, (static_cast<std::uint32_t>(pair_hi) << 8) |
                       (static_cast<std::uint32_t>(pair_lo) << 4) | top_ranks(kicker_mask, 1));
  }
  if (pair_hi >= 0) {
    const std::uint32_t kicker_mask = rank_mask & ~(1u << pair_hi);
    return make(1, (static_cast<std::uint32_t>(pair_hi) << 12) | top_ranks(kicker_mask, 3));
  }
  return make(0, top_ranks(rank_mask, 5));
}

}  // namespace engine
