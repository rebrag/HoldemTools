#pragma once
#include <cstdint>
#include <functional>
#include <utility>
#include <vector>

#include "game/game.hpp"
#include "solver/infoset_indexer.hpp"
#include "solver/strategy_source.hpp"

namespace engine {

// An exact (per-hand) strategy PROJECTED onto a bucket map: every hand's row
// becomes the mean of its bucket's rows, weighted by the actor's REACH at
// the node when the source can supply it (an ArtifactStrategySource can)
// and by the starting range otherwise. Rating this with
// compute_best_response measures what the abstraction alone costs - the
// representational error, with no sampling noise in it - and it is cheap
// enough to sweep bucket counts before any sampled solve is run.
//
// Reach weighting is not cosmetic. Deep in the tree most of a bucket's
// members never arrive (they folded earlier), and their exact rows are
// untrained placeholders; a range-weighted mean lets those placeholders
// outvote the hands that are actually there and reports an abstraction
// error that is mostly the probe's own. Measured on the 3-way turn spot:
// 5% of pot range-weighted at near-per-hand bucket counts, where the exact
// solve is at 0.13%.
//
// The remaining caveat: CFR on the abstract game need not converge to this
// projection - it can do better (a different abstract equilibrium) or worse
// (abstraction pathology). The bucketed solve's own exact best response is
// the real number; this one ranks candidates.
//
// Hands the node's board blocks (never trained, reach zero everywhere)
// export uniform, as the sampled core does.
class BucketProjectedSource final : public StrategySource {
 public:
  using ReachFn = std::function<const std::vector<float>*(NodeId)>;

  BucketProjectedSource(const Game& game, const StrategySource& exact, const InfosetIndexer& indexer,
                        ReachFn reach = {})
      : game_(game), exact_(exact), indexer_(indexer), reach_(std::move(reach)) {}

  void average_strategy(NodeId id, std::vector<float>& out) const override {
    exact_.average_strategy(id, out);
    if (indexer_.mode != InfosetIndexer::Mode::Abstraction) return;
    const Node& node = game_.tree()[id];
    const std::uint32_t d = node.decision_index;
    const std::uint32_t rows = indexer_.rows(d);
    const std::uint16_t* map = indexer_.map(d);
    const std::uint8_t* valid = indexer_.valid(d);
    const int actions = node.num_children;
    const std::size_t hands = static_cast<std::size_t>(game_.num_hands(node.actor));
    if (rows >= hands) return;  // per-hand street: nothing to project
    const std::vector<float>* weights = reach_ ? reach_(id) : nullptr;
    const std::vector<float>& range = weights != nullptr ? *weights : game_.initial_range(node.actor);
    std::vector<double> acc(static_cast<std::size_t>(rows) * actions, 0.0);
    std::vector<double> weight(rows, 0.0);
    for (std::size_t h = 0; h < hands; ++h) {
      if (valid != nullptr && !valid[h]) continue;
      const double w = range[h];
      if (w <= 0.0) continue;
      const std::size_t r = map[h];
      weight[r] += w;
      for (int a = 0; a < actions; ++a) {
        acc[r * actions + a] += w * out[h * actions + a];
      }
    }
    for (std::size_t h = 0; h < hands; ++h) {
      float* row = out.data() + h * actions;
      if (valid != nullptr && !valid[h]) {
        for (int a = 0; a < actions; ++a) row[a] = 1.0f / static_cast<float>(actions);
        continue;
      }
      const std::size_t r = map[h];
      if (weight[r] <= 0.0) continue;  // a bucket no range hand reaches: keep the exact row
      for (int a = 0; a < actions; ++a) {
        row[a] = static_cast<float>(acc[r * actions + a] / weight[r]);
      }
    }
  }
  ThreadPool& pool() const override { return exact_.pool(); }
  int split_budget() const override { return exact_.split_budget(); }
  std::uint64_t iteration() const override { return exact_.iteration(); }
  const QreConfig& qre() const override { return exact_.qre(); }

 private:
  const Game& game_;
  const StrategySource& exact_;
  const InfosetIndexer& indexer_;
  ReachFn reach_;
};

}  // namespace engine
