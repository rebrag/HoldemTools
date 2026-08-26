#include <doctest/doctest.h>

#include <cstddef>
#include <cstdint>

#include "game/toy/kuhn.hpp"
#include "solver/cfr.hpp"
#include "solver/memory.hpp"

using namespace engine;

TEST_CASE("memory estimate matches the sizing rule") {
  toy::KuhnGame game;
  // Kuhn: 4 decision nodes, 3 hands, 2 actions each. Regret + strategy
  // arrays: 4 * 3 * 2 cells * 2 arrays * 4 bytes = 192 bytes - the
  // nodes x hands x actions x 8 rule - plus a u32 discount stamp per
  // decision node, which the estimator must count because the solver
  // allocates it.
  constexpr std::size_t kStamps = 4 * sizeof(std::uint32_t);
  CHECK(CfrSolver::state_bytes(game) == 4 * 3 * 2 * 8 + kStamps);

  const MemoryEstimate estimate = estimate_memory(game);
  CHECK(estimate.regret_strategy_bytes == 192 + kStamps);
  CHECK(estimate.tree_bytes == game.tree().size() * sizeof(Node));
  CHECK(estimate.workspace_bytes > 0);
  CHECK(estimate.recalc_bytes == 0);  // Kuhn has no chance nodes
  CHECK(estimate.total() == estimate.regret_strategy_bytes + estimate.tree_bytes +
                                estimate.showdown_bytes + estimate.recalc_bytes +
                                estimate.workspace_bytes);
}

TEST_CASE("peak RSS is reported") {
  CHECK(peak_rss_bytes() > 0);
}
