#pragma once
#include <cstddef>
#include <string>

#include "game/game.hpp"

namespace engine {

// Estimated solver memory for a game, from the layout alone (no allocation).
// Update this whenever per-node solver state grows - the estimate feeding
// the fail-fast check must not drift from reality.
struct MemoryEstimate {
  std::size_t regret_strategy_bytes = 0;  // flat f32 regrets + strategy sums
  std::size_t tree_bytes = 0;             // public tree topology
  std::size_t showdown_bytes = 0;         // precomputed per-board showdown tables
  std::size_t recalc_bytes = 0;           // chance-child value caches + reach snapshots
  // Traversal scratch: one arena per concurrently walked subtree. This is a
  // worst-case CEILING, not a prediction - it assumes every worker is nested
  // at the deepest fork level at the same time, which real solves rarely
  // reach. The fail-fast check wants a bound it cannot undershoot, and the
  // term is small next to regrets+strategy on any tree big enough to matter.
  std::size_t workspace_bytes = 0;
  std::size_t total() const {
    return regret_strategy_bytes + tree_bytes + showdown_bytes + recalc_bytes +
           workspace_bytes;
  }
  std::string to_string() const;
};

// `threads` follows the config convention (0 = auto). It scales the
// workspace term: each concurrently traversed subtree checks out its own
// scratch arena. `recalc` sizes the chance-child cache term (0 when the
// recalc schedule is disabled).
MemoryEstimate estimate_memory(const Game& game, int threads = 1, bool recalc = true);

// Current process peak resident set size in bytes (0 if unavailable).
std::size_t peak_rss_bytes();

}  // namespace engine
