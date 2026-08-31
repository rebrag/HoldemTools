#include "solver/memory.hpp"

#include "game/deal_game.hpp"

#include <algorithm>
#include <cstddef>
#include <sstream>
#include <vector>

#include "io/artifact_writer.hpp"
#include "solver/cfr.hpp"
#include "util/parallel.hpp"

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <psapi.h>
#else
#include <sys/resource.h>
#endif

namespace engine {

namespace {
std::string human(std::size_t bytes) {
  std::ostringstream out;
  const double mb = static_cast<double>(bytes) / (1024.0 * 1024.0);
  if (mb >= 1024.0) {
    out.precision(2);
    out << std::fixed << mb / 1024.0 << " GB";
  } else {
    out.precision(1);
    out << std::fixed << mb << " MB";
  }
  return out.str();
}
}  // namespace

std::string MemoryEstimate::to_string() const {
  std::ostringstream out;
  out << "estimated peak memory: " << human(total())
      << " (regrets+strategy " << human(regret_strategy_bytes)
      << ", tree " << human(tree_bytes)
      << ", showdown " << human(showdown_bytes)
      << ", recalc " << human(recalc_bytes)
      << ", workspace ceiling " << human(workspace_bytes)
      << ", artifact export " << human(export_bytes) << ")";
  return out.str();
}

MemoryEstimate estimate_memory(const Game& game, int threads, bool recalc,
                               Precision precision, const SampledConfig* sampled) {
  MemoryEstimate est;
  est.regret_strategy_bytes = CfrSolver::state_bytes(game, precision);
  est.tree_bytes = game.tree().size() * sizeof(Node);
  est.showdown_bytes = game.auxiliary_bytes();
  est.export_bytes = export_pass_bytes(game);

  est.recalc_bytes = CfrSolver::recalc_state_bytes(game, recalc);
  if (sampled != nullptr && sampled->enabled) {
    // The sampled core: master regrets + strategy sums plus one private
    // delta pair per lane, all f32 (it has no i16 mode). Rows are per suit
    // CLASS when the symmetry quotient is on - the same arithmetic the
    // solver's constructor performs, so this cannot drift from the
    // allocation. No recalc caches - nothing is re-enumerated there.
    const InfosetLayout layout = InfosetLayout::build(game);
    std::size_t total = layout.total;
    if (sampled->symmetry) {
      if (const auto* deal_game = dynamic_cast<const DealGame*>(&game)) {
        std::vector<std::uint16_t> class_of;
        int num_classes = 0;
        deal_game->hand_classes(class_of, num_classes);
        if (num_classes > 0) {
          total = 0;
          for (const Node& n : game.tree().nodes) {
            if (n.kind != NodeKind::Decision) continue;
            total += static_cast<std::size_t>(layout.node_actions[n.decision_index]) *
                     static_cast<std::size_t>(num_classes);
          }
        }
      }
    }
    est.regret_strategy_bytes =
        static_cast<std::size_t>(sampled->lanes + 1) * 2 * total * sizeof(float);
    est.recalc_bytes = 0;
  }

  const PublicTree& tree = game.tree();
  std::vector<int> depth(tree.size(), 0);
  int max_depth = 0;
  for (NodeId id = 1; id < tree.size(); ++id) {
    depth[id] = depth[tree[id].parent] + 1;
    if (depth[id] > max_depth) max_depth = depth[id];
  }
  std::size_t max_hands = 0;
  std::size_t max_actions = 1;
  for (int s = 0; s < game.num_seats(); ++s) {
    max_hands = std::max(max_hands, static_cast<std::size_t>(game.num_hands(s)));
  }
  for (const Node& n : tree.nodes) {
    max_actions = std::max(max_actions, static_cast<std::size_t>(n.num_children));
  }
  // Per level: sigma (hands*actions), child + reach-weight + QRE compat
  // (hands each), one saved reach per seat (hands each). Mirrors one
  // CfrSolver scratch arena; a multithreaded solve checks out several at
  // once. There is no value slot - actor decision nodes accumulate into the
  // caller's `out` buffer. The compat slot is counted whether or not QRE is
  // on, because the arena is sized by kSlotsPerLevel, not by a runtime flag.
  const std::size_t per_level =
      max_hands * max_actions + (3 + game.num_seats()) * max_hands;
  const std::size_t arena =
      static_cast<std::size_t>(max_depth + 2) * per_level * sizeof(float);
  est.workspace_bytes =
      arena * static_cast<std::size_t>(max_live_arenas(resolve_thread_count(threads)));
  return est;
}

PeakMemory peak_memory() {
#if defined(_WIN32)
  // PeakWorkingSetSize and PeakPagefileUsage are both SIZE_T members of the
  // BASE counters struct, so reading private commit needs no _EX variant and
  // no cb juggling. Both are 64-bit on x64 and neither saturates: an earlier
  // 4x gap against tasklist was a sampling-time bug, not a counter width one.
  PROCESS_MEMORY_COUNTERS counters{};
  counters.cb = sizeof(counters);
  if (GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters))) {
    return {counters.PeakWorkingSetSize, counters.PeakPagefileUsage};
  }
  return {};
#else
  struct rusage usage;
  if (getrusage(RUSAGE_SELF, &usage) == 0) {
    // ru_maxrss is KB on Linux. POSIX exposes no peak-commit counter, so the
    // commit figure stays 0 rather than being faked from the resident one.
    return {static_cast<std::size_t>(usage.ru_maxrss) * 1024, 0};
  }
  return {};
#endif
}

std::size_t peak_rss_bytes() { return peak_memory().working_set; }

}  // namespace engine
