#pragma once
#include <cstdint>
#include <vector>

#include "game/public_tree.hpp"
#include "solver/cfr.hpp"
#include "solver/updates.hpp"
#include "util/parallel.hpp"

namespace engine {

// The read-side contract a solved strategy exposes to its cold consumers -
// the best-response pass and the artifact writer. Those two use exactly this
// surface and nothing else, which is what makes a second solver core (the
// sampled-deal path) plug into both without either knowing which core ran.
//
// CfrSolver deliberately does NOT inherit this. Its hot path is guarded by a
// bit-identity invariant, and adding a vtable or shifting member offsets is
// exactly the kind of "harmless" change that rule exists to forbid. The
// adapter below is the bridge instead: non-intrusive, allocation-free, and
// only ever constructed on cold paths.
class StrategySource {
 public:
  virtual ~StrategySource() = default;

  // Average strategy at a decision node: row-major [hand][action], rows
  // summing to 1. Identical contract to CfrSolver::average_strategy.
  virtual void average_strategy(NodeId node, std::vector<float>& out) const = 0;

  // The thread pool the solve owns; consumers reuse it so one solve owns one
  // set of threads.
  virtual ThreadPool& pool() const = 0;

  // Fan-out budget handed to the root of a traversal; 1 disables splitting.
  virtual int split_budget() const = 0;

  // Iterations completed. The QRE best response reads it for the lambda
  // schedule.
  virtual std::uint64_t iteration() const = 0;

  // The regularization in force (disabled default when the core has none).
  virtual const QreConfig& qre() const = 0;
};

// Adapter over the vectorized core. Holds a reference only - the solver must
// outlive it, which every call site satisfies by constructing it inline.
class CfrStrategySource final : public StrategySource {
 public:
  explicit CfrStrategySource(const CfrSolver& solver) : solver_(solver) {}

  void average_strategy(NodeId node, std::vector<float>& out) const override {
    solver_.average_strategy(node, out);
  }
  ThreadPool& pool() const override { return solver_.pool(); }
  int split_budget() const override { return solver_.split_budget(); }
  std::uint64_t iteration() const override { return solver_.iteration(); }
  const QreConfig& qre() const override { return solver_.qre(); }

 private:
  const CfrSolver& solver_;
};

}  // namespace engine
