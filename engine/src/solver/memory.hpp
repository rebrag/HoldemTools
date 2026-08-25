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
  std::size_t workspace_bytes = 0;        // traversal scratch (depth-bounded)
  std::size_t total() const { return regret_strategy_bytes + tree_bytes + workspace_bytes; }
  std::string to_string() const;
};

MemoryEstimate estimate_memory(const Game& game);

// Current process peak resident set size in bytes (0 if unavailable).
std::size_t peak_rss_bytes();

}  // namespace engine
