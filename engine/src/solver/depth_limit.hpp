#pragma once
#include <array>
#include <cstdint>
#include <vector>

#include "game/game.hpp"
#include "game/public_tree.hpp"
#include "solver/strategy_source.hpp"

namespace engine {

// Depth-limited solving support: the plumbing that lets a TRUNCATED tree
// (built with PostflopTreeParams::depth_limit) borrow its continuation
// values from a full solve, and lets the resulting strategy be measured
// back in the full game.
//
// The shape of the experiment this exists for:
//
//   1. solve the FULL tree                        -> the blueprint
//   2. blueprint_leaf_values() at the boundary    -> the leaf table
//   3. solve the TRUNCATED tree with that table   -> the depth-limited strategy
//   4. HybridStrategySource + compute_best_response over the FULL tree
//                                                 -> its real exploitability
//
// Step 4 is the point. A depth-limited solve only produces a strategy above
// the limit, so it is not a complete strategy and cannot be evaluated on its
// own; completing it with the blueprint below the limit is what makes the
// exploitability number mean "what does truncation actually cost".

// Correspondence between a truncated tree and the full tree built from the
// same parameters. The two builders agree node for node until the truncation
// point, so this is a lockstep descent rather than a search.
struct TruncationMap {
  // full node id for each truncated node id.
  std::vector<NodeId> to_full;
  // truncated node id for each full node id, kNoNode below the boundary.
  std::vector<NodeId> to_trunc;
  // Full-tree nodes that stand where the truncated tree has a DepthLimit
  // terminal. Chance nodes in the full tree, one per truncated leaf.
  std::vector<NodeId> boundary_full;
  // The truncated DepthLimit terminal matching each entry above.
  std::vector<NodeId> boundary_trunc;
};

// Throws if the two trees disagree anywhere above the boundary, which would
// mean they were built from different parameters.
TruncationMap map_truncated_tree(const PublicTree& trunc, const PublicTree& full);

// On-profile counterfactual values at the boundary, divided by the
// opponent's compatible reach mass there, i.e. the CONDITIONAL continuation
// value per hand. Indexed [terminal_index * num_hands + hand] over the
// TRUNCATED tree's terminals, which is what NlhePostflopGame::set_leaf_values
// expects. Rows for terminals that are not DepthLimit stay zero.
//
// `full_game` and `trunc_terminals` must come from the same config; the
// caller supplies the map from map_truncated_tree.
std::array<std::vector<float>, 2> blueprint_leaf_values(const Game& full_game,
                                                        const StrategySource& blueprint,
                                                        const TruncationMap& map,
                                                        std::uint32_t trunc_terminals,
                                                        const PublicTree& trunc);

// The EXACT leaf model, for NlhePostflopGame::set_leaf_matrices: per
// truncated terminal, u0[o * num_hands + h] under the blueprint continuation.
//
// Computed by running one traversal of the subtree below each boundary node
// per opponent hand, with that seat's reach set to a one-hot vector - which
// makes the returned counterfactual value vector exactly one column of the
// matrix. That is `num_hands` traversals per leaf, embarrassingly parallel,
// and it is the whole reason this is affordable: no per-hand-pair walk.
//
// Only seat 0's matrix is built. Seat 1's is not an independent quantity:
// u0(h,o) + u1(o,h) is the root pot at every terminal below the leaf, so the
// game evaluates seat 1 by subtraction and cannot drift out of zero-sum.
std::vector<std::vector<float>> blueprint_leaf_matrices(const Game& full_game,
                                                        const StrategySource& blueprint,
                                                        const TruncationMap& map,
                                                        std::uint32_t trunc_terminals,
                                                        const PublicTree& trunc);

// The blueprint's own strategy, re-addressed by TRUNCATED node id.
//
// This is the correctness gate for everything above. Evaluating the truncated
// game through it must reproduce the blueprint's per-seat root EVs, because
// the leaf table was built against exactly these reach vectors - the frozen
// range shape is the true one when the strategy above the limit is the
// blueprint's. A mismatch means the truncation, the node mapping or the leaf
// table is wrong; agreement means any exploitability the depth-limited solve
// shows afterwards is the approximation's real cost and not a plumbing bug.
class BlueprintOnTruncatedSource final : public StrategySource {
 public:
  BlueprintOnTruncatedSource(const StrategySource& blueprint, const TruncationMap& map)
      : blueprint_(blueprint), map_(map) {}

  void average_strategy(NodeId node, std::vector<float>& out) const override {
    blueprint_.average_strategy(map_.to_full[node], out);
  }
  ThreadPool& pool() const override { return blueprint_.pool(); }
  int split_budget() const override { return blueprint_.split_budget(); }
  std::uint64_t iteration() const override { return blueprint_.iteration(); }
  const QreConfig& qre() const override { return blueprint_.qre(); }

 private:
  const StrategySource& blueprint_;
  const TruncationMap& map_;
};

// A complete strategy over the FULL tree: the depth-limited solve above the
// limit, the blueprint below it. Holds references only.
class HybridStrategySource final : public StrategySource {
 public:
  // `trunc` is the truncated tree the `limited` solve ran on; it is read to
  // tell a decision node above the limit (whose strategy comes from that
  // solve) from the boundary terminal itself (which owns none).
  HybridStrategySource(const StrategySource& blueprint, const StrategySource& limited,
                       const TruncationMap& map, const PublicTree& trunc)
      : blueprint_(blueprint), limited_(limited), map_(map), trunc_(trunc) {}

  void average_strategy(NodeId node, std::vector<float>& out) const override;
  ThreadPool& pool() const override { return blueprint_.pool(); }
  int split_budget() const override { return blueprint_.split_budget(); }
  std::uint64_t iteration() const override { return blueprint_.iteration(); }
  const QreConfig& qre() const override { return blueprint_.qre(); }

 private:
  const StrategySource& blueprint_;
  const StrategySource& limited_;
  const TruncationMap& map_;
  const PublicTree& trunc_;
};

}  // namespace engine
