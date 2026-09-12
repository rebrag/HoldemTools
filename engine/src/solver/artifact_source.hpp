#pragma once
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "game/game.hpp"
#include "io/artifact_reader.hpp"
#include "solver/strategy_source.hpp"
#include "util/parallel.hpp"

namespace engine {

// A solved strategy read back off an artifact, so the best-response pass
// can rate any .hta against the game it was solved on without re-solving
// it. Every decision node's rows are loaded up front (the reader is not
// thread-safe and the best response is threaded); hands the artifact
// dropped as unreached read uniform, which is what the solver would have
// exported for them.
//
// The artifact must have been written for THIS game: same tree, same hand
// dictionaries. That is checked on the node count and dictionary sizes,
// which is what the reader can see.
class ArtifactStrategySource final : public StrategySource {
 public:
  ArtifactStrategySource(const Game& game, const ArtifactReader& reader, int threads)
      : game_(game), pool_(std::make_unique<ThreadPool>(resolve_thread_count(threads))) {
    const PublicTree& tree = game.tree();
    if (reader.nodes().size() != tree.size()) {
      throw std::runtime_error("artifact tree has " + std::to_string(reader.nodes().size()) +
                               " nodes, the game has " + std::to_string(tree.size()));
    }
    rows_.resize(tree.num_decision_nodes);
    for (NodeId id = 0; id < tree.size(); ++id) {
      const Node& node = tree[id];
      if (node.kind != NodeKind::Decision) continue;
      const ArtifactNodeData data = reader.read_node(id);
      const int hands = game.num_hands(node.actor);
      const int actions = node.num_children;
      std::vector<float>& rows = rows_[node.decision_index];
      rows.assign(static_cast<std::size_t>(hands) * actions, 1.0f / static_cast<float>(actions));
      const ArtifactSeatData& actor = data.seats[data.actor];
      for (std::size_t i = 0; i < actor.idx.size(); ++i) {
        const std::size_t h = actor.idx[i];
        for (int a = 0; a < actions; ++a) {
          rows[h * actions + a] = data.strategy[i * actions + a];
        }
      }
    }
    iterations_ = reader.metadata().value("iterations", std::uint64_t{0});
    split_budget_ = pool_->threads() > 1 ? pool_->threads() * 4 : 1;
  }

  void average_strategy(NodeId id, std::vector<float>& out) const override {
    out = rows_[game_.tree()[id].decision_index];
  }
  ThreadPool& pool() const override { return *pool_; }
  int split_budget() const override { return split_budget_; }
  std::uint64_t iteration() const override { return iterations_; }
  const QreConfig& qre() const override { return qre_; }

 private:
  const Game& game_;
  std::vector<std::vector<float>> rows_;  // by decision index, [hand][action]
  std::unique_ptr<ThreadPool> pool_;
  std::uint64_t iterations_ = 0;
  int split_budget_ = 1;
  QreConfig qre_{};
};

}  // namespace engine
