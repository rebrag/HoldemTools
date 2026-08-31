#pragma once
#include <cstdint>
#include <memory>
#include <vector>

#include "game/deal_game.hpp"
#include "game/game.hpp"
#include "solver/strategy_source.hpp"
#include "solver/updates.hpp"
#include "util/parallel.hpp"

namespace engine {

// The sampled-deal solver core (M8c): chance-sampled CFR with the hero
// vectorized. Each iteration draws ONE concrete deal - a hand per seat plus
// a board, without replacement - and runs one traversal per seat against it.
// The traversing seat stays vectorized over its whole compact universe (its
// hands colliding with the deal zeroed, so hero blockers are exact); every
// other seat is pinned to its dealt hand and walks as a scalar reach.
//
// What this buys over the vectorized core it complements:
//   - Bunching is exact in expectation at ANY seat count, by construction:
//     two seats cannot hold the same card, and a concrete deal's terminal
//     payoffs sum to the pot deal by deal. Chip conservation is a property
//     of every sample instead of a correction that provably cannot close at
//     4+ seats (see nlhe_preflop.cpp's factorized estimator).
//   - The combo universe never appears squared: PLO's 270,725 combos are
//     reachable here and dead on arrival in a product-of-ranges terminal.
// What it costs: stochastic convergence (~1/sqrt(T)) instead of the
// vectorized core's exact gradient, which is why heads-up postflop stays on
// CfrSolver, byte-identical and untouched.
//
// Determinism contract, matching the repo invariant: the result is a pure
// function of (seed, iterations, batch, lanes) and NEVER of the thread
// count. Iteration t's deal is a counter-based function of (seed, t);
// batches of `batch` iterations run against regrets frozen at batch start
// (lanes only read the master and write private delta buffers, so freezing
// costs nothing); iteration t belongs to lane t % lanes, each lane
// accumulates its deltas in ascending t, and lanes fold into the master
// SERIALLY in lane order after the join. Any assignment of lanes to threads
// produces identical bits.
//
// Discounting is linear per batch (LCFR at batch granularity): before batch
// n (1-based) folds in, the master arrays scale by (n-1)/n, so batch k's
// contribution carries weight k/n - bounded magnitude, deterministic, and
// the standard cure for MCCFR's early-noise hangover.
class SampledCfrSolver final : public StrategySource {
 public:
  // `game` and `deals` must be the same object wearing both interfaces.
  SampledCfrSolver(const Game& game, const DealGame& deals, const SampledConfig& config,
                   int threads = 1);

  void run(std::uint64_t iterations);

  // StrategySource: the artifact writer and best-response pass plug in here.
  std::uint64_t iteration() const override { return t_; }
  void average_strategy(NodeId node, std::vector<float>& out) const override;
  ThreadPool& pool() const override { return *pool_; }
  // The BR pass forks its own subtree parallelism from this; 1 keeps it
  // serial per seat, which is right for the small trees this core runs today.
  int split_budget() const override { return 1; }
  const QreConfig& qre() const override { return qre_; }

  const InfosetLayout& layout() const { return layout_; }
  const Game& game() const { return game_; }
  // Read seams for the determinism test: bitwise equality across thread
  // counts is asserted on the raw arrays, never on derived quantities.
  const std::vector<float>& regrets() const { return regrets_; }
  const std::vector<float>& strategy_sums() const { return strat_sum_; }

 private:
  // Everything one lane touches while its iterations run: private delta
  // buffers plus per-depth scratch so the recursion allocates nothing.
  struct Lane {
    std::vector<float> regret_delta, strat_delta;
    Deal deal;
    std::vector<std::uint32_t> strengths;
    std::vector<float> hero_root;                  // masked root reach
    std::vector<std::uint16_t> blocked;            // hero hands colliding with the deal
    std::vector<std::vector<float>> sigma_stack;   // per depth: A*H action-major
    std::vector<std::vector<float>> child_stack;   // per depth: A*H child values
    std::vector<std::vector<float>> reach_stack;   // per depth: H hero reach
    std::vector<std::vector<float>> value_stack;   // per depth: H out values
  };

  void run_iteration(std::uint64_t t, Lane& lane);
  // Counterfactual values for `hero`'s hands at `id` under the lane's deal,
  // scaled by the pinned opponents' reach `opp_w`. Writes into out (length =
  // hero hands).
  void traverse(NodeId id, int hero, Lane& lane, double opp_w,
                const std::vector<float>& hero_reach, int chance_depth, int depth,
                std::vector<float>& out);

  const Game& game_;
  const DealGame& deals_;
  SampledConfig config_;
  InfosetLayout layout_;
  std::vector<float> regrets_;
  std::vector<float> strat_sum_;
  std::vector<Lane> lanes_;
  std::unique_ptr<ThreadPool> pool_;
  QreConfig qre_{};  // never enabled here; StrategySource contract only
  std::uint64_t t_ = 0;
  std::uint64_t batches_done_ = 0;
  int max_depth_ = 0;
};

}  // namespace engine
