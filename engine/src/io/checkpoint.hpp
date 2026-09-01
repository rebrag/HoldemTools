#pragma once

// Solver checkpoints for the SAMPLED core: write the solver's whole mutable
// state to a file, read it back, and keep iterating exactly where the run
// left off.
//
// Why this is exact rather than approximate. The sampled core derives its
// deal stream from `sample_deal(seed, t)` and its DCFR discount from the
// ABSOLUTE iteration index, so neither depends on how a run was segmented.
// Restore (regrets, strategy sums, t) and the continuation is bit-for-bit
// what an uninterrupted run would have produced - gated in
// tests/test_checkpoint.cpp, which compares 2N in one go against N + resume
// + N.
//
// This is deliberately NOT the artifact. An `.hta` carries the AVERAGE
// strategy (u8-quantized by default) for viewers; the average cannot be
// inverted back into the cumulative regrets that produced it, so an
// artifact can never be resumed from. The two files answer different
// questions and are written separately.
//
// Not implemented for the vectorized core, which additionally carries
// deferred DCFR discount history, recalc-schedule state, and QRE anneal
// state; those would all have to serialize for a resume there to mean
// anything.

#include <cstdint>
#include <string>
#include <vector>

#include "config/schema.hpp"
#include "solver/sampled_cfr.hpp"

namespace engine {

// Solve-level facts that live beside the solver arrays, so a resumed run can
// still stamp honest metadata (a team's uplift needs phase 1's EVs, which
// phase 2 never recomputes).
struct CheckpointExtras {
  std::uint64_t baseline_iterations = 0;
  std::vector<double> baseline_ev_chips;
};

// Write `solver`'s state to `path` (atomically: temp file then rename, so an
// interrupted write cannot destroy a good checkpoint). Returns seconds spent.
double write_checkpoint(const std::string& path, const SampledCfrSolver& solver,
                        const SolveConfig& config, const CheckpointExtras& extras);

// Load `path` into `solver`. Returns false with `err` set when the file is
// missing, malformed, or belongs to a DIFFERENT config - never throws for
// those, because "no checkpoint yet" is the normal first run. Throws only if
// the file is valid but the solver rejects the restore.
bool read_checkpoint(const std::string& path, SampledCfrSolver& solver,
                     const SolveConfig& config, CheckpointExtras& extras,
                     std::string& err);

}  // namespace engine
