#pragma once
#include <string>

#include <nlohmann/json.hpp>

#include "config/schema.hpp"
#include "game/game.hpp"

namespace engine {

// `engine plan`: what a solve of this config would cost on each core, and
// which core, hero mode, update scheme, abstraction and batch to run for a
// time budget. Pure arithmetic over the built tree - no showdown clustering,
// no solver allocation - so an API can call it at queue time in place of a
// seat-count rule of thumb.
//
// The rate model is a small set of measured constants (dated, with the
// commit, in plan.cpp) times tree statistics: nodes per runout times hands
// for a vectorized walk, log entries per deal for a pinned walk. It predicts
// within a factor of two, not within a percent; the metadata of every solve
// carries the real rate, and that is what should move these constants.
struct PlanRequest {
  double time_budget_s = 0.0;     // 0 = no budget: recommend the exact core wherever it exists
  double target_pct = 0.0;        // the accuracy the caller wants, informational
  int threads = 0;                // config convention: 0 = one per hardware thread
  double memory_limit_gb = 0.0;   // 0 = the config's
};

nlohmann::json make_plan(const SolveConfig& config, const Game& game, const PlanRequest& request,
                         double setup_seconds);

}  // namespace engine
