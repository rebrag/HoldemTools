#include "solver/memory.hpp"

#include "game/deal_game.hpp"

#include <algorithm>
#include <cstddef>
#include <sstream>
#include <vector>

#include "io/artifact_writer.hpp"
#include "solver/cfr.hpp"
#include "solver/infoset_indexer.hpp"
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

namespace {

// Storage cells below a node: `full` counts every decision node, `path`
// the most one deal can touch (every decision node along ONE runout - the
// pinned seats' action loops enumerate - one child at each chance node).
struct SubtreeCells {
  std::size_t full = 0;
  std::size_t path = 0;
};

SubtreeCells subtree_cells(const PublicTree& tree, const InfosetIndexer& ix, NodeId id) {
  const Node& node = tree[id];
  SubtreeCells out;
  if (node.kind == NodeKind::Terminal) return out;
  if (node.kind == NodeKind::Chance) {
    for (std::uint16_t c = 0; c < node.num_children; ++c) {
      const SubtreeCells child = subtree_cells(tree, ix, node.first_child + c);
      out.full += child.full;
      out.path = std::max(out.path, child.path);
    }
    return out;
  }
  const std::size_t own = static_cast<std::size_t>(node.num_children) * ix.rows(node.decision_index);
  out.full = own;
  out.path = own;
  for (std::uint16_t c = 0; c < node.num_children; ++c) {
    const SubtreeCells child = subtree_cells(tree, ix, node.first_child + c);
    out.full += child.full;
    out.path += child.path;
  }
  return out;
}

// A ceiling on the cells `deals` deals can touch below a node. Nodes above
// the first chance node are shared by every deal and count once; below a
// chance node at most min(everything, deals x one runout) is reachable.
std::size_t lane_bound(const PublicTree& tree, const InfosetIndexer& ix, NodeId id,
                       std::size_t deals) {
  const Node& node = tree[id];
  if (node.kind == NodeKind::Terminal) return 0;
  if (node.kind == NodeKind::Chance) {
    const SubtreeCells cells = subtree_cells(tree, ix, id);
    return std::min(cells.full, deals * cells.path);
  }
  std::size_t bound = static_cast<std::size_t>(node.num_children) * ix.rows(node.decision_index);
  for (std::uint16_t c = 0; c < node.num_children; ++c) {
    bound += lane_bound(tree, ix, node.first_child + c, deals);
  }
  return bound;
}

// Log entries one PINNED walk can write below `id` for `hero`, along one
// runout: every action at every decision node it visits (regrets at the
// hero's, the average strategy at the others'), with every child descended
// at hero nodes and at opponent nodes under chance sampling, one child under
// external sampling.
std::size_t hero_path_cells(const PublicTree& tree, NodeId id, int hero, bool external) {
  const Node& node = tree[id];
  if (node.kind == NodeKind::Terminal) return 0;
  if (node.kind == NodeKind::Chance) {
    std::size_t best = 0;
    for (std::uint16_t c = 0; c < node.num_children; ++c) {
      best = std::max(best, hero_path_cells(tree, node.first_child + c, hero, external));
    }
    return best;
  }
  if (node.actor == hero) {
    std::size_t total = node.num_children;
    for (std::uint16_t c = 0; c < node.num_children; ++c) {
      total += hero_path_cells(tree, node.first_child + c, hero, external);
    }
    return total;
  }
  std::size_t total = node.num_children;
  std::size_t below_max = 0;
  std::size_t below_sum = 0;
  for (std::uint16_t c = 0; c < node.num_children; ++c) {
    const std::size_t below = hero_path_cells(tree, node.first_child + c, hero, external);
    below_max = std::max(below_max, below);
    below_sum += below;
  }
  return total + (external ? below_max : below_sum);
}

}  // namespace

std::size_t pinned_log_entries_per_lane(const Game& game, const SampledConfig& sampled) {
  const std::size_t deals_per_lane =
      (static_cast<std::size_t>(sampled.batch) + sampled.lanes - 1) / std::max<std::uint32_t>(1, sampled.lanes);
  std::size_t per_deal = 0;
  for (int s = 0; s < game.num_seats(); ++s) {
    per_deal += hero_path_cells(game.tree(), game.tree().root(), s,
                                sampled.update == UpdateScheme::External);
  }
  return deals_per_lane * per_deal;
}

