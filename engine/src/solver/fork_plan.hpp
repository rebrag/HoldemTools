#pragma once
#include <cstdint>
#include <vector>

#include "game/game.hpp"

namespace engine {

// Hard cap on how many times one root-to-leaf path may fork. A safety bound
// on the helper recursion inside ThreadPool and on the scratch arenas alive
// at once; the work threshold below is what actually decides, and on real
// trees it stops well short of this.
inline constexpr int kMaxSplitLevels = 16;

// A node forks when one traversal of its subtree costs at least a threshold
// number of hand-visits (nodes x hands, scaled by Game::visit_cost):
//
//     threshold = clamp(tree total / kForkWorkShare, kForkWorkFloor, kForkWorkCeiling)
//
// All three are MEASURED (docs/roadmap.md, "Work-based forking"), and each
// guards a different failure:
//   - the ceiling keeps tasks small against a big tree, so no single serial
//     task holds the pool up. A flop tree is flat from 2.5e5 to 1.6e7.
//   - the share keeps a SMALL tree forking at all. A fixed 1e6 ran a
//     tight-range turn tree entirely serially, and a threshold near the
//     tree's own total forks the root alone, which is slower still.
//   - the floor stops a river tree being cut into tasks cheaper than the
//     hand-off: one hand-visit is ~3 ns, so 1e4 is ~30 us of work.
inline constexpr double kForkWorkCeiling = 1.0e6;
inline constexpr double kForkWorkFloor = 1.0e4;
inline constexpr double kForkWorkShare = 32.0;

// Replace the threshold outright (negative = back to the rule above).
// Process-wide and settable because fork placement can never change a result
// (siblings write disjoint storage and fold back serially in child order),
// which is exactly what tests/test_parallel.cpp asserts by forcing it to 0 -
// fork at every node - on trees too small to fork much on their own.
void set_fork_work_override(double hand_visits);

// The override for one scope, restored to the automatic rule on the way out.
struct ScopedForkWork {
  explicit ScopedForkWork(double hand_visits) { set_fork_work_override(hand_visits); }
  ~ScopedForkWork() { set_fork_work_override(-1.0); }
  ScopedForkWork(const ScopedForkWork&) = delete;
  ScopedForkWork& operator=(const ScopedForkWork&) = delete;
};

// Which nodes of one game's public tree are worth splitting across the pool.
//
// This replaced a fan-out budget (threads * 4, divided among the children at
// each fork, at most 4 levels deep). The budget knew nothing about subtree
// SIZE: it ran out a few actions into the flop betting, so every deeper line
// - a whole turn-and-river subtree set each - ran as one serial task, and a
// flop solve took the same wall clock at 4 threads as at 40. It also forked
// the top of a river tree into tasks of a few microseconds. Deciding by the
// work under each node fixes both ends.
//
// Tied to ONE tree: it is indexed by NodeId, so every traversal builds the
// plan for the game it is about to walk rather than borrowing another's.
class ForkPlan {
 public:
  ForkPlan() = default;  // never forks
  // `threads` is a resolved count; 1 yields a plan that never forks.
  ForkPlan(const Game& game, int threads);

  // Fork this node's children onto the pool? Never true for a node with
  // fewer than two children.
  bool fork(NodeId id) const { return !fork_.empty() && fork_[id] != 0; }

  // The most forks any root-to-leaf path takes (<= kMaxSplitLevels).
  int max_levels() const { return max_levels_; }

 private:
  std::vector<std::uint8_t> fork_;  // by NodeId; empty = never fork
  int max_levels_ = 0;
};

}  // namespace engine
