#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "config/schema.hpp"
#include "game/game.hpp"
#include "io/artifact_store.hpp"
#include "solver/cfr.hpp"
#include "solver/strategy_source.hpp"

namespace engine {

struct SolveStats {
  std::uint64_t iterations = 0;
  double nashconv = 0.0;
  std::vector<double> ev_chips;  // per-seat root EVs in chips; they sum to the root pot
  // Team solves (M9). Empty/default on everything else.
  std::vector<int> team_seats;             // the hand-sharing pair
  std::string awareness;                   // "aware" | "unaware" | ""
  std::vector<double> baseline_ev_chips;   // unaware: the frozen no-team reference EVs
  bool nashconv_valid = true;              // false when nashconv is not a meaningful measure
  // Why the loop ended, when it was not "ran the whole budget": currently
  // only "time_budget" (budget.max_seconds expired). Stamped into metadata
  // so a consumer can tell a short solve from a converged one - `iterations`
  // alone looks like the user simply asked for fewer.
  std::string stopped_reason;
  nlohmann::json team_rollup;              // conditioned 169x169 chart per team node
  // Wall clock for the whole solve loop (CFR + every checkpoint's
  // best-response), and the worker count it ran on. Both are reported so a
  // timing comparison against another solver is interpretable.
  double wall_time_s = 0.0;
  double setup_time_s = 0.0;  // tree build + showdown tables, before iterating
  // Filled in BY write_artifact, not by the caller: seconds spent in the
  // export pass and the file write. Kept separate from wall_time_s rather
  // than folded into it, because wall_time_s is what the Pio harness compares
  // against Pio's own solve time and redefining it would silently move every
  // ratio ever recorded. It exists because it was hidden: on a real flop tree
  // the export is ~24% of the process and ran on one core, so a solve that
  // reported 56 s took 74 s. See docs/roadmap.md.
  double export_time_s = 0.0;
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
// Returns seconds spent in the export pass and file write - the phase that
// wall_time_s deliberately excludes. Callers that ignore it lose nothing;
// main prints it so the number stops being invisible.
double write_artifact(ArtifactStore& store, const std::string& path, const Game& game,
                    const StrategySource& source, const SolveConfig& config,
                    const SolveStats& stats);

// The vectorized core's convenience overload, mirroring best_response.hpp.
inline double write_artifact(ArtifactStore& store, const std::string& path, const Game& game,
                    const CfrSolver& solver, const SolveConfig& config,
                    const SolveStats& stats) {
  return write_artifact(store, path, game, CfrStrategySource(solver), config, stats);
}

}  // namespace engine