MemoryEstimate estimate_memory(const Game& game, int threads, bool recalc,
                               Precision precision, const SampledConfig* sampled,
                               bool export_bucketed) {
  MemoryEstimate est;
  est.regret_strategy_bytes = CfrSolver::state_bytes(game, precision);
  est.tree_bytes = game.tree().size() * sizeof(Node);
  est.showdown_bytes = game.auxiliary_bytes();
  est.export_bytes = export_pass_bytes(game);

  est.recalc_bytes = CfrSolver::recalc_state_bytes(game, recalc);
  if (sampled != nullptr && sampled->enabled) {
    // The sampled core: master regrets + strategy sums plus one private
    // delta pair per lane, all f32 (it has no i16 mode). Rows per node come
    // from the same InfosetIndexer::plan the solver's constructor runs, so
    // this cannot drift from the allocation. No recalc caches - nothing is
    // re-enumerated there.
    std::size_t total = InfosetLayout::build(game).total;
    std::size_t lane_cells = total;
    std::size_t lane_index_bytes = 0;
    if (const auto* deal_game = dynamic_cast<const DealGame*>(&game)) {
      // A hand-sharing team's decision nodes store one row per JOINT suit
      // orbit - dominant when present, so the estimate must count it.
      std::vector<int> teammate_of;
      int joint_classes = 0;
      if (!sampled->partition_team.empty()) {
        std::vector<std::uint32_t> jc;
        if (deal_game->joint_hand_classes(jc, joint_classes)) {
          teammate_of.assign(static_cast<std::size_t>(game.num_seats()), -1);
          teammate_of[static_cast<std::size_t>(sampled->partition_team[0])] =
              sampled->partition_team[1];
          teammate_of[static_cast<std::size_t>(sampled->partition_team[1])] =
              sampled->partition_team[0];
        }
      }
      const InfosetIndexer ix =
          InfosetIndexer::plan(game, *deal_game, *sampled, teammate_of, joint_classes);
      total = ix.store_total;
      // Sparse per-lane deltas: a lane holds one block per storage group it
      // touched in a batch, and ceil(batch / lanes) deals bound what it can
      // touch (lane_bound). A CEILING - the same runout dealt twice shares
      // its blocks - never above the store itself. Plus the per-lane block
      // index, one u32 per group.
      const std::size_t deals_per_lane =
          (static_cast<std::size_t>(sampled->batch) + sampled->lanes - 1) / sampled->lanes;
      lane_cells = std::min(total, lane_bound(game.tree(), ix, game.tree().root(), deals_per_lane));
      lane_index_bytes = static_cast<std::size_t>(ix.num_groups) * sizeof(std::uint32_t);
      if (export_bucketed) {
        // The bucketed export streams one group's blob at a time; what it
        // holds is the index (one entry per group) and one blob.
        std::size_t max_cells = 0;
        for (const Node& n : game.tree().nodes) {
          if (n.kind != NodeKind::Decision) continue;
          max_cells = std::max(max_cells, static_cast<std::size_t>(ix.rows(n.decision_index)) *
                                              n.num_children);
        }
        est.export_bytes = static_cast<std::size_t>(ix.num_groups) * 24 + max_cells * 4 +
                           static_cast<std::size_t>(game.num_seats()) *
                               static_cast<std::size_t>(ix.num_hands) * sizeof(float);
      }
    }
    // Master plus per-lane sparse blocks: regrets/strategy always; a team
    // adds the conditioned-EV numerator/denominator pair (same size, same
    // lanes).
    const std::size_t arrays_per_tier = sampled->partition_team.empty() ? 2 : 4;
    std::size_t lane_bytes =
        static_cast<std::size_t>(sampled->lanes) *
        (arrays_per_tier * lane_cells * sizeof(float) + lane_index_bytes);
    if (sampled->hero == HeroMode::Pinned) {
      // No blocks: a log of 12-byte entries plus its partitioned copy, per
      // lane, bounded by the tree walk above, and the lane's shard offsets.
      const std::size_t entries = pinned_log_entries_per_lane(game, *sampled);
      const std::size_t shards =
          sampled->fold_shards > 0 ? sampled->fold_shards
                                   : static_cast<std::size_t>(resolve_thread_count(threads)) * 4;
      lane_bytes = static_cast<std::size_t>(sampled->lanes) *
                   (2 * entries * 12 + (shards + 1) * sizeof(std::size_t) + kHeapBlockOverhead);
    }
    est.regret_strategy_bytes = arrays_per_tier * total * sizeof(float) + lane_bytes;
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
