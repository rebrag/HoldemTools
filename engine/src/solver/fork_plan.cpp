#include "solver/fork_plan.hpp"

#include <algorithm>
#include <atomic>
#include <cstddef>

namespace engine {

namespace {
std::atomic<double> g_work_override{-1.0};
}  // namespace

void set_fork_work_override(double hand_visits) {
  g_work_override.store(hand_visits, std::memory_order_relaxed);
}

ForkPlan::ForkPlan(const Game& game, int threads) {
  if (threads <= 1) return;
  const PublicTree& tree = game.tree();
  const std::size_t n = tree.size();
  if (n == 0) return;

  int hands = 1;
  for (int s = 0; s < game.num_seats(); ++s) hands = std::max(hands, game.num_hands(s));

  // Subtree work, children into parents. A parent's id is always below its
  // children's (the builders append children after their parent), so one
  // descending sweep is a post-order accumulation.
  std::vector<double> work(n);
  for (std::size_t id = 0; id < n; ++id) {
    work[id] = static_cast<double>(hands) * game.visit_cost(static_cast<NodeId>(id));
  }
  for (std::size_t id = n - 1; id > 0; --id) work[tree[static_cast<NodeId>(id)].parent] += work[id];

  double min_work =
      std::clamp(work[0] / kForkWorkShare, kForkWorkFloor, kForkWorkCeiling);
  if (const double forced = g_work_override.load(std::memory_order_relaxed); forced >= 0.0) {
    min_work = forced;
  }
  fork_.assign(n, 0);
  std::vector<std::uint8_t> level(n, 0);  // forks taken on the path above
  for (std::size_t id = 0; id < n; ++id) {
    const Node& node = tree[static_cast<NodeId>(id)];
    if (id > 0) {
      level[id] = static_cast<std::uint8_t>(level[node.parent] + fork_[node.parent]);
    }
    if (node.kind == NodeKind::Terminal || node.num_children < 2) continue;
    if (work[id] < min_work || level[id] >= kMaxSplitLevels) continue;
    fork_[id] = 1;
    max_levels_ = std::max(max_levels_, static_cast<int>(level[id]) + 1);
  }
  if (max_levels_ == 0) fork_ = {};  // nothing is big enough: same as serial
}

}  // namespace engine
