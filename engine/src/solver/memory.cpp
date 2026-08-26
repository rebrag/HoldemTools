#include "solver/memory.hpp"

#include <algorithm>
#include <cstddef>
#include <sstream>
#include <vector>

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
  out << "estimated solver memory: " << human(total())
      << " (regrets+strategy " << human(regret_strategy_bytes)
      << ", tree " << human(tree_bytes)
      << ", showdown " << human(showdown_bytes)
      << ", recalc " << human(recalc_bytes)
      << ", workspace ceiling " << human(workspace_bytes) << ")";
  return out.str();
}

MemoryEstimate estimate_memory(const Game& game, int threads, bool recalc) {
  MemoryEstimate est;
  est.regret_strategy_bytes = CfrSolver::state_bytes(game);
  est.tree_bytes = game.tree().size() * sizeof(Node);
  est.showdown_bytes = game.auxiliary_bytes();

  if (recalc && game.num_seats() == 2) {
    // One slot per chance-node child, per seat: cached value vector + reach
    // snapshot, both hand-universe wide.
    std::size_t chance_children = 0;
    for (const Node& n : game.tree().nodes) {
      if (n.kind == NodeKind::Chance) chance_children += n.num_children;
    }
    std::size_t hands = 0;
    for (int s = 0; s < game.num_seats(); ++s) {
      hands = std::max(hands, static_cast<std::size_t>(game.num_hands(s)));
    }
    est.recalc_bytes = chance_children * 2 /*seats*/ * 2 /*value+snapshot*/ * hands *
                       sizeof(float);
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
  // Per level: sigma (hands*actions), value + child + reach-weight (hands
  // each), one saved reach per seat (hands each). Mirrors one CfrSolver
  // scratch arena; a multithreaded solve checks out several at once.
  const std::size_t per_level =
      max_hands * max_actions + (3 + game.num_seats()) * max_hands;
  const std::size_t arena =
      static_cast<std::size_t>(max_depth + 2) * per_level * sizeof(float);
  est.workspace_bytes =
      arena * static_cast<std::size_t>(max_live_arenas(resolve_thread_count(threads)));
  return est;
}

std::size_t peak_rss_bytes() {
#if defined(_WIN32)
  PROCESS_MEMORY_COUNTERS counters;
  if (GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters))) {
    return counters.PeakWorkingSetSize;
  }
  return 0;
#else
  struct rusage usage;
  if (getrusage(RUSAGE_SELF, &usage) == 0) {
    return static_cast<std::size_t>(usage.ru_maxrss) * 1024;  // ru_maxrss is KB on Linux
  }
  return 0;
#endif
}

}  // namespace engine
