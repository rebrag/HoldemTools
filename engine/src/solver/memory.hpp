#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

#include "game/game.hpp"
#include "solver/updates.hpp"

namespace engine {

// Allowance for one heap block beyond its payload: a header, plus rounding up
// to the allocator's granularity. 16 bytes each on the Windows heap and no
// worse on glibc, so 32 is the safe side of both. Charged wherever the
// estimator counts many small allocations - an estimate built from payloads
// alone lands BELOW the measured peak once there are hundreds of thousands of
// blocks, and an estimate that lands below reality is not a ceiling.
inline constexpr std::size_t kHeapBlockOverhead = 32;

// Estimated peak memory for a solve, from the layout alone (no allocation).
// It covers the whole run, not just the solve loop: the artifact export pass
// is the high-water mark on any tree big enough for the limit to matter.
// Update this whenever per-node state grows, solver or exporter - the
// estimate feeding the fail-fast check must not drift from reality.
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
  // The artifact export pass (io/artifact_writer.cpp). It holds one
  // NodeExportData per DECISION NODE alive at once, on top of everything
  // above - the solver state, the tree and the showdown tables are all still
  // resident while it runs. On a flop tree this term is LARGER than regrets +
  // strategy and is the high-water mark of the whole run, so a limit check
  // that leaves it out waves through solves that then thrash the box.
  std::size_t export_bytes = 0;
  std::size_t total() const {
    return regret_strategy_bytes + tree_bytes + showdown_bytes + recalc_bytes +
           workspace_bytes + export_bytes;
  }
  std::string to_string() const;
};

// `threads` follows the config convention (0 = auto). It scales the
// workspace term: each concurrently traversed subtree checks out its own
// scratch arena. `recalc` sizes the chance-child cache term (0 when the
// recalc schedule is disabled).
// A non-null `sampled` sizes for the SAMPLED core instead: (lanes + 1) f32
// copies of the regret and strategy arrays (master plus per-lane deltas),
// per-class rows when the symmetry quotient is on, no recalc caches.
// Null = the vectorized core.
MemoryEstimate estimate_memory(const Game& game, int threads = 1, bool recalc = true,
                               Precision precision = Precision::F32,
                               const SampledConfig* sampled = nullptr);

// Process memory high-water marks, in bytes (0 where unavailable).
//
// Two numbers, because they answer different questions and diverge under
// memory pressure: the OS trims a working set when the box is short, so the
// resident figure can sit well below what the process actually asked for,
// while the commit figure cannot. "How much memory did this solve need" is
// the commit number.
struct PeakMemory {
  std::size_t working_set = 0;  // peak resident bytes
  std::size_t commit = 0;       // peak private commit; 0 where unavailable
};

// Sampled from the OS, monotonic for the life of the process. Call it at the
// LAST point of interest, not the first: on a flop tree the high-water mark
// is the artifact export pass, long after the solve loop ends.
PeakMemory peak_memory();

// Peak resident set size in bytes (0 if unavailable) - peak_memory().working_set.
std::size_t peak_rss_bytes();

}  // namespace engine
