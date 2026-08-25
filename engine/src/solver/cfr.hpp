#pragma once
#include <cstddef>
#include <vector>

#include "game/game.hpp"
#include "solver/updates.hpp"

namespace engine {

// Flat storage layout for cumulative regrets and cumulative strategy.
// For decision node d (dense decision_index) with H actor hands and A
// actions, values live at node_offset[d] + hand * A + action. Both arrays
// share this layout. This is the hot data; keep it flat f32 - CFR is
// memory-latency-bound and pointer-chasing here would dominate runtime.
struct InfosetLayout {
  std::vector<std::size_t> node_offset;  // by decision_index
  std::vector<std::uint32_t> node_hands;
  std::vector<std::uint16_t> node_actions;
  std::size_t total = 0;

  static InfosetLayout build(const Game& game);
};

class CfrSolver {
 public:
  CfrSolver(const Game& game, UpdateConfig update);

  // Run one full iteration (one traversal per seat).
  void iterate();
  void run(std::uint64_t iterations);
  std::uint64_t iteration() const { return t_; }

  // Average strategy at a decision node: row-major [hand][action],
  // rows sum to 1 (uniform when the strategy sum is all zero).
  void average_strategy(NodeId node, std::vector<float>& out) const;

  // Current (regret-matched) strategy, same shape.
  void current_strategy(NodeId node, std::vector<float>& out) const;

  const InfosetLayout& layout() const { return layout_; }
  const Game& game() const { return game_; }

  // Estimated bytes for regrets + strategy sums under this layout.
  static std::size_t state_bytes(const Game& game);

 private:
  void apply_discounts();

  const Game& game_;
  UpdateConfig update_;
  InfosetLayout layout_;
  std::vector<float> regrets_;
  std::vector<float> strat_sum_;
  std::uint64_t t_ = 0;

  // Returns counterfactual values for `seat`'s hands at `node`.
  void traverse_impl(NodeId node, int seat, int depth,
                     std::vector<std::vector<float>>& reach,
                     std::vector<float>& out);

  // Scratch buffers keyed by (depth, slot) so recursion reuses allocations.
  std::vector<float>& scratch(int depth, int slot);
  std::vector<std::vector<float>> pool_;
};

}  // namespace engine
