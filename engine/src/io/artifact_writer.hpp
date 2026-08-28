#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

#include "config/schema.hpp"
#include "game/game.hpp"
#include "io/artifact_store.hpp"
#include "solver/cfr.hpp"

namespace engine {

struct SolveStats {
  std::uint64_t iterations = 0;
  double nashconv = 0.0;
  double ev_seat0 = 0.0;  // chips, root
  double ev_seat1 = 0.0;
  // Wall clock for the whole solve loop (CFR + every checkpoint's
  // best-response), and the worker count it ran on. Both are reported so a
  // timing comparison against another solver is interpretable.
  double wall_time_s = 0.0;
  double setup_time_s = 0.0;  // tree build + showdown tables, before iterating
  int threads = 1;
  // Subtree traversals the recalc schedule skipped. Observability: a solve
  // where this stays 0 on a multistreet tree means the schedule never
  // engaged (bad epsilons, or a spot that never settles).
  std::uint64_t recalc_skips = 0;
  // Peak resident bytes at the END OF THE SOLVE LOOP, before the artifact is
  // written. Deliberately not the whole-run peak: the export pass inside
  // write_artifact is usually larger, and this is the number that is
  // comparable against the memory estimate's solver terms (and against
  // another solver's reported footprint). write_artifact samples the
  // whole-run peak itself and writes both into the metadata.
  std::size_t peak_rss_bytes = 0;
  // QRE only: exploitability in the entropy-augmented game, the quantity a
  // QRE solve actually drives to zero. `nashconv` above stays the PLAIN
  // (unregularized) number for the same solve, which plateaus by design -
  // both are recorded so the plateau is visible rather than mistaken for a
  // stall. Zero when qre.mode is "nash".
  double qre_gap = 0.0;
};

// Bytes the export pass inside write_artifact holds live at its peak. It
// keeps one per-node export record for EVERY decision node alive at once, so
// on a flop tree it is the largest allocation of the whole run - the memory
// estimator counts it (see MemoryEstimate::export_bytes) and the fail-fast
// limit check depends on it. Pure sizing: allocates nothing, solves nothing.
std::size_t export_pass_bytes(const Game& game);

// Write a version-1 .hta artifact for a solved 2-seat game. Layout per
// engine/docs/artifact-format.md: header, metadata JSON, node table, hand
// dictionaries, per-decision-node blobs (sparse per-hand reach/EV/strategy,
// optional trailing 169-class rollup), node index at EOF.
void write_artifact(ArtifactStore& store, const std::string& path, const Game& game,
                    const CfrSolver& solver, const SolveConfig& config,
                    const SolveStats& stats);

}  // namespace engine
