#pragma once
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
  std::size_t peak_rss_bytes = 0;
};

// Write a version-1 .hta artifact for a solved 2-seat game. Layout per
// engine/docs/artifact-format.md: header, metadata JSON, node table, hand
// dictionaries, per-decision-node blobs (sparse per-hand reach/EV/strategy,
// optional trailing 169-class rollup), node index at EOF.
void write_artifact(ArtifactStore& store, const std::string& path, const Game& game,
                    const CfrSolver& solver, const SolveConfig& config,
                    const SolveStats& stats);

}  // namespace engine
